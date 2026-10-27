import {pool} from '../../lib/db';
import {fromCaseRow} from '../../lib/sdlc/store';
import {isHealthy} from '../../lib/detection';
import {policyFor,policyHash,technicalPolicy,type RecoveryPolicy,type RecoveryProbe,type RecoveryCheck} from '../../lib/sdlc/recovery-policy';
import {runProbes} from './probes';
import type {Metric} from '../../lib/domain';
import type {RemediationCase} from '../../lib/sdlc/types';
type Options={policyProvider?:(service:string,environment:string)=>RecoveryPolicy;probeRunner?:(probes:RecoveryProbe[])=>Promise<RecoveryCheck[]>;now?:()=>number};
const identity=(item:RemediationCase)=>JSON.stringify([item.state,item.deploymentId,item.commitSha,item.artifactDigest,item.verificationStartedAt,item.rollbackStartedAt,item.recoveryPolicyHash]);
export async function verifySdlcCases(metrics:Metric[],{policyProvider=policyFor,probeRunner=runProbes,now=Date.now}:Options={}){
 const pending=await pool.query("SELECT state,payload FROM remediation_cases WHERE state IN ('verifying','rollback_verifying') ORDER BY updated_at LIMIT 50");
 // Network I/O happens before acquiring any case lock. Apply only to the same phase/deploy.
 for(const row of pending.rows){
  const snapshot=fromCaseRow(row),rollback=snapshot.state==='rollback_verifying',policy=snapshot.recoveryPolicy||technicalPolicy(),hash=snapshot.recoveryPolicyHash||policyHash(technicalPolicy());
  let changed=false;try{changed=policyHash(policyProvider(snapshot.service,snapshot.environment))!==hash||policyHash(policy)!==hash;}catch{changed=true;}
  const metric=metrics.find(m=>m.service===snapshot.service&&m.environment===snapshot.environment&&m.source==='prometheus');
  const start=rollback?snapshot.rollbackStartedAt!:snapshot.verificationStartedAt!,deadline=rollback?snapshot.rollbackDeadline!:snapshot.verificationDeadline!;
  const last=rollback?snapshot.lastRollbackSampleAt:snapshot.lastSampleAt,metricTime=metric?Date.parse(metric.at):NaN,age=now()-metricTime;
  const probes=rollback?policy.rollbackProbes:policy.probes;
  const checks=!changed&&now()<Date.parse(deadline)&&metric&&age>=0&&age<20000&&metricTime>Math.max(Date.parse(start),Date.parse(last||start))&&isHealthy(metric)?await probeRunner(probes):[];
  const client=await pool.connect();try{
   await client.query('BEGIN');const current=await client.query('SELECT state,payload FROM remediation_cases WHERE id=$1 FOR UPDATE',[snapshot.id]);
   if(!current.rows[0]){await client.query('COMMIT');continue;}const item=fromCaseRow(current.rows[0]);
   if(identity(item)!==identity(snapshot)){await client.query('COMMIT');continue;}
   try{changed=changed||policyHash(policyProvider(item.service,item.environment))!==hash;}catch{changed=true;}
   let observed=false;
   let samples=rollback?(item.rollbackSamples||0):item.healthySamples,since=(rollback?item.rollbackHealthySince:item.healthySince)||null;
   const previous=rollback?item.lastRollbackSampleAt:item.lastSampleAt,clock=now(),currentAge=clock-metricTime;
   let stableFor=item.lastRecoveryCheck?.stableForMs||0;
   if(!metric||!Number.isFinite(currentAge)||currentAge<0||currentAge>=20000){samples=0;since=null;stableFor=0;observed=true;}
   else if(metricTime>Math.max(Date.parse(start),Date.parse(previous||start))){
    observed=true;
    if(previous&&metricTime-Date.parse(previous)>policy.maxSampleGapMs){samples=0;since=null;}
    const healthy=isHealthy(metric)&&checks.length===probes.length&&probes.every(p=>checks.some(c=>c.id===p.id&&c.kind===p.kind&&c.passed&&Date.parse(c.at)>=metricTime&&clock-Date.parse(c.at)>=0&&clock-Date.parse(c.at)<20000));
    if(healthy&&!changed){samples++;since=since||metric.at;stableFor=metricTime-Date.parse(since);}else{samples=0;since=null;stableFor=0;}
    if(rollback)item.lastRollbackSampleAt=metric.at;else item.lastSampleAt=metric.at;
   }
   if(changed){samples=0;since=null;stableFor=0;}
   if(rollback){item.rollbackSamples=samples;item.rollbackHealthySince=since;}else{item.healthySamples=samples;item.healthySince=since;}
   if(observed||changed)item.lastRecoveryCheck={policyHash:hash,metricAt:metric?.at||null,stableForMs:stableFor,checks,policyChanged:changed};
   if(changed||clock>=Date.parse(deadline)){
    item.state=rollback?'rollback_failed':'regressed';
    item.result=changed?'Política alterada ou inválida; recuperação exige revisão e intervenção.':rollback?'Escalonamento: rollback sem recuperação confirmada. Intervenção humana necessária.':'A recuperação não foi confirmada no prazo. Investigue ou faça rollback pelo pipeline.';
   }else if(samples>=policy.minimumSamples&&stableFor>=policy.stabilityMs){
    item.state=rollback?'rolled_back':'verified';item.result=rollback?'Saúde recuperada após rollback e critérios revisados; correção permanente pendente.':`Correção verificada pela política ${policy.version}: ${samples} amostras e ${stableFor}ms estáveis, ${policy.probes.length?'com critérios de negócio/dados aprovados':'com telemetria técnica'}.`;
   }
   item.updatedAt=new Date(clock).toISOString();await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify(item)]);
   if(!['verifying','rollback_verifying'].includes(item.state)){
    if(item.state==='rollback_failed')await client.query("UPDATE incidents SET severity='critical' WHERE id=$1",[item.incidentId]);
    await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,item.state==='rollback_failed'?'escalation':'sdlc',item.state==='verified'?'Correção permanente verificada':item.state==='rolled_back'?'Recuperação após rollback confirmada':item.state==='rollback_failed'?'Rollback exige intervenção':'Correção sem recuperação confirmada',`${item.deploymentId} / ${item.commitSha}: ${item.result}`]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
export async function canCloseSdlcIncident(incidentId:string){const {rows}=await pool.query('SELECT state FROM remediation_cases WHERE incident_id=$1 ORDER BY attempt DESC LIMIT 1',[incidentId]);return !rows[0]||['verified','rolled_back'].includes(rows[0].state);}
