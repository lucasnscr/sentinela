import {pool,event} from '../../lib/db';
import {sdlcSettings} from '../../lib/sdlc/configuration';
import {getCase} from '../../lib/sdlc/store';
import {exportLearning} from '../../lib/sdlc/learning';
import type {SdlcSettings} from '../../lib/sdlc/types';
import {githubIssues,type IssueClient} from './github';
export async function publishLearning(caseId:string,version:number,hash:string,settings:SdlcSettings=sdlcSettings(),issues:IssueClient=githubIssues(settings),reconcile=false){
 if(!settings.enabled)throw new Error('Integração desabilitada.');
 const learning=await exportLearning(caseId,version),item=await getCase(caseId);if(!item||learning.hash!==hash||item.repository!==settings.repository)throw new Error('Aprendizado divergente.');
 const marker=`<!-- sentinela-learning/v1 version=${version} case=${caseId} proposal=${hash} -->`;
 const publication={...item,proposalHash:hash,proposalBody:[marker,'',`Aprendizado aprovado v${version} do caso ${caseId}.`,`Responsável: ${learning.content.owner}. Revisor declarado: ${learning.reviewer}.`,`Commit verificado: ${learning.commitSha}.`,'','Gerar regressão, avaliação e runbook a partir da exportação autenticada. Esta issue não autoriza execução do implementador nem merge.'].join('\n')};
 if(reconcile){const found=await issues.find(publication);if(!found)throw new Error('Issue não encontrada; nenhum novo envio foi feito.');await pool.query("UPDATE sdlc_learning SET payload=jsonb_set(payload,'{delivery}',$3::jsonb) WHERE case_id=$1 AND version=$2",[caseId,version,JSON.stringify({state:'published',...found})]);return;}
 const claim=await pool.query("UPDATE sdlc_learning SET payload=jsonb_set(payload,'{delivery}', '{\"state\":\"publishing\"}') WHERE case_id=$1 AND version=$2 AND payload->'delivery'->>'state'='queued' RETURNING case_id",[caseId,version]);
 if(!claim.rows.length)return;let attempted=false;
 try{
  let found=await issues.find(publication);if(!found){attempted=true;found=await issues.create(publication,'Aprendizado revisado: '+item.service+' v'+version);}
  await pool.query("UPDATE sdlc_learning SET payload=jsonb_set(payload,'{delivery}',$3::jsonb) WHERE case_id=$1 AND version=$2",[caseId,version,JSON.stringify({state:'published',...found})]);
  await event('learning','Aprendizado encaminhado ao desenvolvimento',found.url,item.incidentId);
 }catch{
  await pool.query("UPDATE sdlc_learning SET payload=jsonb_set(payload,'{delivery}',$3::jsonb) WHERE case_id=$1 AND version=$2",[caseId,version,JSON.stringify({state:attempted?'uncertain':'queued'})]);
  throw new Error('Publicação do aprendizado não confirmada. Confira as issues no GitHub; não repita envio sem conferência.');
 }
}
