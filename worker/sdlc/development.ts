import {pool} from '../../lib/db';
import {sdlcSettings} from '../../lib/sdlc/configuration';
import {fromCaseRow} from '../../lib/sdlc/store';
import {isCurrentAttempt} from '../../lib/sdlc/attempts';
import {redactProposal} from '../../lib/sdlc/proposal';
import type {SdlcSettings} from '../../lib/sdlc/types';
export async function cancelDevelopment(id:string,hash:string,reason:string){
  const client=await pool.connect();try{
    await client.query('BEGIN');const {rows}=await client.query('SELECT state,payload FROM remediation_cases WHERE id=$1 FOR UPDATE',[id]);
    if(!rows[0])throw new Error('Caso não encontrado.');const item=fromCaseRow(rows[0]);
    if(item.proposalHash!==hash||!await isCurrentAttempt(item,client))throw new Error('Tentativa divergente.');
    if(item.state==='cancelled'){await client.query('COMMIT');return item;}
    if(item.pullRequestNumber)throw new Error('Encerre a PR no GitHub antes de cancelar esta tentativa.');
    if(!['proposed','issue_open','implementation_failed'].includes(item.state)||reason.trim().length<5||reason.length>500)throw new Error('Cancelamento não permitido neste estado.');
    item.state='cancelled';item.result='Cancelamento revisado: '+redactProposal(reason.trim());item.updatedAt=new Date().toISOString();
    await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[id,item.state,JSON.stringify(item)]);
    await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,'sdlc','Tentativa cancelada pelo operador',item.result]);await client.query('COMMIT');return item;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function reconcileDevelopment(settings:SdlcSettings=sdlcSettings()){
  if(!settings.enabled)return;const client=await pool.connect();try{
    await client.query('BEGIN');const {rows}=await client.query("SELECT state,payload FROM remediation_cases WHERE state IN ('proposed','issue_open','pr_open','ci_failed','implementation_failed','deploying') FOR UPDATE");
    for(const row of rows){const item=fromCaseRow(row);if(item.repository!==settings.repository||!await isCurrentAttempt(item,client))continue;
      const timeout=item.state==='deploying'?(settings.deploymentTimeoutMs||1200000):(settings.inactivityTimeoutMs||604800000);
      if(Date.now()-Date.parse(item.updatedAt)<timeout)continue;
      item.state=item.state==='deploying'?'deployment_uncertain':'abandoned';item.updatedAt=new Date().toISOString();
      item.result=item.state==='deployment_uncertain'?'Entrega sem confirmação; confira o provedor e reconcilie o recibo antes de outra mutação.':'Tentativa sem atividade; o mantenedor deve decidir encerramento ou nova proposta.';
      await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify(item)]);
      await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,'escalation','Ciclo SDLC exige atenção',item.result]);
    }await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
