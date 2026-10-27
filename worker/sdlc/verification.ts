import {pool} from '../../lib/db';
import {fromCaseRow} from '../../lib/sdlc/store';
import {isHealthy} from '../../lib/detection';
import type {Metric} from '../../lib/domain';
export async function verifySdlcCases(metrics:Metric[]){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query("SELECT state,payload FROM remediation_cases WHERE state IN ('verifying','rollback_verifying') FOR UPDATE");
    for(const row of rows){
      const item=fromCaseRow(row),metric=metrics.find(value=>value.service===item.service&&value.environment===item.environment&&value.source==='prometheus');
      const rollback=item.state==='rollback_verifying';
      const started=rollback?item.rollbackStartedAt!:item.verificationStartedAt!;
      const last=rollback?item.lastRollbackSampleAt:item.lastSampleAt;
      const deadline=rollback?item.rollbackDeadline!:item.verificationDeadline!;
      const boundary=Math.max(Date.parse(started),Date.parse(last||started));
      let samples=rollback?(item.rollbackSamples||0):item.healthySamples;
      const age=metric?Date.now()-Date.parse(metric.at):NaN;
      if(!Number.isFinite(age)||age<0||age>=20000)samples=0;
      else if(metric&&Date.parse(metric.at)>boundary){
        if(rollback)item.lastRollbackSampleAt=metric.at;else item.lastSampleAt=metric.at;
        samples=isHealthy(metric)?samples+1:0;
      }
      if(rollback)item.rollbackSamples=samples;else item.healthySamples=samples;
      if(Date.now()>=Date.parse(deadline)){
        item.state=rollback?'rollback_failed':'regressed';
        item.result=rollback?'Escalonamento: rollback sem recuperação confirmada. Intervenção humana necessária.':'A recuperação não foi confirmada no prazo. Investigue ou faça rollback pelo pipeline.';
      }else if(samples>=3){item.state=rollback?'rolled_back':'verified';item.result=rollback?'Saúde recuperada após rollback; a correção permanente continua pendente.':'Correção verificada: três novas amostras saudáveis após o deploy identificado.';}
      item.updatedAt=new Date().toISOString();
      await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify(item)]);
      if(!['verifying','rollback_verifying'].includes(item.state)){
        if(item.state==='rollback_failed')await client.query("UPDATE incidents SET severity='critical' WHERE id=$1",[item.incidentId]);
        await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,item.state==='rollback_failed'?'escalation':'sdlc',item.state==='verified'?'Correção permanente verificada':item.state==='rolled_back'?'Recuperação após rollback confirmada':item.state==='rollback_failed'?'Rollback exige intervenção':'Correção sem recuperação confirmada',`${item.deploymentId} / ${item.commitSha}: ${item.result}`]);
      }
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
