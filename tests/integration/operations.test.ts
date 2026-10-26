import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {migrate,pool,setMeta} from '../../lib/db';
import {getPlan,operationPlans,setPlanState} from '../../lib/operations/store';
import {createOperations} from '../../worker/operations';
import {createRuntimeAdapter} from '../../worker/runtime/adapter';
import type {RuntimeAdapter} from '../../worker/runtime/adapter';
import type {CommandRunner} from '../../worker/runtime/command';
import type {OperationsSettings,KubernetesTarget,RuntimeObservation} from '../../lib/operations/types';
after(async()=>{await pool.end();});

async function cleanup(targetIds:string[]){
  await pool.query('DELETE FROM commands WHERE payload->>\'targetId\'=ANY($1)',[targetIds]);
  const environments=targetIds.map(id=>'runtime:'+id);
  await pool.query('DELETE FROM events WHERE incident_id IN(SELECT id FROM incidents WHERE environment=ANY($1))',[environments]);
  await pool.query('DELETE FROM incidents WHERE environment=ANY($1)',[environments]);
  await pool.query('DELETE FROM operation_plans WHERE target_id=ANY($1)',[targetIds]);
  await pool.query('DELETE FROM runtime_observations WHERE target_id=ANY($1)',[targetIds]);
  await pool.query("DELETE FROM evidence WHERE kind='runtime' AND data->>'targetId'=ANY($1)",[targetIds]);
}
test('Kubernetes e Azure percorrem coleta, incidente, plano, aprovação única e verificação persistida',async()=>{
  await migrate();const suffix=randomUUID().slice(0,8);
  const targetId='test-kube-'+suffix,azureId='test-azure-'+suffix;
  const health=http.createServer((_,response)=>{response.writeHead(200);response.end('healthy');});
  await new Promise<void>(resolve=>health.listen(0,'127.0.0.1',resolve));
  const port=(health.address() as {port:number}).port;
  let desired=2,available=0,generation=1,state='Stopped',scaleCalls=0,startCalls=0;
  const run:CommandRunner=async(program,args)=>{
    if(program==='az'){
      if(args[1]==='start'){startCalls++;state='Running';return '';}
      return JSON.stringify({id:'/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test/providers/Microsoft.Web/sites/'+azureId,enabled:true,state,kind:'functionapp,linux'});
    }
    if(args.includes('patch')){
      const patch=JSON.parse(args[args.indexOf('--patch')+1]);
      assert.ok(patch.some((entry:any)=>entry.op==='test'&&entry.path==='/metadata/resourceVersion'));
      desired=patch.find((entry:any)=>entry.path==='/spec/replicas').value;available=desired;generation++;scaleCalls++;return 'deployment.apps/demo';
    }
    if(args.includes('deployment/demo'))return JSON.stringify({kind:'Deployment',metadata:{name:'demo',namespace:'test',uid:'deployment-'+suffix,resourceVersion:String(generation),generation},spec:{replicas:desired,selector:{matchLabels:{app:targetId}},template:{metadata:{}}},status:{observedGeneration:generation,replicas:desired,readyReplicas:available,availableReplicas:available,updatedReplicas:desired}});
    if(args.includes('replicasets'))return JSON.stringify({items:[{metadata:{uid:'rs-'+suffix,ownerReferences:[{uid:'deployment-'+suffix,controller:true}]}}]});
    if(args.includes('pods'))return JSON.stringify({items:Array.from({length:desired},(_,index)=>({metadata:{name:'pod-'+index,uid:'pod-'+suffix+index,ownerReferences:[{uid:'rs-'+suffix,controller:true}]},status:{containerStatuses:[{name:'app',ready:available>0,state:available?{running:{}}:{waiting:{reason:'CrashLoopBackOff'}}}]}}))});
    return JSON.stringify({items:[]});
  };
  const settings:OperationsSettings={enabled:true,executionEnabled:true,intervalMs:0,cooldownMs:0,targets:[
    {id:targetId,runtime:'kubernetes',service:targetId,context:'test-only',namespace:'test',deployment:'demo',actions:['scale','restart'],minReplicas:1,maxReplicas:4},
    {id:azureId,runtime:'azure-functions',service:azureId,resourceId:'/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test/providers/Microsoft.Web/sites/'+azureId,actions:['start','restart'],expectedRunning:true,healthUrl:'http://127.0.0.1:'+port+'/health'},
  ]};
  try{
    const operations=await createOperations(createRuntimeAdapter(run),settings);
    await operations.tick([]);await operations.tick([]);
    const {rows}=await pool.query('SELECT environment FROM incidents WHERE environment=ANY($1)',[[targetId,azureId].map(id=>'runtime:'+id)]);
    assert.equal(rows.length,2,'Cada ambiente deve gerar seu próprio incidente.');
    const automatic=(await operationPlans()).find(plan=>plan.targetId===azureId)!;
    assert.equal(automatic.action,'start');assert.equal(startCalls,0,'A proposta automática não executa a ação.');
    const scale=await operations.plan({targetId,action:'scale',replicas:3,requestId:randomUUID()});
    assert.equal(scaleCalls,0);
    await Promise.all([operations.review(scale.id,true),operations.review(scale.id,true)]);
    await Promise.all([operations.review(automatic.id,true),operations.review(automatic.id,true)]);
    assert.equal(scaleCalls,1);assert.equal(startCalls,1);
    for(let attempt=0;attempt<4;attempt++){await new Promise(resolve=>setTimeout(resolve,3));await operations.tick([]);}
    assert.equal((await getPlan(scale.id))?.state,'succeeded');assert.equal((await getPlan(automatic.id))?.state,'succeeded');
    const active=await pool.query("SELECT id FROM incidents WHERE environment=ANY($1) AND status<>'resolved'",[[targetId,azureId].map(id=>'runtime:'+id)]);assert.equal(active.rows.length,0);
    settings.cooldownMs=60000;
    const cooldown=await operations.plan({targetId,action:'scale',replicas:4,requestId:randomUUID()});
    await assert.rejects(operations.review(cooldown.id,true),/intervalo mínimo/);assert.equal(scaleCalls,1);
  }finally{await cleanup([targetId,azureId]);await new Promise<void>(resolve=>health.close(()=>resolve()));}
});

