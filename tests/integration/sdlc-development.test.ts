import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../../lib/db';
import {getCase,saveCase} from '../../lib/sdlc/store';
import {acceptLifecycleEvent} from '../../lib/sdlc/events';
import {cancelDevelopment,reconcileDevelopment} from '../../worker/sdlc/development';
import {createSdlc} from '../../worker/sdlc';
import {protocol} from '../../contracts/sdlc-v1.mjs';
import {caseFixture} from './helpers/sdlc';
after(()=>pool.end());
function sender(f:Awaited<ReturnType<typeof caseFixture>>){let seq=0;return (type:string,extra:Record<string,unknown>={})=>acceptLifecycleEvent({protocol,type,id:'outcome:'+f.item.id+':'+(++seq),at:new Date().toISOString(),caseId:f.item.id,proposalHash:f.item.proposalHash,repository:f.item.repository,service:f.item.service,environment:'test',issueNumber:1,pullRequestNumber:2,commitSha:'a'.repeat(40),executionId:'gha-1',reason:type==='pull_request.closed'?'closed_without_merge':type.endsWith('cancelled')?'cancelled':'failure',...extra},f.settings);}
test('CI falha, retoma com execução nova e ignora execução antiga; encerramento é terminal',async()=>{
 const f=await caseFixture(),send=sender(f);try{
  assert.equal((await send('ci.failed',{runId:10,runAttempt:1})).state,'ci_failed');
  assert.equal((await send('implementation.published',{runId:11,runAttempt:1})).state,'pr_open');
  assert.equal((await send('ci.cancelled',{runId:10,runAttempt:2})).state,'pr_open');
  assert.equal((await send('ci.failed',{runId:11,runAttempt:2})).state,'ci_failed');
  assert.equal((await send('implementation.published',{runId:11,runAttempt:1})).state,'ci_failed');
  assert.equal((await send('pull_request.closed')).state,'cancelled');
  await assert.rejects(send('implementation.published',{runId:12,runAttempt:1}),/fora de ordem/);
  await send('ci.failed',{runId:12,runAttempt:1});assert.equal((await getCase(f.item.id))?.state,'cancelled');
 }finally{await f.cleanup();}
});
test('interrupção pré-PR e cancelamento revisado preservam limites',async()=>{
 const f=await caseFixture(),send=sender(f);try{
  assert.equal((await send('implementation.failed',{pullRequestNumber:null})).state,'implementation_failed');
  await assert.rejects(cancelDevelopment(f.item.id,'b'.repeat(64),'Cancelar tentativa'),/divergente/);
  assert.equal((await cancelDevelopment(f.item.id,f.item.proposalHash,'Não prosseguir com a hipótese')).state,'cancelled');
  const service=await createSdlc(f.settings);const child=await service.propose({incidentId:f.item.incidentId,previousCaseId:f.item.id,kind:'application',summary:'Hipótese revisada pelo mantenedor',acceptanceCriteria:['Preservar API e testar regressão'],evidenceIds:[]});assert.equal(child.attempt,2);
  await assert.rejects(cancelDevelopment(f.item.id,f.item.proposalHash,'Outra solicitação'),/divergente/);
 }finally{await f.cleanup();}
});
test('abandono escala uma vez e exige encerrar PR antes de nova tentativa',async()=>{
 const f=await caseFixture(),send=sender(f);try{
  await send('implementation.published');const item=(await getCase(f.item.id))!;item.updatedAt=new Date(0).toISOString();await saveCase(item);
  await assert.rejects(cancelDevelopment(item.id,item.proposalHash,'Cancelar execução'),/Encerre a PR/);
  await reconcileDevelopment({...f.settings,inactivityTimeoutMs:1});await reconcileDevelopment({...f.settings,inactivityTimeoutMs:1});
  assert.equal((await getCase(item.id))?.state,'abandoned');
  const service=await createSdlc(f.settings);const proposal={incidentId:item.incidentId,previousCaseId:item.id,kind:'application',summary:'Nova hipótese após abandono',acceptanceCriteria:['Restaurar comportamento esperado'],evidenceIds:[]};
  await assert.rejects(service.propose(proposal),/Encerre a PR/);
  await send('pull_request.closed');assert.equal((await service.propose(proposal)).attempt,2);
  const {rows}=await pool.query("SELECT id FROM events WHERE incident_id=$1 AND kind='escalation'",[item.incidentId]);assert.equal(rows.length,1);
 }finally{await f.cleanup();}
});
test('entrega sem recibo bloqueia nova mutação; recibo exato reconcilia a verificação',async()=>{
 const f=await caseFixture(),send=sender(f);try{
  const deployment={deploymentId:'release-1',artifactDigest:'sha256:'+'b'.repeat(64)};
  await send('implementation.published');await send('deployment.started',deployment);
  const item=(await getCase(f.item.id))!;item.updatedAt=new Date(0).toISOString();await saveCase(item);
  await reconcileDevelopment({...f.settings,deploymentTimeoutMs:1});assert.equal((await getCase(item.id))?.state,'deployment_uncertain');
  await assert.rejects(send('deployment.started',deployment),/fora de ordem/);
  await assert.rejects(send('deployment.completed',{...deployment,deploymentId:'other'}),/divergente/);
  assert.equal((await send('deployment.completed',deployment)).state,'verifying');
 }finally{await f.cleanup();}
});
