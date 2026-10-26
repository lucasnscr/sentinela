import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {migrate,pool,openIncident} from '../../lib/db';
import {getCase,saveCase} from '../../lib/sdlc/store';
import {verifySdlcCases} from '../../worker/sdlc/verification';
import type {RemediationCase} from '../../lib/sdlc/types';
import type {Metric} from '../../lib/domain';
after(async()=>{await pool.end();});
async function fixture(){
  await migrate();const id=randomUUID(),service='freshness-'+id;
  const {incident}=await openIncident(service,'staging','Synthetic recovery',id);
  const item:RemediationCase={id,incidentId:incident.id,repository:'example/catalog',service,environment:'staging',state:'verifying',kind:'application',summary:'Synthetic recovery',acceptanceCriteria:[],evidence:[],proposalHash:'a'.repeat(64),proposalBody:'test',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issueNumber:1,issueUrl:null,pullRequestNumber:2,implementationSha:'b'.repeat(40),commitSha:'c'.repeat(40),artifactDigest:'sha256:'+'d'.repeat(64),deploymentId:'test',verificationStartedAt:new Date(Date.now()-10000).toISOString(),verificationDeadline:new Date(Date.now()+30000).toISOString(),lastSampleAt:null,healthySamples:2,result:null};
  await pool.query('INSERT INTO remediation_cases(id,incident_id,state,payload) VALUES($1,$2,$3,$4)',[id,incident.id,item.state,JSON.stringify(item)]);
  const metric={service,environment:'staging',at:new Date().toISOString(),errorRate:0,p95:20,rpm:100,saturation:0,requests:20,source:'prometheus'} as Metric;
  return {item,metric,async cleanup(){await pool.query('DELETE FROM remediation_cases WHERE id=$1',[id]);await pool.query('DELETE FROM events WHERE incident_id=$1',[incident.id]);await pool.query('DELETE FROM incidents WHERE id=$1',[incident.id]);}};
}
for(const kind of ['absent','old','future','other-environment','laboratory'] as const)test('não confirma recuperação com telemetria '+kind,async()=>{
  const f=await fixture();try{
    const value={...f.metric,...(kind==='old'?{at:new Date(Date.now()-60000).toISOString()}:kind==='future'?{at:new Date(Date.now()+60000).toISOString()}:kind==='other-environment'?{environment:'production'}:kind==='laboratory'?{source:'laboratory' as const}:{})};
    await verifySdlcCases(kind==='absent'?[]:[value]);const actual=(await getCase(f.item.id))!;
    assert.equal(actual.state,'verifying');assert.equal(actual.healthySamples,0);
  }finally{await f.cleanup();}
});
test('uma terceira amostra após o prazo não pode transformar timeout em sucesso',async()=>{
  const f=await fixture();try{f.item.verificationDeadline=new Date(Date.now()-1).toISOString();await saveCase(f.item);await verifySdlcCases([f.metric]);assert.equal((await getCase(f.item.id))?.state,'regressed');}finally{await f.cleanup();}
});
