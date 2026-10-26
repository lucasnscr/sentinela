import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOperationsConfig,targetHash} from '../lib/operations/configuration';
import {validateOperation,validateReviewedPlan,isOperationRecovered} from '../lib/operations/policy';
import type {KubernetesTarget,AzureFunctionsTarget,OperationPlan,OperationsSettings,RuntimeObservation} from '../lib/operations/types';
import {observeKubernetes,executeKubernetes} from '../worker/runtime/kubernetes';
import {createRuntimeAdapter} from '../worker/runtime/adapter';
import {commandJson,type CommandRunner} from '../worker/runtime/command';
import {evidenceDiagnosis,validateDiagnosis} from '../lib/diagnosis';

const kube:KubernetesTarget={id:'catalog',service:'catalog-api',runtime:'kubernetes',context:'sentinela-test',namespace:'demo',deployment:'catalog-api',actions:['restart','scale'],minReplicas:1,maxReplicas:4};
const azure:AzureFunctionsTarget={id:'functions',service:'orders',runtime:'azure-functions',resourceId:'/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/demo/providers/Microsoft.Web/sites/sentinela-demo',actions:['start','restart'],expectedRunning:true,healthUrl:'http://127.0.0.1:1/health'};
function observation():RuntimeObservation{return {targetId:kube.id,runtime:kube.runtime,service:kube.service,scope:'test',at:new Date().toISOString(),phase:'healthy',version:'v1',summary:'Healthy',issues:[],details:{desired:2,ready:2,hpa:false,uid:'uid-1',resourceVersion:'42',generation:1,observedGeneration:1},allowedActions:kube.actions};}
function plan():OperationPlan{return {id:'plan-1',targetId:kube.id,service:kube.service,runtime:kube.runtime,action:'scale',replicas:3,state:'executing',reason:'test',impact:'test',before:observation(),expected:'test',configHash:targetHash(kube),requestId:'request-1',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),healthyChecks:0,result:null,incidentId:null};}
const settings:OperationsSettings={enabled:true,executionEnabled:true,intervalMs:15000,cooldownMs:300000,targets:[kube]};
function fixture(){return {kind:'Deployment',metadata:{name:'catalog-api',namespace:'demo',uid:'deploy-1',resourceVersion:'42',generation:2},spec:{replicas:2,selector:{matchLabels:{app:'catalog'}},template:{metadata:{annotations:{'existing.example/key':'preserve'}}}},status:{observedGeneration:2,replicas:2,readyReplicas:2,availableReplicas:2,updatedReplicas:2,conditions:[]}};}
function kubeRunner(deployment:any=fixture(),podStatus:any={containerStatuses:[{name:'app',ready:true,state:{running:{}}}]}):CommandRunner{return async(program,args)=>{
  assert.equal(program,'kubectl');assert.ok(args.includes('--context')&&args.includes('sentinela-test'));assert.ok(args.includes('demo'));
  if(args.includes('deployment/catalog-api'))return JSON.stringify(deployment);
  if(args.includes('replicasets'))return JSON.stringify({items:[{metadata:{uid:'rs-1',ownerReferences:[{uid:'deploy-1',controller:true}]}}]});
  if(args.includes('pods'))return JSON.stringify({items:[...Array.from({length:2},(_,index)=>({metadata:{uid:'pod-'+index,name:'catalog-'+index,ownerReferences:[{uid:'rs-1',controller:true}]},status:podStatus})),{metadata:{uid:'unrelated',name:'other',ownerReferences:[{uid:'other-rs',controller:true}]},status:{containerStatuses:[{state:{waiting:{reason:'ImagePullBackOff'}}}]}}]});
  return JSON.stringify({items:[]});
};}

