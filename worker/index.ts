import { randomUUID } from 'node:crypto';
import { config } from '../lib/config';
import { recordAiFailure } from '../lib/ai';
import { claimCommand, closeIncident, enqueue, event, findIncident, finishCommand, getMeta, incidentFromRow, migrate, openIncident, pool, prune, setMeta, updateIncident } from '../lib/db';
import { detect, fingerprint, isHealthy } from '../lib/detection';
import { indexKnowledge, seedKnowledge } from '../lib/knowledge';
import { safeError } from '../lib/security';
import type { Metric, Scenario } from '../lib/domain';
import { Laboratory } from './laboratory';
import { connectTools } from './mcp-client';
import { createInvestigator } from './investigation';
import { samplePrometheus } from './prometheus';
import { startTelemetry, stopTelemetry } from './observability';
import { createOperations } from './operations';
import {createSdlc} from './sdlc';
import {verifySdlcCases,canCloseSdlcIncident} from './sdlc/verification';
import {publishLearning} from './sdlc/learning';
import {cancelDevelopment,reconcileDevelopment} from './sdlc/development';

startTelemetry();
await migrate();
const lease=await pool.connect();
const acquired=await lease.query('SELECT pg_try_advisory_lock(742902) AS acquired');
if(!acquired.rows[0].acquired){console.error('Já existe um worker ativo para este banco.');await pool.end();process.exit(1);}
const workerId=randomUUID();
await setMeta('workerId',workerId);await setMeta('aiMode',config.aiMode);await setMeta('mcp',false);
await pool.query("UPDATE commands SET status='queued',updated_at=now() WHERE status='executing'");
await seedKnowledge();
const lab=config.labEnabled?new Laboratory():null;
if(lab)await lab.start();
const tools=await connectTools();await setMeta('mcp',true);
const investigator=await createInvestigator(tools,lab);
const operations=await createOperations();
const sdlc=await createSdlc();
await event('worker','Monitoramento ativo','Worker '+workerId.slice(0,8)+'; consultas a cada '+(config.interval/1000)+' segundos.');
console.log('Sentinela worker ativo. Laboratório: '+(lab?'http://127.0.0.1:'+config.labPort:'desabilitado'));
void indexKnowledge().then(()=>event('knowledge','Base de conhecimento pronta','Runbooks disponíveis para recuperação.')).catch(error=>event('knowledge','Busca lexical disponível',safeError(error)));

