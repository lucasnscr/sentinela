import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import pg from 'pg';
import {config} from '../lib/config';
import type {Snapshot} from '../lib/domain';
import {safeError} from '../lib/security';

const directory=await mkdtemp(path.join(tmpdir(),'sentinela-runtime-contract-'));
const database='sentinela_ops_e2e_'+randomUUID().replaceAll('-','').slice(0,10);
const admin=new pg.Client({connectionString:config.databaseUrl});
const token=randomUUID()+randomUUID();let app:ChildProcess|undefined,created=false,log='';
const health=http.createServer((_,response)=>{response.writeHead(200);response.end('healthy');});
async function port(server:net.Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return (server.address() as net.AddressInfo).port;}
async function waitFor<T>(label:string,fn:()=>Promise<T|undefined>,timeout=60000):Promise<T>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(app?.exitCode!==null&&app?.exitCode!==undefined)throw new Error('Aplicação encerrou durante '+label);try{const result=await fn();if(result)return result;}catch(error){if(error instanceof assert.AssertionError)throw error;}await new Promise(resolve=>setTimeout(resolve,500));}
  throw new Error('Tempo excedido: '+label);
}
try{
  await admin.connect();await admin.query('CREATE DATABASE "'+database+'"');created=true;
  const databaseUrl=new URL(config.databaseUrl);databaseUrl.pathname='/'+database;
  const healthPort=await port(health),probe=net.createServer(),webPort=await port(probe);await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const base='http://127.0.0.1:'+webPort;
  const resourceId='/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/contract-test/providers/Microsoft.Web/sites/sentinela-contract-test';
  const stateFile=path.join(directory,'state.json'),configFile=path.join(directory,'targets.json');
  await writeFile(stateFile,JSON.stringify({resourceId,azureState:'Stopped',azureCalls:0,kubeHealthy:false,generation:1,replicas:2,restartMarker:null,kubeCalls:0}));
  const fixture=await readFile('tests/fixtures/runtime-cli.mjs','utf8');
  for(const executable of ['az','kubectl']){const filename=path.join(directory,executable);await writeFile(filename,'#!/usr/bin/env node\n'+fixture);await chmod(filename,0o700);}
  await writeFile(configFile,JSON.stringify({targets:[
    {id:'kube-contract-test',runtime:'kubernetes',service:'kube-contract-test',context:'sentinela-contract-test',namespace:'contract-test',deployment:'contract-workload',actions:['restart','scale'],minReplicas:1,maxReplicas:4},
    {id:'azure-contract-test',runtime:'azure-functions',service:'azure-contract-test',resourceId,expectedRunning:true,healthUrl:'http://127.0.0.1:'+healthPort+'/health',actions:['start','restart']},
  ]}));
  const env={...process.env,DATABASE_URL:databaseUrl.toString(),PORT:String(webPort),APP_ORIGINS:base,
    LAB_ENABLED:'false',PROMETHEUS_URL:'http://127.0.0.1:1',AI_MODE:'rules',AI_PROVIDER:'none',EMBEDDING_PROVIDER:'none',SDLC_ENABLED:'false',
    OPERATIONS_ENABLED:'true',OPERATIONS_EXECUTION_ENABLED:'true',OPERATIONS_CONFIG_FILE:configFile,OPERATIONS_API_TOKEN:token,OPERATIONS_INTERVAL_MS:'5000',OPERATIONS_COOLDOWN_MS:'30000',
    KUBECTL_BIN:path.join(directory,'kubectl'),AZ_CLI_BIN:path.join(directory,'az'),SENTINELA_TEST_STATE_FILE:stateFile,
    OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:''};
  app=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{env,stdio:['ignore','pipe','pipe']});
  app.stdout?.on('data',chunk=>{log=(log+chunk).slice(-8000);});app.stderr?.on('data',chunk=>{log=(log+chunk).slice(-8000);});
  async function snapshot():Promise<Snapshot|undefined>{const response=await fetch(base+'/api/snapshot',{signal:AbortSignal.timeout(3000)});return response.ok?response.json():undefined;}
  const initial=await waitFor('incidentes de runtime e proposta automática',async()=>{const data=await snapshot();return data?.incidents.length===2&&data.operations.plans.some(plan=>plan.targetId==='azure-contract-test')?data:undefined;});
  assert.ok(initial.operations.targets.every(target=>target.phase==='degraded'));
  const azurePlan=initial.operations.plans.find(plan=>plan.targetId==='azure-contract-test')!;
  async function enqueue(body:unknown,authorized=true){const response=await fetch(base+'/api/commands',{method:'POST',headers:{origin:base,'content-type':'application/json',...(authorized?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}
  async function complete(id:string){await waitFor('comando',async()=>{const response=await fetch(base+'/api/commands/'+id);const result=await response.json();assert.notEqual(result.status,'failed',result.result);return result.status==='completed'?true:undefined;});}
  assert.equal((await enqueue({kind:'operation_review',planId:azurePlan.id,approve:true},false)).status,401);
  const proposed=await enqueue({kind:'operation_plan',targetId:'kube-contract-test',action:'restart',requestId:randomUUID()});assert.equal(proposed.status,202);await complete(proposed.value.id);
  const kubePlan=await waitFor('plano Kubernetes',async()=>(await snapshot())?.operations.plans.find(plan=>plan.targetId==='kube-contract-test'));
  for(const plan of [azurePlan,kubePlan]){
    const [first,second]=await Promise.all([enqueue({kind:'operation_review',planId:plan.id,approve:true}),enqueue({kind:'operation_review',planId:plan.id,approve:true})]);
    assert.equal(first.status,202);assert.equal(first.value.id,second.value.id);await complete(first.value.id);
  }
  const verified=await waitFor('resultado dos ajustes',async()=>{const data=await snapshot();return data?.operations.plans.length===2&&data.operations.plans.every(plan=>plan.state==='succeeded')&&data.incidents.every(incident=>incident.status==='resolved')?data:undefined;});
  const state=JSON.parse(await readFile(stateFile,'utf8'));assert.equal(state.azureCalls,1);assert.equal(state.kubeCalls,1);
  assert.ok(verified.incidents.every(incident=>incident.evidence.some(item=>item.kind==='runtime')));
  const report=await fetch(base+'/api/incidents/'+verified.incidents[0].id+'/postmortem');assert.equal(report.status,200);assert.match(await report.text(),/runtime/);
  console.log('PASS Kubernetes e Azure Functions: worker, CLI controlada, incidentes, MCP, token, aprovação idempotente, ajuste e recuperação.');
  if(process.argv.includes('--preview')){
    console.log('Prévia de teste com provedores simulados: '+base+' (encerre para remover processos e banco temporário).');
    await Promise.race([once(process,'SIGINT'),once(process,'SIGTERM')]);
  }
}catch(error){console.error(safeError(error));if(log)console.error(safeError(new Error(log.slice(-2000))));process.exitCode=1;}
finally{
  if(app&&app.exitCode===null){const exited=once(app,'exit');app.kill('SIGTERM');const timer=setTimeout(()=>app?.kill('SIGKILL'),15000);await exited;clearTimeout(timer);}
  await new Promise<void>(resolve=>health.close(()=>resolve()));
  if(created)await admin.query('DROP DATABASE "'+database+'" WITH (FORCE)');await admin.end();await rm(directory,{recursive:true,force:true});
}
