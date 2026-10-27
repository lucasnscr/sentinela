import {policyFor,policyHash,technicalPolicy} from './recovery-policy';
import {isDeepStrictEqual} from 'node:util';
import {validateEvent,developmentTypes} from '../../contracts/sdlc-v1.mjs';
import {pool,event as audit} from '../db';
import {sdlcSettings} from './configuration';
import {fromCaseRow} from './store';
import type {SdlcSettings} from './types';
import {isCurrentAttempt} from './attempts';
import {applyDevelopmentOutcome,staleCi} from './development';
export async function acceptLifecycleEvent(input:unknown,settings:SdlcSettings=sdlcSettings()){
  if(!settings.enabled)throw new Error('Integração SDLC desabilitada.');
  const message=validateEvent(input);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query('SELECT state,payload FROM remediation_cases WHERE id=$1 FOR UPDATE',[message.caseId]);
    if(!rows[0])throw new Error('Caso não encontrado.');const item=fromCaseRow(rows[0]);
    if(message.repository!==item.repository||message.repository!==settings.repository||message.issueNumber!==item.issueNumber||message.proposalHash!==item.proposalHash||message.service!==item.service||message.environment!==item.environment)throw new Error('Identidade da mudança não corresponde ao caso.');
    const previous=await client.query('SELECT payload FROM sdlc_receipts WHERE id=$1',[message.id]);
    if(previous.rows.length){const {at:_old,...old}=previous.rows[0].payload;const {at:_new,...current}=message;if(!isDeepStrictEqual(old,current))throw new Error('ID de evento reutilizado com outro conteúdo.');await client.query('COMMIT');return {...item,receiptReplayed:true};}
    if(!await isCurrentAttempt(item,client))throw new Error('A tentativa foi substituída; consulte o caso atual.');
    if(developmentTypes.includes(message.type))applyDevelopmentOutcome(item,message);
    else if(message.type==='implementation.published'){
      if(!['issue_open','pr_open','ci_failed','implementation_failed'].includes(item.state))throw new Error('Evento de implementação fora de ordem.');
      if(item.pullRequestNumber&&item.pullRequestNumber!==message.pullRequestNumber)throw new Error('A PR vinculada não pode ser trocada.');
      if(!staleCi(item,message)){item.state='pr_open';item.pullRequestNumber=message.pullRequestNumber;item.implementationSha=message.commitSha;item.result='PR e CI atual vinculadas; entrega depende do mantenedor.';}
    }else{
      if(item.pullRequestNumber!==message.pullRequestNumber||!('deploymentId' in message))throw new Error('PR/deploy não corresponde ao caso.');
      if(message.type==='deployment.started'){
        if(item.state!=='pr_open')throw new Error('Deploy fora de ordem.');
        if(policyHash(policyFor(item.service,item.environment))!==(item.recoveryPolicyHash||policyHash(technicalPolicy())))throw new Error('Política mudou; prepare outra tentativa com revisão atual.');
        item.state='deploying';item.commitSha=message.commitSha;item.artifactDigest=message.artifactDigest;
        item.deploymentId=message.deploymentId;item.healthySamples=0;item.lastSampleAt=null;item.healthySince=null;
      }else{
        if(item.commitSha!==message.commitSha||item.artifactDigest!==message.artifactDigest||item.deploymentId!==message.deploymentId)throw new Error('SHA, artefato ou deploy divergente.');
        if(message.type==='deployment.completed'){
          if(!['deploying','deployment_uncertain'].includes(item.state))throw new Error('Conclusão de deploy fora de ordem.');
          item.state='verifying';item.verificationStartedAt=new Date().toISOString();item.verificationDeadline=new Date(Date.now()+settings.verifyTimeoutMs).toISOString();
          item.result='Deploy recebido; aguardando amostras novas e critérios de recuperação revisados.';
        }else if(message.type==='deployment.rolled_back'){
          if(!['deploying','deployment_uncertain','verifying','regressed','verified'].includes(item.state))throw new Error('Rollback fora de ordem.');
          item.state='rollback_verifying';item.rollbackStartedAt=new Date().toISOString();item.rollbackDeadline=new Date(Date.now()+settings.verifyTimeoutMs).toISOString();item.rollbackSamples=0;item.lastRollbackSampleAt=null;item.rollbackHealthySince=null;
          item.result='Rollback recebido; aguardando novas observações da aplicação. A correção permanece não verificada.';
        }else if(message.type==='deployment.rollback_failed'){
          if(!['deploying','deployment_uncertain','verifying','regressed','verified','rollback_verifying'].includes(item.state))throw new Error('Falha de rollback fora de ordem.');
          item.state='rollback_failed';item.result='Escalonamento: pipeline não confirmou o rollback. Intervenção humana necessária.';
          await client.query("UPDATE incidents SET severity='critical' WHERE id=$1",[item.incidentId]);
          await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,'escalation','Rollback não confirmado',item.result]);
        }else{
          if(!['deploying','deployment_uncertain','verifying'].includes(item.state))throw new Error('Falha de deploy fora de ordem.');
          item.state='deployment_uncertain';item.result='Estado da entrega não confirmado. Confira o provedor antes de outra mutação.';
        }
      }
    }
    item.updatedAt=new Date().toISOString();
    await client.query('INSERT INTO sdlc_receipts(id,case_id,payload) VALUES($1,$2,$3)',[message.id,item.id,JSON.stringify(message)]);
    if(message.type.startsWith('deployment.'))await client.query("INSERT INTO evidence(id,kind,service,title,detail,data) VALUES($1,'change',$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",['sdlc:'+message.id,item.service,'Deploy corretivo: '+message.type,`${item.repository} / PR #${item.pullRequestNumber} / ${item.commitSha}`,JSON.stringify(message)]);
    await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify(item)]);
    await client.query('COMMIT');await audit('sdlc','Mudança recebida do pipeline',message.type+' / '+message.commitSha,item.incidentId);return {...item,receiptReplayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