const consecutive=new Map<string,number>(),healthy=new Map<string,number>(),running=new Set<string>();
const lastDetected=new Map<string,string>(),lastHealthy=new Map<string,string>();
let closing=false;
const pending=new Set<Promise<unknown>>();
function launch(id:string,resume=false){
  if(running.has(id)||closing||running.size>=2)return;
  running.add(id);
  const task=investigator.investigate(id,resume).catch(async error=>{
    const message=safeError(error);
    await updateIncident(id,{stage:'failed',lastError:message});
    await event('error','A investigação precisa ser retomada',message,id);
  }).finally(()=>{running.delete(id);pending.delete(task);});
  pending.add(task);
}
const unfinished=await pool.query("SELECT id FROM incidents WHERE status='investigating' AND stage IN ('queued','collecting','analyzing','checking','failed')");
for(const row of unfinished.rows)launch(row.id,true);
let lastPrune=0;
let lastCollectionWarning=0;
let latestMetrics:Metric[]=[];
async function monitor(){
  await setMeta('heartbeat',new Date().toISOString());
  let metrics:Metric[]=[];
  try{metrics=config.prometheusUrl?await samplePrometheus():lab?await lab.sample():[];}
  catch{
    if(Date.now()-lastCollectionWarning>30000){lastCollectionWarning=Date.now();await event('error','Coleta de métricas indisponível','Os comandos e os conectores operacionais continuam independentes. Confira a fonte de telemetria.');}
  }
  latestMetrics=metrics;
  await verifySdlcCases(metrics);await reconcileDevelopment();
  const environment=config.prometheusUrl?(config.monitoredEnvironment||'configured'):'laboratory';
  const active=await pool.query("SELECT * FROM incidents WHERE status <> 'resolved'");
  for(const row of active.rows){
    if(row.stage==='queued'&&!running.has(row.id))launch(row.id);
    const incident=incidentFromRow(row);
    const metric=metrics.find(m=>m.service===incident.service);
    if(incident.environment===environment&&metric&&isHealthy(metric)){
      const count=(healthy.get(incident.id)||0)+(lastHealthy.get(incident.id)===metric.at?0:1);healthy.set(incident.id,count);lastHealthy.set(incident.id,metric.at);
      if(count>=3&&!running.has(incident.id)&&await canCloseSdlcIncident(incident.id))await closeIncident(incident.id);
    }else{healthy.set(incident.id,0);lastHealthy.delete(incident.id);}
    if(incident.status==='investigating'&&incident.stage==='inconclusive'&&incident.attempts<3&&Date.now()-new Date(incident.updatedAt).getTime()>60000)launch(incident.id);
  }
  const candidates=config.prometheusUrl?metrics:metrics.filter(m=>m.service==='checkout');
  for(const service of consecutive.keys())if(!candidates.some(metric=>metric.service===service)){consecutive.set(service,0);lastDetected.delete(service);}
  for(const metric of candidates){
    if(lastDetected.get(metric.service)===metric.at)continue;
    lastDetected.set(metric.service,metric.at);
    const alert=detect(metric);
    consecutive.set(metric.service,alert?(consecutive.get(metric.service)||0)+1:0);
    if(!alert||(consecutive.get(metric.service)||0)<2)continue;
    const {incident,created}=await openIncident(metric.service,environment,alert.title,fingerprint(metric.service,environment));
    if(created){await event('alert','Degradação detectada automaticamente',alert.title,incident.id);launch(incident.id);}
  }
  if(Date.now()-lastPrune>3600000){lastPrune=Date.now();await prune();}
}
async function commands(){
  const command=await claimCommand();if(!command)return;
  try{
    if(command.kind==='inject'){
      if(!lab||config.prometheusUrl)throw new Error('Injeção disponível apenas no laboratório local.');
      const active=await pool.query("SELECT id FROM incidents WHERE status <> 'resolved' LIMIT 1");
      if(active.rows.length)throw new Error('Aguarde a recuperação dos incidentes atuais antes de iniciar outra falha.');
      await lab.inject(command.payload.scenario as Scenario);
    }else if(command.kind==='reset'){
      if(!lab)throw new Error('Laboratório desabilitado.');await lab.reset();
    }else if(command.kind==='review'){
      const id=command.payload.incidentId as string;
      if(running.has(id))throw new Error('Investigação em andamento. Aguarde a conclusão.');
      running.add(id);
      try{await investigator.review(id,command.payload.approve===true);}finally{running.delete(id);}
    }else if(command.kind==='sdlc_propose')await sdlc.propose({...command.payload,kind:command.payload.correctionKind});
    else if(command.kind==='sdlc_publish')await sdlc.publish(command.payload.caseId,command.payload.proposalHash);
    else if(command.kind==='sdlc_learning_reconcile')await publishLearning(command.payload.caseId,command.payload.version,command.payload.hash,undefined,undefined,true);
    else if(command.kind==='sdlc_learning_publish')await publishLearning(command.payload.caseId,command.payload.version,command.payload.hash);
    else if(command.kind==='sdlc_cancel')await cancelDevelopment(command.payload.caseId,command.payload.proposalHash,command.payload.reason);
    else if(command.kind==='sdlc_reconcile')await sdlc.reconcile(command.payload.caseId);
    else if(command.kind==='operation_plan')await operations.plan(command.payload as {targetId:string;action:'restart'|'scale'|'start';replicas?:number;requestId:string});
    else if(command.kind==='operation_review')await operations.review(command.payload.planId,command.payload.approve===true);
    else if(command.kind==='operation_reconcile')await operations.reconcile(command.payload.planId,command.payload.note);
    else if(command.kind==='reinvestigate')launch(command.payload.incidentId);
    else if(command.kind==='alert'){
      const {service,title}=command.payload;
      const environment=config.monitoredEnvironment||'configured';
      const {incident,created}=await openIncident(service,environment,title,fingerprint(service,environment));
      if(created){await event('alert','Alerta recebido por webhook',title,incident.id);launch(incident.id);}
    }else throw new Error('Comando desconhecido.');
    await finishCommand(command.id);
  }catch(error){
    const message=safeError(error);await finishCommand(command.id,message);
    await event('error','Comando não executado',message,command.payload.incidentId||null);
  }
}
const heartbeat=setInterval(()=>{void setMeta('heartbeat',new Date().toISOString()).catch(()=>{});},2000);
async function loop(){
  while(!closing){
    try{await monitor();for(let i=0;i<5;i++)await commands();}
    catch(error){console.error('[monitor] '+safeError(error));await event('error','Falha temporária no monitor',safeError(error)).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,config.interval));
  }
}
const loopTask=loop();
const operationsTask=(async()=>{
  while(!closing){
    try{await operations.tick(latestMetrics.filter(metric=>Date.now()-new Date(metric.at).getTime()<20000));}
    catch{console.error('[operations] Não foi possível concluir a coleta operacional.');}
    await new Promise(resolve=>setTimeout(resolve,config.interval));
  }
})();
async function stop(){
  if(closing)return;closing=true;clearInterval(heartbeat);
  console.log('Encerrando worker...');
  await Promise.all([loopTask,operationsTask]);await Promise.allSettled([...pending]);
  await lab?.stop();await tools.close();await setMeta('mcp',false);
  await investigator.close();await stopTelemetry();
  await lease.query('SELECT pg_advisory_unlock(742902)');lease.release();await pool.end();
}
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0));});
process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0));});
