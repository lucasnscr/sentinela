import {pool} from '../db';
import {fromCaseRow} from './store';
import {isCurrentAttempt} from './attempts';
import {redactProposal} from './proposal';
import {learningProtocol,validateContent,learningIdentity,digest,validateLearning} from '../../contracts/learning-v1.mjs';
export async function listLearning(caseId:string){const {rows}=await pool.query('SELECT payload FROM sdlc_learning WHERE case_id=$1 ORDER BY version DESC',[caseId]);return rows.map(row=>row.payload);}
export async function changeLearning(caseId:string,input:any){
 const client=await pool.connect();try{
  await client.query('BEGIN');const {rows}=await client.query('SELECT state,payload FROM remediation_cases WHERE id=$1 FOR UPDATE',[caseId]);
  if(!rows[0])throw new Error('Caso não encontrado.');const item=fromCaseRow(rows[0]);
  if(item.state!=='verified'||!item.commitSha||!await isCurrentAttempt(item,client))throw new Error('Aprendizado exige correção atual verificada.');
  const latest=(await client.query('SELECT payload FROM sdlc_learning WHERE case_id=$1 ORDER BY version DESC LIMIT 1',[caseId])).rows[0]?.payload;
  if(['retry','reconcile'].includes(input.kind)){
   if(!latest||latest.state!=='approved'||latest.hash!==input.hash||latest.version!==input.version)throw new Error('Revise o aprendizado aprovado.');
   if(input.kind==='retry'&&latest.delivery?.state!=='queued')throw new Error('Confirme a publicação incerta antes de outro envio.');
   await client.query("INSERT INTO commands(id,kind,payload) VALUES(gen_random_uuid()::text,$1,$2)",[input.kind==='retry'?'sdlc_learning_publish':'sdlc_learning_reconcile',JSON.stringify({caseId,version:latest.version,hash:latest.hash})]);await client.query('COMMIT');return latest;
  }
  let next;
  if(input.kind==='propose'){
   const redact=(value:any):any=>typeof value==='string'?redactProposal(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item)])):value;
   const content=validateContent(redact(input.content));
   if(content.evidenceIds.some(id=>!item.evidence.some(e=>e.id===id)))throw new Error('Selecione evidências do caso revisado.');
   if(latest&&digest(latest.content)===digest(content)){await client.query('COMMIT');return latest;}
   const version=latest?(latest.state==='draft'?latest.version:latest.version+1):1;
   const identity=learningIdentity({protocol:learningProtocol,caseId,incidentId:item.incidentId,repository:item.repository,service:item.service,environment:item.environment,commitSha:item.commitSha,version,content});
   next={...identity,hash:digest(identity),state:'draft'};
  }else if(input.kind==='approve'){
   if(!latest||latest.hash!==input.hash||latest.version!==input.version)throw new Error('Revise o hash e a versão atuais.');
   if(typeof input.reviewer!=='string'||input.reviewer.trim().length<3||input.reviewer.length>100)throw new Error('Informe o responsável pela revisão.');
   if(latest.state==='approved'){await client.query('COMMIT');return latest;}
   next={...validateLearning({...latest,state:'approved',approvedAt:latest.approvedAt||new Date().toISOString(),reviewer:latest.reviewer||redactProposal(input.reviewer.trim())}),delivery:{state:'queued'}};
   await client.query("INSERT INTO commands(id,kind,payload,idempotency_key) VALUES(gen_random_uuid()::text,'sdlc_learning_publish',$1,$2) ON CONFLICT(idempotency_key) DO NOTHING",[JSON.stringify({caseId,version:next.version,hash:next.hash}),'learning:'+caseId+':'+next.version+':'+next.hash]);
   await client.query('INSERT INTO runbooks(id,title,service,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[`learning:${caseId}:v${next.version}`,`Incidente revisado: ${item.service} v${next.version}`,item.service,`Caso ${caseId}, commit ${item.commitSha}, responsável ${next.content.owner}, revisão ${next.reviewer}. Hash ${next.hash}\n\n${next.content.runbook}`]);
  }else throw new Error('Operação de aprendizado inválida.');
  await client.query('INSERT INTO sdlc_learning(case_id,version,state,payload) VALUES($1,$2,$3,$4) ON CONFLICT(case_id,version) DO UPDATE SET state=$3,payload=$4',[caseId,next.version,next.state,JSON.stringify(next)]);
  await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,'learning',next.state==='approved'?'Aprendizado revisado aprovado':'Aprendizado preparado para revisão',`v${next.version} / ${next.hash} / ${next.content.owner}`]);
  await client.query('COMMIT');return next;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function exportLearning(caseId:string,version:number){
 const {rows}=await pool.query("SELECT l.payload FROM sdlc_learning l JOIN remediation_cases c ON c.id=l.case_id WHERE l.case_id=$1 AND l.version=$2 AND l.state='approved' AND c.state='verified' AND NOT EXISTS(SELECT 1 FROM remediation_cases newer WHERE newer.incident_id=c.incident_id AND newer.attempt>c.attempt)",[caseId,version]);
 if(!rows[0])throw new Error('Versão aprovada e correção verificada não encontradas.');return validateLearning(rows[0].payload);
}
