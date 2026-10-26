import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {migrate,pool,openIncident} from '../../lib/db';
import {createSdlc} from '../../worker/sdlc';
import {acceptLifecycleEvent} from '../../lib/sdlc/events';
import {verifySdlcCases} from '../../worker/sdlc/verification';
import {getCase,saveCase} from '../../lib/sdlc/store';
import {extractCase,protocol} from '../../contracts/sdlc-v1.mjs';
import type {SdlcSettings} from '../../lib/sdlc/types';
import type {Metric} from '../../lib/domain';
const settings:SdlcSettings={enabled:true,repository:'example/catalog',environment:'test',services:['test-sdlc'],githubTokenEnv:'UNUSED_TEST_KEY',verifyTimeoutMs:30000};
after(async()=>{await pool.end();});
async function fixture(){await migrate();const incident=(await openIncident('test-sdlc','test','Synthetic operational failure','sdlc-test:'+randomUUID())).incident;return {incident,async cleanup(){await pool.query('DELETE FROM sdlc_receipts WHERE case_id IN(SELECT id FROM remediation_cases WHERE incident_id=$1)',[incident.id]);await pool.query('DELETE FROM remediation_cases WHERE incident_id=$1',[incident.id]);await pool.query('DELETE FROM events WHERE incident_id=$1',[incident.id]);await pool.query('DELETE FROM incidents WHERE id=$1',[incident.id]);}};}
const proposal=(incidentId:string)=>({incidentId,kind:'application',summary:'Synthetic incident requiring a tested correction.',acceptanceCriteria:['Restore healthy application metrics.'],evidenceIds:[]});
test('proposta e publicação são distintas e resultado incerto só permite conferência',async()=>{
  const context=await fixture();let remote:{number:number;url:string}|null=null,calls=0;
  const service=await createSdlc(settings,{find:async()=>remote,create:async()=>{calls++;remote={number:11,url:'https://github.com/example/catalog/issues/11'};throw new Error('Response lost after GitHub accepted');}});
  try{
    const original=await service.propose(proposal(context.incident.id));
    const item=await service.propose({...proposal(context.incident.id),summary:'Descrição revisada antes de autorizar a publicação.'});assert.equal(item.id,original.id);assert.notEqual(item.proposalHash,original.proposalHash);assert.equal(calls,0);assert.equal(item.state,'proposed');assert.equal(extractCase(item.proposalBody)?.caseId,item.id);
    await assert.rejects(service.publish(item.id,original.proposalHash),/revisada/);assert.equal(calls,0);
    await assert.rejects(service.publish(item.id,'0'.repeat(64)),/revisada/);assert.equal(calls,0);
    await assert.rejects(service.publish(item.id,item.proposalHash),/não confirmou/);assert.equal(calls,1);
    await assert.rejects(service.publish(item.id,item.proposalHash),/conferência/);assert.equal(calls,1);
    assert.equal((await service.reconcile(item.id)).issueNumber,11);assert.equal(calls,1);
    await service.publish(item.id,item.proposalHash);assert.equal(calls,1);
  }finally{await context.cleanup();}
});
test('falha de consulta anterior ao envio permite nova tentativa sem duplicar publicação',async()=>{
  const context=await fixture();let failed=true,calls=0;
  const service=await createSdlc(settings,{find:async()=>{if(failed)throw new Error('Read denied');return null;},create:async()=>{calls++;return {number:14,url:'https://github.com/example/catalog/issues/14'};}});
  try{const item=await service.propose(proposal(context.incident.id));await assert.rejects(service.publish(item.id,item.proposalHash),/antes do envio/);assert.equal((await getCase(item.id))?.state,'proposed');failed=false;await service.publish(item.id,item.proposalHash);assert.equal(calls,1);}
  finally{await context.cleanup();}
});
test('SHA, artefato e deploy ficam vinculados; somente novas amostras verificam a correção',async()=>{
  const context=await fixture();const service=await createSdlc(settings,{find:async()=>null,create:async()=>({number:12,url:'https://github.com/example/catalog/issues/12'})});
  try{
    let item=await service.propose(proposal(context.incident.id));await service.publish(item.id,item.proposalHash);
    const base={protocol,caseId:item.id,proposalHash:item.proposalHash,repository:settings.repository,service:'test-sdlc',environment:'test',issueNumber:12,pullRequestNumber:20,commitSha:'a'.repeat(40),at:new Date().toISOString()};
    const send=(type:string,extra={})=>acceptLifecycleEvent({...base,type,id:type+':'+item.id,...extra},settings);
    await assert.rejects(send('deployment.completed',{deploymentId:'d1',artifactDigest:'sha256:'+'1'.repeat(64)}),/PR\/deploy/);
    await send('implementation.published');await send('implementation.published',{at:new Date().toISOString()});
    await assert.rejects(send('implementation.published',{commitSha:'b'.repeat(40)}),/reutilizado/);
    const release={deploymentId:'d1',artifactDigest:'sha256:'+'1'.repeat(64)};
    await send('deployment.started',release);await assert.rejects(send('deployment.completed',{...release,artifactDigest:'sha256:'+'2'.repeat(64)}),/divergente/);
    await send('deployment.completed',release);
    const old:Metric={environment:'test',service:'test-sdlc',at:new Date(0).toISOString(),errorRate:0,p95:20,rpm:100,saturation:0,requests:20,source:'prometheus'};
    await verifySdlcCases([old]);assert.equal((await getCase(item.id))?.healthySamples,0);
    await new Promise(resolve=>setTimeout(resolve,3));const first={...old,at:new Date().toISOString()};await verifySdlcCases([first]);await verifySdlcCases([first]);assert.equal((await getCase(item.id))?.healthySamples,1);
    for(let i=0;i<2;i++){await new Promise(resolve=>setTimeout(resolve,3));await verifySdlcCases([{...old,at:new Date().toISOString()}]);}
    item=(await getCase(item.id))!;assert.equal(item.state,'verified');assert.equal(item.commitSha,base.commitSha);assert.equal(item.deploymentId,'d1');
    await send('deployment.rolled_back',release);assert.equal((await getCase(item.id))?.state,'rolled_back');
  }finally{await context.cleanup();}
});
test('timeout sem dados marca regressão e rollback nunca vira correção verificada',async()=>{
  const context=await fixture();const service=await createSdlc(settings,{find:async()=>null,create:async()=>({number:13,url:'https://github.com/example/catalog/issues/13'})});
  try{
    const item=await service.propose(proposal(context.incident.id));await service.publish(item.id,item.proposalHash);
    const base={protocol,caseId:item.id,proposalHash:item.proposalHash,repository:settings.repository,service:'test-sdlc',environment:'test',issueNumber:13,pullRequestNumber:21,commitSha:'c'.repeat(40),at:new Date().toISOString()};
    const send=(type:string)=>acceptLifecycleEvent({...base,type,id:type+':'+item.id,...(type.startsWith('deployment.')?{deploymentId:'timeout-test',artifactDigest:'sha256:'+'3'.repeat(64)}:{})},settings);
    await send('implementation.published');await send('deployment.started');await send('deployment.completed');
    const waiting=(await getCase(item.id))!;waiting.verificationDeadline=new Date(0).toISOString();await saveCase(waiting);
    await verifySdlcCases([]);assert.equal((await getCase(item.id))?.state,'regressed');await send('deployment.rolled_back');assert.equal((await getCase(item.id))?.state,'rolled_back');
  }finally{await context.cleanup();}
});
