import {pool,event} from '../../lib/db';
import {sdlcSettings} from '../../lib/sdlc/configuration';
import {getCase,fromCaseRow,saveCase} from '../../lib/sdlc/store';
import type {RemediationCase,SdlcSettings} from '../../lib/sdlc/types';
import {githubIssues,type IssueClient} from './github';
import {prepareProposal} from './proposals';
export async function createSdlc(settings:SdlcSettings=sdlcSettings(),issues:IssueClient=githubIssues(settings)){
  if(settings.enabled)await pool.query("UPDATE remediation_cases SET state='publish_uncertain' WHERE state='publishing'");
  function enabled(){if(!settings.enabled)throw new Error('Integração SDLC desabilitada.');}
  async function bind(item:RemediationCase,issue:{number:number;url:string}){
    item.state='issue_open';item.issueNumber=issue.number;item.issueUrl=issue.url;item.result='Issue publicada sem autorizar implementação. O mantenedor controla ai:ready e o agente.';
    await saveCase(item);await event('sdlc','Issue de correção vinculada',issue.url,item.incidentId);return item;
  }
  return {
    async propose(input:unknown){enabled();return prepareProposal(input,settings);},
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