test('alvos exigem escopo explícito, ações permitidas e identidades únicas',()=>{
  assert.equal(parseOperationsConfig({targets:[kube,azure]}).length,2);
  assert.throws(()=>parseOperationsConfig({targets:[{...kube,context:''}]}));
  assert.throws(()=>parseOperationsConfig({targets:[kube,kube]}),/único/);
  assert.throws(()=>parseOperationsConfig({targets:[{...kube,minReplicas:5,maxReplicas:2}]}));
  assert.throws(()=>parseOperationsConfig({targets:[{...azure,resourceId:azure.resourceId+'/slots/arbitrary'}]}));
  assert.throws(()=>parseOperationsConfig({targets:[{...azure,healthUrl:'http://remote.example/health',healthKeyEnv:'PRIVATE_KEY'}]}),/HTTPS/);
});
test('escala respeita limites, HPA, frescor e condição do workload',()=>{
  validateOperation(kube,observation(),'scale',3);
  assert.throws(()=>validateOperation(kube,observation(),'scale',0));
  assert.throws(()=>validateOperation(kube,observation(),'scale',5));
  assert.throws(()=>validateOperation(kube,{...observation(),details:{...observation().details,hpa:true}},'scale',3),/HPA/);
  assert.throws(()=>validateOperation(kube,{...observation(),at:new Date(0).toISOString()},'restart'),/antiga/);
  assert.throws(()=>validateOperation(kube,{...observation(),phase:'transitioning'},'restart'),/transição/);
  assert.throws(()=>validateOperation(kube,observation(),'start'),/permitida/);
});
test('plano revisado exige execução habilitada e o mesmo alvo e política',()=>{
  validateReviewedPlan(settings,kube,plan(),observation());
  assert.throws(()=>validateReviewedPlan({...settings,executionEnabled:false},kube,plan(),observation()),/desabilitada/);
  assert.throws(()=>validateReviewedPlan(settings,kube,{...plan(),expiresAt:new Date(0).toISOString()},observation()),/expirado/);
  assert.throws(()=>validateReviewedPlan(settings,kube,plan(),{...observation(),version:'new-version'}),/mudou/);
  assert.throws(()=>validateReviewedPlan(settings,{...kube,maxReplicas:8},plan(),observation()),/Política/);
});
test('Kubernetes identifica mecanismo de falha e ignora pods de outro controlador',async()=>{
  const healthy=await observeKubernetes(kube,kubeRunner());assert.equal(healthy.phase,'healthy');assert.equal(healthy.issues.length,0);
  const failed=await observeKubernetes(kube,kubeRunner(fixture(),{containerStatuses:[{name:'app',ready:false,state:{waiting:{reason:'CrashLoopBackOff'}},lastState:{terminated:{reason:'OOMKilled'}}}]}));
  assert.equal(failed.phase,'degraded');assert.ok(failed.issues.some(issue=>issue.code==='OOMKilled'));assert.ok(failed.issues.some(issue=>issue.code==='CrashLoopBackOff'));
  const stale=fixture();stale.status.observedGeneration=1;assert.equal((await observeKubernetes(kube,kubeRunner(stale))).phase,'transitioning');
  const zero=fixture();zero.spec.replicas=0;assert.equal((await observeKubernetes(kube,kubeRunner(zero))).phase,'inactive');
});
test('ajuste Kubernetes usa JSON patch com precondições e preserva anotações',async()=>{
  const calls:string[][]=[];
  const run:CommandRunner=async(_,args)=>{calls.push(args);return args.includes('patch')?'deployment.apps/catalog-api':JSON.stringify(fixture());};
  const current={...observation(),details:{...observation().details,resourceVersion:'42'}};
  await executeKubernetes(kube,{...plan(),action:'restart'},current,run);
  const args=calls.find(call=>call.includes('patch'))!;const patch=JSON.parse(args[args.indexOf('--patch')+1]);
  assert.ok(patch.some((item:any)=>item.op==='test'&&item.path==='/metadata/resourceVersion'&&item.value==='42'));
  assert.equal(patch.at(-1).value['existing.example/key'],'preserve');assert.equal(patch.at(-1).value['sentinela.dev/operation-id'],'plan-1');
});
test('Azure Functions diferencia estado do plano de controle e saúde da aplicação',async()=>{
  const calls:string[][]=[];
  const run:CommandRunner=async(program,args)=>{assert.equal(program,'az');calls.push(args);return JSON.stringify({id:azure.resourceId,state:'Running',enabled:true,kind:'functionapp,linux'});};
  const adapter=createRuntimeAdapter(run);
  const noProbe=await adapter.observe({...azure,healthUrl:undefined});assert.equal(noProbe.phase,'unknown');
  assert.ok(calls[0].includes('--ids'));assert.ok(calls[0].includes('--query'));assert.equal(calls[0].includes('--debug'),false);
  const missing=await adapter.observe(azure);assert.equal(missing.phase,'degraded');assert.equal(missing.issues[0].code,'HealthCheckFailed');
  const stopped=await createRuntimeAdapter(async()=>JSON.stringify({id:azure.resourceId,state:'Stopped',enabled:true,kind:'functionapp'})).observe(azure);
  assert.equal(stopped.phase,'degraded');validateOperation(azure,stopped,'start');
  assert.throws(()=>validateOperation({...azure,healthUrl:undefined},stopped,'start'),/healthUrl/);
});
test('verificação exige observação posterior e efeito específico do ajuste',()=>{
  const executed={...plan(),executedAt:new Date(Date.now()-2000).toISOString()};
  assert.equal(isOperationRecovered(executed,observation()),false);
  assert.equal(isOperationRecovered(executed,{...observation(),details:{desired:3}}),true);
  const restart={...executed,action:'restart' as const};
  assert.equal(isOperationRecovered(restart,{...observation(),details:{restartMarker:'other-plan'}}),false);
  assert.equal(isOperationRecovered(restart,{...observation(),details:{restartMarker:restart.id}}),true);
  assert.equal(isOperationRecovered(restart,{...observation(),phase:'unknown',details:{restartMarker:restart.id}}),false);
});
test('evidência de runtime explica a condição sem autorizar uma ação do laboratório',()=>{
  const evidence=[{id:'runtime-1',kind:'runtime' as const,service:'catalog-api',at:new Date().toISOString(),title:'Runtime degradado',detail:'Sem memória',data:{phase:'degraded',issues:[{code:'OOMKilled',message:'Container encerrado por falta de memória.'}]}}];
  const diagnosis=validateDiagnosis(evidenceDiagnosis(evidence,'catalog-api'),evidence,'catalog-api');
  assert.equal(diagnosis.confidence,'probable');assert.equal(diagnosis.action,'observe');assert.match(diagnosis.cause,/memória/);
  assert.throws(()=>commandJson('a private secret response'),error=>error instanceof Error&&!error.message.includes('private secret'));
});
