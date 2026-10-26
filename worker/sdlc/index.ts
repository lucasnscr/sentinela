import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,findIncident,event} from '../../lib/db';
import {sdlcSettings} from '../../lib/sdlc/configuration';
import {renderProposal} from '../../lib/sdlc/proposal';
import {getCase,fromCaseRow,saveCase} from '../../lib/sdlc/store';
import type {RemediationCase,SdlcSettings} from '../../lib/sdlc/types';
import {githubIssues,type IssueClient} from './github';
const proposal=z.object({incidentId:z.uuid(),kind:z.enum(['application','configuration']),summary:z.string().trim().min(10).max(1500),acceptanceCriteria:z.array(z.string().trim().min(5).max(300)).min(1).max(12),evidenceIds:z.array(z.string().max(150)).max(12)});
export async function createSdlc(settings:SdlcSettings=sdlcSettings(),issues:IssueClient=githubIssues(settings)){
  if(settings.enabled)await pool.query("UPDATE remediation_cases SET state='publish_uncertain' WHERE state='publishing'");
  function enabled(){if(!settings.enabled)throw new Error('Integração SDLC desabilitada.');}
  async function bind(item:RemediationCase,issue:{number:number;url:string}){
    item.state='issue_open';item.issueNumber=issue.number;item.issueUrl=issue.url;item.result='Issue publicada sem autorizar implementação. O mantenedor controla ai:ready e o agente.';
    await saveCase(item);await event('sdlc','Issue de correção vinculada',issue.url,item.incidentId);return item;
  }
  return {
    async propose(input:unknown){
      enabled();const parsed=proposal.parse(input),incident=await findIncident(parsed.incidentId);
      if(!incident||!settings.services.includes(incident.service))throw new Error('Incidente fora do escopo de integração.');
      const old=await pool.query('SELECT state,payload FROM remediation_cases WHERE incident_id=$1',[incident.id]);const previous=old.rows[0]?fromCaseRow(old.rows[0]):null;if(previous&&previous.state!=='proposed')return previous;
      const evidence=parsed.evidenceIds.map(id=>{const item=incident.evidence.find(value=>value.id===id);if(!item)throw new Error('Evidência não pertence ao incidente.');return {id:item.id,kind:item.kind,summary:item.title.slice(0,160)};});
      const now=new Date().toISOString();const item:RemediationCase={
        ...renderProposal({id:previous?.id||randomUUID(),incidentId:incident.id,repository:settings.repository,service:incident.service,environment:settings.environment,kind:parsed.kind,summary:parsed.summary,acceptanceCriteria:parsed.acceptanceCriteria,evidence}),
        state:'proposed',createdAt:previous?.createdAt||now,updatedAt:now,issueNumber:null,issueUrl:null,pullRequestNumber:null,implementationSha:null,commitSha:null,artifactDigest:null,deploymentId:null,verificationStartedAt:null,verificationDeadline:null,lastSampleAt:null,healthySamples:0,result:null,
      };
      const {rows}=await pool.query("INSERT INTO remediation_cases(id,incident_id,state,payload) VALUES($1,$2,$3,$4) ON CONFLICT(incident_id) DO UPDATE SET payload=excluded.payload,updated_at=now() WHERE remediation_cases.state='proposed' AND remediation_cases.id=excluded.id RETURNING id",[item.id,incident.id,item.state,JSON.stringify(item)]);
      if(!rows.length){const existing=await pool.query('SELECT state,payload FROM remediation_cases WHERE incident_id=$1',[incident.id]);return fromCaseRow(existing.rows[0]);}
      await event('sdlc','Proposta de correção preparada','Revise o conteúdo antes de publicar a issue.',incident.id);return item;
    },
    async publish(id:string,hash:string){
      enabled();const item=await getCase(id);if(!item||item.proposalHash!==hash||item.repository!==settings.repository)throw new Error('Proposta revisada não corresponde ao caso.');
      if(['issue_open','pr_open','deploying','verifying','verified'].includes(item.state))return item;
      const {rows}=await pool.query("UPDATE remediation_cases SET state='publishing' WHERE id=$1 AND state='proposed' RETURNING id",[id]);
      if(!rows.length)throw new Error('Publicação pendente de conferência; não será repetida automaticamente.');
      let attemptedCreate=false;
      try{const existing=await issues.find(item);if(existing)return await bind(item,existing);attemptedCreate=true;return await bind(item,await issues.create(item));}
      catch{item.state=attemptedCreate?'publish_uncertain':'proposed';item.result=attemptedCreate?'GitHub não confirmou a publicação. Use conferir publicação antes de tentar outro envio.':'Consulta GitHub falhou antes do envio. Confira credenciais e tente publicar novamente.';await saveCase(item);throw new Error(item.result);}
    },
    async reconcile(id:string){enabled();const item=await getCase(id);if(!item||item.state!=='publish_uncertain')throw new Error('Caso não aguarda conferência.');const found=await issues.find(item);if(!found)throw new Error('Issue não encontrada. Confira o GitHub; nenhum novo envio foi feito.');return bind(item,found);},
  };
}
