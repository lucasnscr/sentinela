// Shared deterministic learning contract. Keep identical in both repositories.
import {createHash} from 'node:crypto';
import {caseMarker,repository} from './sdlc-v1.mjs';
export const learningProtocol='sentinela-learning/v1';
const fail=message=>{throw new Error(message);};
const text=(value,name,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max?value.trim():fail('Invalid '+name);
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Unsupported learning fields');};
const array=(value,min,max)=>Array.isArray(value)&&value.length>=min&&value.length<=max?value:fail('Invalid learning list');
export function canonical(value){return JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function validateContent(input){
  keys(input,['owner','rootCause','evidenceIds','regression','evaluation','runbook']);
  const owner=text(input.owner,'owner',3,100),rootCause=text(input.rootCause,'root cause',10,1500),runbook=text(input.runbook,'runbook',20,5000);
  const evidenceIds=[...new Set(array(input.evidenceIds,1,12).map(id=>text(id,'evidence',1,150)))];
  const r=input.regression;keys(r,['profile','seed','path','status','assertions']);if(r.profile!=='catalog-java-v1'||r.status!==200)fail('Unsupported regression profile/status');
  const seed=r.seed;keys(seed,['sku','name','price','category']);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(seed.sku||'')||!/^\d{1,8}\.\d{2}$/.test(seed.price||'')||Number(seed.price)<=0)fail('Invalid catalog fixture');
  const category=text(seed.category??'sentinela','category',1,80),name=text(seed.name,'product name',1,120),path=text(r.path,'catalog path',1,300);
  if(!/^\/api\/products(?:\?[A-Za-z0-9%_,.=&-]{1,270})?$/.test(path))fail('Only catalog read operations are supported');
  const assertions=array(r.assertions,1,8).map(a=>{
    keys(a,['pointer','equals']);if(!/^\/(?:totalElements|totalPages|content\/[0-9]{1,2}\/(?:sku|name|price|category))$/.test(a.pointer||''))fail('Unsupported assertion pointer');
    if(!['string','number','boolean'].includes(typeof a.equals)||typeof a.equals==='string'&&a.equals.length>200||typeof a.equals==='number'&&!Number.isFinite(a.equals))fail('Invalid assertion value');
    return {pointer:a.pointer,equals:a.equals};
  });
  const e=input.evaluation;keys(e,['action','causeKeywords']);if(!['observe','rollback','restore_pool','disable_latency'].includes(e.action))fail('Invalid expected action');
  const causeKeywords=array(e.causeKeywords,1,8).map(word=>text(word,'cause keyword',3,80));
  return {owner,rootCause,evidenceIds,regression:{profile:r.profile,seed:{sku:seed.sku,name,category,price:seed.price},path,status:200,assertions},evaluation:{action:e.action,causeKeywords},runbook};
}
export function learningIdentity(value){
  if(value.protocol!==learningProtocol||!Number.isSafeInteger(value.version)||value.version<1||value.version>20)fail('Invalid learning version');
  caseMarker(value.caseId,'a'.repeat(64));caseMarker(value.incidentId,'a'.repeat(64));repository(value.repository);
  if(!/^[a-f0-9]{40}$/.test(value.commitSha||'')||!['service','environment'].every(key=>/^[A-Za-z0-9_.-]{1,64}$/.test(value[key]||'')))fail('Invalid learning provenance');
  return {protocol:learningProtocol,caseId:value.caseId,incidentId:value.incidentId,repository:value.repository,service:value.service,environment:value.environment,commitSha:value.commitSha,version:value.version,content:validateContent(value.content)};
}
export function validateLearning(value){
  const item=learningIdentity(value);
  if(value.state!=='approved'||!Number.isFinite(Date.parse(value.approvedAt))||typeof value.reviewer!=='string'||value.reviewer.length<3||value.reviewer.length>100||value.hash!==digest(item))fail('Learning approval/hash not confirmed');
  return {...item,hash:value.hash,state:'approved',approvedAt:value.approvedAt,reviewer:value.reviewer};
}
export function evaluateDiagnosis(learning,response){
  const item=validateLearning(learning),expected=item.content.evaluation;
  const citations=new Set((Array.isArray(response?.hypotheses)?response.hypotheses:[]).flatMap(h=>Array.isArray(h.supportingEvidence)?h.supportingEvidence:[]));
  const checks={action:response?.action===expected.action,cause:typeof response?.cause==='string'&&expected.causeKeywords.every(word=>response.cause.toLocaleLowerCase().includes(word.toLocaleLowerCase())),evidence:item.content.evidenceIds.every(id=>citations.has(id))};
  return {rubric:'cause-action-evidence/v1',caseId:item.caseId,version:item.version,learningHash:item.hash,passed:Object.values(checks).every(Boolean),checks};
}
