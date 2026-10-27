import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../../lib/db';
import {createSdlc} from '../../worker/sdlc';
import {getCase,saveCase} from '../../lib/sdlc/store';
import {acceptLifecycleEvent} from '../../lib/sdlc/events';
import {protocol} from '../../contracts/sdlc-v1.mjs';
import {caseFixture} from './helpers/sdlc';
after(()=>pool.end());
const proposal=(incidentId:string,previousCaseId:string)=>({incidentId,previousCaseId,kind:'application',summary:'Nova hipótese revisada após rollback.',acceptanceCriteria:['Adicionar regressão e confirmar recuperação.'],evidenceIds:[]});
test('tentativas concorrentes preservam pai e criam uma única proposta revisável',async()=>{
  const f=await caseFixture();const service=await createSdlc(f.settings,{find:async()=>null,create:async()=>({number:2,url:'https://github.com/example/catalog/issues/2'})});
  try{
    f.item.state='rolled_back';f.item.rollbackStartedAt=new Date().toISOString();f.item.pullRequestNumber=10;await saveCase(f.item);
    const input=proposal(f.item.incidentId,f.item.id),[a,b]=await Promise.all([service.propose(input),service.propose(input)]);
    assert.equal(a.id,b.id);assert.equal(a.attempt,2);assert.equal(a.previousCaseId,f.item.id);assert.equal(a.state,'proposed');assert.notEqual(a.proposalHash,f.item.proposalHash);
    assert.equal((await getCase(f.item.id))?.pullRequestNumber,10);
    await assert.rejects(service.publish(a.id,f.item.proposalHash),/revisada/);await service.publish(a.id,a.proposalHash);
    const {rows}=await pool.query('SELECT id FROM remediation_cases WHERE incident_id=$1',[f.item.incidentId]);assert.equal(rows.length,2);
    await assert.rejects(service.propose(input),/mais recente/);
  }finally{await f.cleanup();}
});
test('tentativa ativa e limite de política impedem outra correção',async()=>{
  const f=await caseFixture(),service=await createSdlc({...f.settings,maxAttempts:1});try{
    await assert.rejects(service.propose(proposal(f.item.incidentId,f.item.id)),/ainda não permite/);
    f.item.state='rollback_failed';await saveCase(f.item);await assert.rejects(service.propose(proposal(f.item.incidentId,f.item.id)),/Limite/);
  }finally{await f.cleanup();}
});
test('eventos de tentativa substituída são recusados; recibos antigos só retornam histórico',async()=>{
  const f=await caseFixture(),service=await createSdlc(f.settings);try{
    const message={protocol,id:'first:'+f.item.id,type:'implementation.published',at:new Date().toISOString(),caseId:f.item.id,proposalHash:f.item.proposalHash,repository:f.item.repository,service:f.item.service,environment:'test',issueNumber:1,pullRequestNumber:10,commitSha:'a'.repeat(40)};
    await acceptLifecycleEvent(message,f.settings);const parent=(await getCase(f.item.id))!;parent.state='regressed';await saveCase(parent);
    const child=await service.propose(proposal(parent.incidentId,parent.id));
    assert.equal((await acceptLifecycleEvent(message,f.settings)).receiptReplayed,true);
    await assert.rejects(acceptLifecycleEvent({...message,id:'late:'+parent.id,commitSha:'b'.repeat(40)},f.settings),/substituída/);
    assert.equal((await getCase(child.id))?.state,'proposed');
  }finally{await f.cleanup();}
});
