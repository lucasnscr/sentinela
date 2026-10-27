import {randomUUID} from 'node:crypto';
import {migrate,pool,openIncident} from '../../../lib/db';
import {renderProposal} from '../../../lib/sdlc/proposal';
import type {RemediationCase,SdlcSettings} from '../../../lib/sdlc/types';
export async function caseFixture(){
  await migrate();const id=randomUUID(),service='case-'+id;
  const settings:SdlcSettings={enabled:true,repository:'example/catalog',environment:'test',services:[service],githubTokenEnv:'UNUSED',verifyTimeoutMs:30000};
  const {incident}=await openIncident(service,'test','Synthetic correction',id);
  const item:RemediationCase={...renderProposal({id,incidentId:incident.id,repository:settings.repository,service,environment:'test',kind:'application',summary:'Synthetic reviewed correction',acceptanceCriteria:['Restore application behavior'],evidence:[]}),state:'issue_open',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issueNumber:1,issueUrl:null,pullRequestNumber:null,implementationSha:null,commitSha:null,artifactDigest:null,deploymentId:null,verificationStartedAt:null,verificationDeadline:null,lastSampleAt:null,healthySamples:0,result:null};
  await pool.query('INSERT INTO remediation_cases(id,incident_id,state,payload) VALUES($1,$2,$3,$4)',[id,incident.id,item.state,JSON.stringify(item)]);
  return {item,settings,async cleanup(){await pool.query('DELETE FROM sdlc_receipts WHERE case_id IN(SELECT id FROM remediation_cases WHERE incident_id=$1)',[incident.id]);await pool.query('DELETE FROM remediation_cases WHERE incident_id=$1',[incident.id]);await pool.query('DELETE FROM events WHERE incident_id=$1',[incident.id]);await pool.query('DELETE FROM incidents WHERE id=$1',[incident.id]);}};
}
