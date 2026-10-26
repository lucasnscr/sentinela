import {pool,event} from '../../lib/db';
import {fromCaseRow} from '../../lib/sdlc/store';
import {isHealthy} from '../../lib/detection';
import type {Metric} from '../../lib/domain';
export async function verifySdlcCases(metrics:Metric[]){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query("SELECT state,payload FROM remediation_cases WHERE state='verifying' FOR UPDATE");
    for(const row of rows){
      const item=fromCaseRow(row),metric=metrics.find(value=>value.service===item.service&&value.environment===item.environment&&value.source==='prometheus');
      const boundary=Math.max(Date.parse(item.verificationStartedAt!),Date.parse(item.lastSampleAt||item.verificationStartedAt!));
      const age=metric?Date.now()-Date.parse(metric.at):NaN;
      if(!Number.isFinite(age)||age<0||age>=20000)item.healthySamples=0;
      else if(metric&&Date.parse(metric.at)>boundary){
        item.lastSampleAt=metric.at;item.healthySamples=isHealthy(metric)?item.healthySamples+1:0;
      }
      if(Date.now()>=Date.parse(item.verificationDeadline!)){item.state='regressed';item.result='A recuperação não foi confirmada no prazo. Investigue ou faça rollback pelo pipeline.';}
      else if(item.healthySamples>=3){item.state='verified';item.result='Correção verificada: três novas amostras saudáveis após o deploy identificado.';}
      item.updatedAt=new Date().toISOString();
      await client.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify(item)]);
      if(item.state!=='verifying')await client.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES(gen_random_uuid()::text,$1,$2,$3,$4)',[item.incidentId,'sdlc',item.state==='verified'?'Correção permanente verificada':'Correção sem recuperação confirmada',`${item.deploymentId} / ${item.commitSha}: ${item.result}`]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
