import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from '../lib/config';
import { addMetric, event, getMeta, putEvidence, setMeta } from '../lib/db';
import type { Evidence, Metric, Mitigation, Scenario } from '../lib/domain';

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type Observation={at:number;duration:number;status:number;saturation:number};
export class Laboratory {
  private servers:http.Server[]=[];
  private timer:ReturnType<typeof setInterval>|null=null;
  private busy=false;
  private poolUsed=0;
  private poolLimit=20;
  private holdMs=25;
  private inventoryDelay=20;
  private badRelease=false;
  private observations=new Map<string,Observation[]>();
  scenario:Scenario|null=null;
  readonly services=['checkout','payments','inventory'];

  private async record(service:string,traceId:string,start:number,status:number,detail:string,dependency?:string){
    const duration=performance.now()-start;
    const saturation=service==='payments'?Math.min(1,this.poolUsed/this.poolLimit):0.08;
    const rows=this.observations.get(service)||[];
    rows.push({at:Date.now(),duration,status,saturation});
    this.observations.set(service,rows.filter(r=>r.at>Date.now()-120000));
    if(status>=400 || Math.random()<0.06)await putEvidence({
      id:randomUUID(),kind:'trace',service,at:new Date().toISOString(),
      title:service+' · HTTP '+status+' · '+Math.round(duration)+' ms',
      detail, data:{traceId,duration:Math.round(duration),status,dependency:dependency||null,source:'http-laboratory'}
    });
  }
  private async log(service:string,code:string,detail:string,traceId:string){
    await putEvidence({id:randomUUID(),kind:'log',service,at:new Date().toISOString(),title:code,detail,data:{code,traceId,level:'error'}});
  }
  private listen(server:http.Server,port:number){
    return new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  }
  async start(){
    const saved=await getMeta<Scenario>('labScenario');
    this.configure(saved);
    for(const [index,service] of this.services.entries()){
      const server=http.createServer((request,response)=>{
        const traceId=String(request.headers['x-trace-id']||randomBytes(16).toString('hex'));
        void this.handle(service,traceId,response).catch(()=>{if(!response.headersSent)response.writeHead(500);response.end();});
      });
      this.servers.push(server);
      await this.listen(server,config.labPort+index);
    }
    const metricsServer=http.createServer(async(_request,response)=>{
      const latest=await this.currentMetrics();
      response.setHeader('Content-Type','text/plain; version=0.0.4');
      response.end(latest.flatMap(m=>[
        'sentinela_service_error_ratio{service="'+m.service+'"} '+m.errorRate,
        'sentinela_service_latency_p95_ms{service="'+m.service+'"} '+m.p95,
        'sentinela_service_requests_per_minute{service="'+m.service+'"} '+m.rpm,
        'sentinela_service_saturation_ratio{service="'+m.service+'"} '+m.saturation
      ]).join('\n')+'\n');
    });
    this.servers.push(metricsServer); await this.listen(metricsServer,config.labPort+3);
    this.timer=setInterval(()=>{if(!this.busy){this.busy=true;void Promise.all(Array.from({length:5},()=>fetch('http://127.0.0.1:'+config.labPort+'/checkout',{signal:AbortSignal.timeout(2500)}).then(r=>r.arrayBuffer()).catch(()=>null))).finally(()=>{this.busy=false;});}},650);
    await event('monitor','Laboratório conectado','Tráfego HTTP contínuo entre checkout, payments e inventory.');
  }
  private async handle(service:string,traceId:string,response:http.ServerResponse){
    const start=performance.now();let status=200;let detail='Requisição concluída';
    if(service==='payments'){
      if(this.poolUsed>=this.poolLimit){
        status=503;detail='Aquisição de conexão excedeu o limite do pool.';
        await this.log(service,'POOL_ACQUIRE_TIMEOUT','pool_used='+this.poolUsed+'; pool_limit='+this.poolLimit+'; conexões indisponíveis',traceId);
      }else{
        this.poolUsed++;
        try{
          await wait(this.holdMs);
          if(this.badRelease){status=502;detail='Falha na validação da assinatura na versão atual.';await this.log(service,'PAYMENT_SIGNATURE_INVALID','release=payments-2.4.1; validação rejeitou assinatura válida',traceId);}
        }finally{this.poolUsed--;}
      }
    }else if(service==='inventory'){
      await wait(this.inventoryDelay);detail='Consulta de estoque concluída';
    }else{
      const dependencies=['payments','inventory'];
      const results=await Promise.all(dependencies.map(async(dependency,i)=>{
        try{
          const result=await fetch('http://127.0.0.1:'+(config.labPort+i+1)+'/'+dependency,{headers:{'x-trace-id':traceId},signal:AbortSignal.timeout(350)});
          await result.arrayBuffer();
          if(!result.ok)return {status:503,dependency,detail:'Dependência retornou HTTP '+result.status};
          return null;
        }catch{
          await this.log('checkout','DEPENDENCY_TIMEOUT','deadline_ms=350; dependency='+dependency,traceId);
          return {status:504,dependency,detail:'Deadline da dependência '+dependency+' excedido'};
        }
      }));
      const failed=results.find(Boolean);
      if(failed){status=failed.status;detail=failed.detail;await this.record(service,traceId,start,status,detail,failed.dependency);}
      else await this.record(service,traceId,start,status,detail);
      response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify({service,status,traceId}));return;
    }
    await this.record(service,traceId,start,status,detail);
    response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify({service,status,traceId}));
  }
  private configure(scenario:Scenario|null){
    this.scenario=scenario;this.poolLimit=scenario==='pool_exhaustion'?1:20;
    this.holdMs=scenario==='pool_exhaustion'?600:25;
    this.inventoryDelay=scenario==='dependency_latency'?850:20;
    this.badRelease=scenario==='bad_deployment';
  }
  async inject(scenario:Scenario){
    if(this.scenario)throw new Error('Restaure o laboratório antes de iniciar outra falha.');
    this.configure(scenario);await setMeta('labScenario',scenario);
    const changes:Record<Scenario,Omit<Evidence,'id'|'at'|'kind'>>={
      pool_exhaustion:{service:'payments',title:'Configuração de conexões alterada',detail:'pool_limit: 20 → 1; connection_hold_ms: 25 → 600',data:{changeType:'configuration',before:{pool_limit:20,connection_hold_ms:25},after:{pool_limit:1,connection_hold_ms:600}}},
      dependency_latency:{service:'inventory',title:'Configuração de resposta alterada',detail:'response_delay_ms: 20 → 850',data:{changeType:'configuration',before:{response_delay_ms:20},after:{response_delay_ms:850}}},
      bad_deployment:{service:'payments',title:'Deploy payments-2.4.1',detail:'payments-2.4.0 → payments-2.4.1; alteração no validador de assinaturas',data:{changeType:'deployment',previousVersion:'payments-2.4.0',version:'payments-2.4.1',diff:'signature_validator: stable → strict-incompatible'}}
    };
    await putEvidence({...changes[scenario],id:randomUUID(),at:new Date().toISOString(),kind:'change'});
    await event('laboratory','Falha ativada no laboratório',changes[scenario].detail);
  }
  async mitigate(action:Mitigation,service:string){
    if(action==='restore_pool'&&service==='payments'){this.poolLimit=20;this.holdMs=25;}
    else if(action==='disable_latency'&&service==='inventory'){this.inventoryDelay=20;}
    else if(action==='rollback'&&service==='payments'){this.badRelease=false;}
    else throw new Error('Ação ou serviço não permitidos no laboratório.');
    this.scenario=null;await setMeta('labScenario',null);
    await putEvidence({id:randomUUID(),kind:'change',service,at:new Date().toISOString(),title:'Mitigação executada',detail:action,data:{changeType:'mitigation',action}});
  }
  async reset(){
    this.configure(null);await setMeta('labScenario',null);
    await event('laboratory','Ambiente restaurado','Os serviços voltaram à configuração saudável. A recuperação será verificada pelas métricas.');
  }
  async currentMetrics():Promise<Metric[]>{
    const now=Date.now();
    return this.services.map(service=>{
      const rows=(this.observations.get(service)||[]).filter(r=>r.at>now-12000);
      const durations=rows.map(r=>r.duration).sort((a,b)=>a-b);
      return {service,at:new Date(now).toISOString(),errorRate:rows.length?rows.filter(r=>r.status>=400).length/rows.length:0,
        p95:Math.round(durations[Math.max(0,Math.ceil(durations.length*0.95)-1)]||0),
        rpm:Math.round(rows.length*5),saturation:service==='payments'&&this.poolLimit===1?Math.min(1,Math.max(...rows.map(r=>r.saturation),0)):0.08,
        requests:rows.length,source:'laboratory' as const};
    });
  }
  async sample(){const metrics=await this.currentMetrics();for(const metric of metrics)await addMetric(metric);return metrics;}
  async stop(){
    if(this.timer)clearInterval(this.timer);
    for(const server of this.servers){server.closeAllConnections();server.close();}
  }
}
