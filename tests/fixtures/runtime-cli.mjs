// Contract fixture used only by scripts/e2e-operations.ts. It never calls a
// cluster or cloud API and requires an explicit temporary state path.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const filename=process.env.SENTINELA_TEST_STATE_FILE;
if(!filename||!path.basename(path.dirname(filename)).startsWith('sentinela-runtime-contract-'))throw new Error('Fixture requires an isolated test directory.');
const state=JSON.parse(await readFile(filename,'utf8'));
const args=process.argv.slice(2);
if(path.basename(process.argv[1])==='az'){
  if(args[0]!=='functionapp')throw new Error('Unsupported contract command.');
  if(args[1]==='show')console.log(JSON.stringify({id:state.resourceId,state:state.azureState,enabled:true,kind:'functionapp,linux'}));
  else if(args[1]==='start'||args[1]==='restart'){
    state.azureState='Running';state.azureCalls++;await writeFile(filename,JSON.stringify(state));
  }else throw new Error('Unsupported Azure operation.');
}else{
  if(!args.includes('sentinela-contract-test')||!args.includes('contract-test'))throw new Error('Unexpected Kubernetes scope.');
  if(args.includes('patch')){
    const patch=JSON.parse(args[args.indexOf('--patch')+1]);
    if(!patch.some(item=>item.path==='/metadata/uid'&&item.value==='test-deployment')||!patch.some(item=>item.path==='/metadata/resourceVersion'&&item.value===String(state.generation)))throw new Error('Concurrency precondition failed.');
    for(const entry of patch){
      if(entry.path==='/spec/template/metadata/annotations')state.restartMarker=entry.value['sentinela.dev/operation-id'];
      if(entry.path==='/spec/replicas')state.replicas=entry.value;
    }
    state.kubeHealthy=true;state.generation++;state.kubeCalls++;await writeFile(filename,JSON.stringify(state));
    console.log('deployment.apps/contract-workload');
  }else if(args.includes('deployment/contract-workload'))console.log(JSON.stringify({kind:'Deployment',metadata:{name:'contract-workload',namespace:'contract-test',uid:'test-deployment',generation:state.generation,resourceVersion:String(state.generation)},spec:{replicas:state.replicas,selector:{matchLabels:{app:'contract-test'}},template:{metadata:{annotations:{'sentinela.dev/operation-id':state.restartMarker}}}},status:{observedGeneration:state.generation,replicas:state.replicas,readyReplicas:state.kubeHealthy?state.replicas:0,availableReplicas:state.kubeHealthy?state.replicas:0,updatedReplicas:state.replicas}}));
  else if(args.includes('replicasets'))console.log(JSON.stringify({items:[{metadata:{uid:'test-rs',ownerReferences:[{uid:'test-deployment',controller:true}]}}]}));
  else if(args.includes('pods'))console.log(JSON.stringify({items:Array.from({length:state.replicas},(_,index)=>({metadata:{name:'contract-pod-'+index,uid:'pod-'+index,ownerReferences:[{uid:'test-rs',controller:true}]},status:{containerStatuses:[{name:'app',ready:state.kubeHealthy,state:state.kubeHealthy?{running:{}}:{waiting:{reason:'CrashLoopBackOff'}},lastState:state.kubeHealthy?{}:{terminated:{reason:'OOMKilled'}}}]}}))}));
  else console.log(JSON.stringify({items:[]}));
}
