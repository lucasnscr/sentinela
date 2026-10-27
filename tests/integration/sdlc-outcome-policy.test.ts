import {after,test} from 'node:test';import assert from 'node:assert/strict';
import {pool} from '../../lib/db';import {getCase,saveCase} from '../../lib/sdlc/store';import {caseFixture} from './helpers/sdlc';import {parsePolicy,policyHash,type RecoveryCheck} from '../../lib/sdlc/recovery-policy';import {verifySdlcCases,canCloseSdlcIncident} from '../../worker/sdlc/verification';import {acceptLifecycleEvent} from '../../lib/sdlc/events';import {protocol} from '../../contracts/sdlc-v1.mjs';
after(()=>pool.end());
async function policyFixture(){const f=await caseFixture(),start=Date.now()-10000;const policy=parsePolicy({version:'business-v1',stabilityMs:4000,maxSampleGapMs:2000,probes:[{id:'catalog-data',kind:'data',url:'http://127.0.0.1:1/products',assertions:[{pointer:'/sku',op:'equals',value:'REF-1'}]}],rollbackProbes:[{id:'old-business',kind:'business',url:'http://127.0.0.1:1/old'}]});
 f.item.state='verifying';f.item.commitSha='a'.repeat(40);f.item.deploymentId='release-1';f.item.verificationStartedAt=new Date(start).toISOString();f.item.verificationDeadline=new Date(start+100000).toISOString();f.item.recoveryPolicy=policy;f.item.recoveryPolicyHash=policyHash(policy);await saveCase(f.item);
 let clock=start,passed=true;const tick=async(ms:number)=>{clock=start+ms;await verifySdlcCases([{service:f.item.service,environment:'test',at:new Date(clock).toISOString(),source:'prometheus',requests:10,rpm:100,p95:20,errorRate:0,saturation:0}],{policyProvider:()=>policy,now:()=>clock,probeRunner:async probes=>probes.map(p=>({id:p.id,kind:p.kind,passed,reason:passed?'ok':'assertion',at:new Date(clock).toISOString()}))});return (await getCase(f.item.id))!;};
 return {...f,policy,start,tick,setPassed:(value:boolean)=>{passed=value;}};
}
test('três amostras e duplicatas não substituem a janela; dado errado reinicia a sequência',async()=>{
 const f=await policyFixture();try{
  assert.equal((await f.tick(1000)).state,'verifying');await f.tick(2000);assert.equal((await f.tick(3000)).healthySamples,3);assert.equal((await f.tick(3000)).state,'verifying');assert.equal(await canCloseSdlcIncident(f.item.incidentId),false);
  f.setPassed(false);assert.equal((await f.tick(4000)).healthySamples,0);f.setPassed(true);
  for(const time of [5000,6000,7000,8000])assert.equal((await f.tick(time)).state,'verifying');
  const verified=await f.tick(9000);assert.equal(verified.state,'verified');assert.equal(verified.lastRecoveryCheck?.stableForMs,4000);assert.equal(await canCloseSdlcIncident(f.item.incidentId),true);
 }finally{await f.cleanup();}
});
test('lacuna reinicia estabilidade e rollback usa critérios independentes',async()=>{
 const f=await policyFixture();try{
  await f.tick(1000);await f.tick(2000);const gap=await f.tick(5000);assert.equal(gap.healthySamples,1);assert.equal(gap.lastRecoveryCheck?.stableForMs,0);
  const item=(await getCase(f.item.id))!;item.state='rollback_verifying';item.rollbackStartedAt=new Date(f.start).toISOString();item.rollbackDeadline=new Date(f.start+100000).toISOString();await saveCase(item);
  for(const time of [6000,7000,8000,9000,10000])await f.tick(time);
  const rolled=(await getCase(item.id))!;assert.equal(rolled.state,'rolled_back');assert.equal(rolled.lastRecoveryCheck?.checks[0].id,'old-business');assert.notEqual(rolled.state,'verified');
 }finally{await f.cleanup();}
});
test('alterar política e exceder prazo impedem certificação mesmo com três amostras',async()=>{
 const f=await policyFixture();try{
  await f.tick(1000);await f.tick(2000);
  await verifySdlcCases([],{policyProvider:()=>parsePolicy({...f.policy,version:'business-v2'}),now:()=>f.start+3000});assert.equal((await getCase(f.item.id))?.state,'regressed');
  const item=(await getCase(f.item.id))!;item.state='verifying';item.healthySamples=2;item.healthySince=new Date(f.start).toISOString();item.verificationDeadline=new Date(f.start+3000).toISOString();await saveCase(item);
  assert.equal((await f.tick(3000)).state,'regressed');
 }finally{await f.cleanup();}
});
test('resultado de probe não sobrescreve rollback concorrente e não mantém lock durante I/O',async()=>{
 const f=await policyFixture();try{
  let called=false;await verifySdlcCases([{service:f.item.service,environment:'test',at:new Date(f.start+1000).toISOString(),source:'prometheus',requests:10,rpm:100,p95:20,errorRate:0,saturation:0}],{policyProvider:()=>f.policy,now:()=>f.start+1000,probeRunner:async probes=>{
   const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='500ms'");const row=await client.query('SELECT state,payload FROM remediation_cases WHERE id=$1 FOR UPDATE',[f.item.id]);const item=row.rows[0].payload;item.state='rollback_verifying';item.rollbackStartedAt=new Date(f.start+500).toISOString();await client.query("UPDATE remediation_cases SET state='rollback_verifying',payload=$2 WHERE id=$1",[f.item.id,JSON.stringify(item)]);await client.query('COMMIT');called=true;}finally{client.release();}
   return probes.map(p=>({id:p.id,kind:p.kind,passed:true,reason:'ok',at:new Date(f.start+1000).toISOString()}));
  }});assert.equal(called,true);assert.equal((await getCase(f.item.id))?.state,'rollback_verifying');assert.equal((await getCase(f.item.id))?.healthySamples,0);
 }finally{await f.cleanup();}
});
test('deploy recusa política diferente da proposta revisada',async()=>{
 const f=await policyFixture();try{
  f.item.state='pr_open';f.item.pullRequestNumber=2;await saveCase(f.item);
  await assert.rejects(acceptLifecycleEvent({protocol,type:'deployment.started',id:'policy:'+f.item.id,at:new Date().toISOString(),caseId:f.item.id,proposalHash:f.item.proposalHash,repository:f.item.repository,service:f.item.service,environment:'test',issueNumber:1,pullRequestNumber:2,commitSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),deploymentId:'new'},f.settings),/Política mudou/);
 }finally{await f.cleanup();}
});
test('mudança de política durante I/O é conferida novamente antes da certificação',async()=>{
 const f=await policyFixture();try{
  let active=f.policy;await verifySdlcCases([{service:f.item.service,environment:'test',at:new Date(f.start+1000).toISOString(),source:'prometheus',requests:10,rpm:100,p95:20,errorRate:0,saturation:0}],{policyProvider:()=>active,now:()=>f.start+1000,probeRunner:async probes=>{active=parsePolicy({...f.policy,version:'new-reviewed-version'});return probes.map(p=>({id:p.id,kind:p.kind,passed:true,reason:'ok',at:new Date(f.start+1000).toISOString()}));}});
  const item=(await getCase(f.item.id))!;assert.equal(item.state,'regressed');assert.equal(item.lastRecoveryCheck?.policyChanged,true);
 }finally{await f.cleanup();}
});
test('proposta captura política e critério de dados; mudança exige outro hash revisado',async()=>{
 const f=await policyFixture(),previous=process.env.SDLC_RECOVERY_POLICIES_JSON;try{
  const {createSdlc}=await import('../../worker/sdlc');f.item.state='proposed';await saveCase(f.item);
  process.env.SDLC_RECOVERY_POLICIES_JSON=JSON.stringify([{service:f.item.service,environment:'test',policy:f.policy}]);const service=await createSdlc(f.settings);
  const input={incidentId:f.item.incidentId,kind:'application',summary:'Corrigir listagem e os dados de referência',acceptanceCriteria:['Confirmar dados e janela estável'],evidenceIds:[]};
  const first=await service.propose(input);assert.equal(first.recoveryPolicyHash,policyHash(f.policy));assert.match(first.proposalBody,/\/sku equals "REF-1"/);
  process.env.SDLC_RECOVERY_POLICIES_JSON=JSON.stringify([{service:f.item.service,environment:'test',policy:{...f.policy,version:'business-v2'}}]);const updated=await service.propose(input);assert.notEqual(updated.proposalHash,first.proposalHash);await assert.rejects(service.publish(updated.id,first.proposalHash),/revisada/);
 }finally{if(previous===undefined)delete process.env.SDLC_RECOVERY_POLICIES_JSON;else process.env.SDLC_RECOVERY_POLICIES_JSON=previous;await f.cleanup();}
});