test('mudança concorrente bloqueia execução e resultado incerto não é repetido após reinício',async()=>{
  const id='test-guard-'+randomUUID().slice(0,8);
  const target:KubernetesTarget={id,service:id,runtime:'kubernetes',context:'test-only',namespace:'test',deployment:'demo',actions:['restart','scale'],minReplicas:1,maxReplicas:4};
  const settings:OperationsSettings={enabled:true,executionEnabled:true,intervalMs:0,cooldownMs:0,targets:[target]};
  let version='v1',calls=0,uncertain=false;
  const adapter:RuntimeAdapter={
    async observe():Promise<RuntimeObservation>{return {targetId:id,service:id,runtime:'kubernetes',scope:'test',at:new Date().toISOString(),phase:'healthy',version,summary:'Healthy',issues:[],details:{desired:2,hpa:false},allowedActions:target.actions};},
    async execute(){calls++;if(uncertain)throw new Error('Provider timeout');},
  };
  try{
    const operations=await createOperations(adapter,settings);
    const stale=await operations.plan({targetId:id,action:'restart',requestId:randomUUID()});version='v2';
    await assert.rejects(operations.review(stale.id,true),/mudou/);assert.equal(calls,0);assert.equal((await getPlan(stale.id))?.state,'failed');
    const expired=await operations.plan({targetId:id,action:'restart',requestId:randomUUID()});expired.expiresAt=new Date(0).toISOString();await setPlanState(expired);
    await assert.rejects(operations.review(expired.id,true),/expirado/);assert.equal(calls,0);
    uncertain=true;const unknown=await operations.plan({targetId:id,action:'restart',requestId:randomUUID()});
    await assert.rejects(operations.review(unknown.id,true),/não confirmado/);assert.equal(calls,1);assert.equal((await getPlan(unknown.id))?.state,'uncertain');
    const restarted=await createOperations(adapter,settings);await restarted.review(unknown.id,true);assert.equal(calls,1);
    await assert.rejects(restarted.plan({targetId:id,action:'restart',requestId:randomUUID()}),/pendente/);
    await restarted.reconcile(unknown.id,'Conferi o workload diretamente no provedor.');assert.equal((await getPlan(unknown.id))?.state,'acknowledged');assert.equal(calls,1);
    const readonly=await createOperations(adapter,{...settings,executionEnabled:false});
    const pending=await readonly.plan({targetId:id,action:'restart',requestId:randomUUID()});
    await assert.rejects(readonly.review(pending.id,true),/desabilitada/);assert.equal(calls,1);
    await readonly.review(pending.id,false);assert.equal((await getPlan(pending.id))?.state,'declined');
    // Reserve a plan as if the worker had stopped immediately before a call.
    const interrupted=await restarted.plan({targetId:id,action:'restart',requestId:randomUUID()});interrupted.state='executing';await setPlanState(interrupted);
    await createOperations(adapter,settings);assert.equal((await getPlan(interrupted.id))?.state,'uncertain');assert.equal(calls,1);
  }finally{await cleanup([id]);}
});

test('a API exige token operacional e não o armazena no comando',async()=>{
  const {POST}=await import('../../app/api/commands/route');
  const previous=process.env.OPERATIONS_API_TOKEN;const secret='test-operation-'+randomUUID();
  process.env.OPERATIONS_API_TOKEN=secret;await setMeta('heartbeat',new Date().toISOString());
  const targetId='test-auth-'+randomUUID().slice(0,8),requestId=randomUUID();
  const body=JSON.stringify({kind:'operation_plan',targetId,action:'restart',requestId});
  const request=(token:string)=>new Request('http://127.0.0.1:4320/api/commands',{method:'POST',headers:{origin:'http://127.0.0.1:4320',host:'127.0.0.1:4320','content-type':'application/json',authorization:'Bearer '+token},body});
  try{
    assert.equal((await POST(request('wrong'))).status,401);
    const first=await POST(request(secret));assert.equal(first.status,202);const command=await first.json();
    const second=await (await POST(request(secret))).json();assert.equal(command.id,second.id);
    const {rows}=await pool.query('SELECT payload FROM commands WHERE id=$1',[command.id]);assert.equal(JSON.stringify(rows).includes(secret),false);
  }finally{if(previous===undefined)delete process.env.OPERATIONS_API_TOKEN;else process.env.OPERATIONS_API_TOKEN=previous;await cleanup([targetId]);}
});
