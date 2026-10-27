import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../../lib/db';
import {getCase,saveCase} from '../../lib/sdlc/store';
import {acceptLifecycleEvent} from '../../lib/sdlc/events';
import {verifySdlcCases} from '../../worker/sdlc/verification';
import {protocol} from '../../contracts/sdlc-v1.mjs';
import {caseFixture} from './helpers/sdlc';
after(()=>pool.end());
async function rollbackFixture(){
  const f=await caseFixture();const base={protocol,caseId:f.item.id,proposalHash:f.item.proposalHash,repository:f.item.repository,service:f.item.service,environment:'test',issueNumber:1,pullRequestNumber:2,commitSha:'a'.repeat(40),at:new Date().toISOString()};
  const send=(type:string)=>acceptLifecycleEvent({...base,type,id:type+':'+f.item.id,...(type.startsWith('deployment.')?{deploymentId:'release-1',artifactDigest:'sha256:'+'b'.repeat(64)}:{})},f.settings);
  await send('implementation.published');await send('deployment.started');await send('deployment.completed');await send('deployment.rolled_back');
  return {...f,send};
}
test('rollback exige novas amostras independentes e nunca verifica a correção',async()=>{
  const f=await rollbackFixture();try{
    assert.equal((await getCase(f.item.id))?.state,'rollback_verifying');
    const metric={service:f.item.service,environment:'test',at:new Date(0).toISOString(),source:'prometheus' as const,requests:30,rpm:150,p95:20,errorRate:0,saturation:0};
    await verifySdlcCases([metric]);assert.equal((await getCase(f.item.id))?.rollbackSamples,0);
    for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,3));const next={...metric,at:new Date().toISOString()};await verifySdlcCases([next]);await verifySdlcCases([next]);}
    const item=(await getCase(f.item.id))!;assert.equal(item.state,'rolled_back');assert.equal(item.rollbackSamples,3);assert.notEqual(item.state,'verified');
    await f.send('deployment.rolled_back');assert.equal((await getCase(item.id))?.state,'rolled_back');
  }finally{await f.cleanup();}
});
test('rollback sem recuperação no prazo gera escalonamento único',async()=>{
  const f=await rollbackFixture();try{
    const item=(await getCase(f.item.id))!;item.rollbackDeadline=new Date(0).toISOString();await saveCase(item);
    await verifySdlcCases([]);await verifySdlcCases([]);assert.equal((await getCase(item.id))?.state,'rollback_failed');
    const {rows}=await pool.query("SELECT * FROM events WHERE incident_id=$1 AND kind='escalation'",[item.incidentId]);assert.equal(rows.length,1);
  }finally{await f.cleanup();}
});
test('falha do próprio rollback gera intervenção sem duplicar escalonamento',async()=>{
  const f=await rollbackFixture();try{
    await f.send('deployment.rollback_failed');await f.send('deployment.rollback_failed');
    assert.equal((await getCase(f.item.id))?.state,'rollback_failed');
    const {rows}=await pool.query("SELECT * FROM events WHERE incident_id=$1 AND kind='escalation'",[f.item.incidentId]);assert.equal(rows.length,1);
  }finally{await f.cleanup();}
});
