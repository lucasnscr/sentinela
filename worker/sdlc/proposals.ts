import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,findIncident} from '../../lib/db';
import {renderProposal} from '../../lib/sdlc/proposal';
import {fromCaseRow} from '../../lib/sdlc/store';
import {retryableStates} from '../../lib/sdlc/attempts';
import type {RemediationCase,SdlcSettings} from '../../lib/sdlc/types';
const schema=z.object({incidentId:z.uuid(),previousCaseId:z.uuid().optional(),kind:z.enum(['application','configuration']),summary:z.string().trim().min(10).max(1500),acceptanceCriteria:z.array(z.string().trim().min(5).max(300)).min(1).max(12),evidenceIds:z.array(z.string().max(150)).max(12)});
export async function prepareProposal(input:unknown,settings:SdlcSettings){
  const parsed=schema.parse(input),incident=await findIncident(parsed.incidentId);
  if(!incident||!settings.services.includes(incident.service))throw new Error('Incidente fora do escopo de integração.');
  const evidence=parsed.evidenceIds.map(id=>{const item=incident.evidence.find(value=>value.id===id);if(!item)throw new Error('Evidência não pertence ao incidente.');return {id:item.id,kind:item.kind,summary:item.title.slice(0,160)};});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT id FROM incidents WHERE id=$1 FOR UPDATE',[incident.id]);
    const {rows}=await client.query('SELECT state,payload,attempt FROM remediation_cases WHERE incident_id=$1 ORDER BY attempt DESC LIMIT 1 FOR UPDATE',[incident.id]);
    let previous:RemediationCase|null=rows[0]?fromCaseRow(rows[0]):null;
    let attempt=previous?.attempt||1,parent=previous?.previousCaseId||null;
    if(parsed.previousCaseId){
      if(!previous)throw new Error('Tentativa anterior não encontrada.');
      if(previous.repository!==settings.repository||previous.environment!==settings.environment)throw new Error('Tentativa anterior fora do escopo.');
      if(previous.id===parsed.previousCaseId){
        if(!retryableStates.includes(previous.state))throw new Error('A tentativa atual ainda não permite outra correção.');
        if(previous.state==='abandoned'&&previous.pullRequestNumber&&!previous.developmentClosedAt)throw new Error('Encerre a PR no GitHub antes de outra tentativa.');
        if(attempt>=(settings.maxAttempts||3))throw new Error('Limite de tentativas atingido; escale para o mantenedor.');
        parent=previous.id;attempt++;previous=null;
      }else if(previous.previousCaseId!==parsed.previousCaseId||previous.state!=='proposed')throw new Error('Use a tentativa mais recente como origem.');
    }else if(previous&&previous.state!=='proposed'){await client.query('COMMIT');return previous;}
    const now=new Date().toISOString();const item:RemediationCase={
      ...renderProposal({id:previous?.id||randomUUID(),incidentId:incident.id,repository:settings.repository,service:incident.service,environment:settings.environment,kind:parsed.kind,summary:parsed.summary,acceptanceCriteria:parsed.acceptanceCriteria,evidence,attempt,previousCaseId:parent}),
      state:'proposed',createdAt:previous?.createdAt||now,updatedAt:now,issueNumber:null,issueUrl:null,pullRequestNumber:null,implementationSha:null,commitSha:null,artifactDigest:null,deploymentId:null,verificationStartedAt:null,verificationDeadline:null,lastSampleAt:null,healthySamples:0,result:null,
    };
    await client.query("INSERT INTO remediation_cases(id,incident_id,state,payload,attempt,previous_case_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=now() WHERE remediation_cases.state='proposed'",[item.id,incident.id,item.state,JSON.stringify(item),attempt,parent]);
    await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[incident.id,'sdlc','Proposta de correção preparada',`Tentativa ${attempt}; exige revisão própria antes de publicar.`]);
    await client.query('COMMIT');return item;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
