import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readVector,buildMetrics} from '../worker/prometheus-data';
import {healthySnapshot} from '../scripts/sdlc-test/telemetry.mjs';
const now=Date.now(),service='catalog-api';
const payload=(value:number,environment='staging')=>({status:'success',data:{resultType:'vector',result:[{metric:{service,environment},value:[now/1000,String(value)]}]}});
const vectors=(observed=now/1000)=>[0,30,120,.2,observed].map(value=>readVector(payload(value),'staging'));
test('coleta preserva a hora do scrape em consultas repetidas e seleciona ambiente explícito',()=>{
  const values=vectors((now-1000)/1000);
  assert.equal(buildMetrics(values,[service],now)[0].at,buildMetrics(values,[service],now+1000)[0].at);
  assert.equal(buildMetrics(values,[service],now)[0].environment,'staging');
  assert.equal(readVector(payload(0,'production'),'staging').size,0);
});
test('coleta recusa observação antiga, futura, ausente ou com dimensões divergentes',()=>{
  assert.deepEqual(buildMetrics(vectors((now-20000)/1000),[service],now),[]);
  assert.deepEqual(buildMetrics(vectors((now+1)/1000),[service],now),[]);
  const missing=vectors();missing[4].clear();assert.deepEqual(buildMetrics(missing,[service],now),[]);
  const mixed=vectors();mixed[1]=readVector(payload(30,'production'),'');assert.deepEqual(buildMetrics(mixed,[service],now),[]);
});
test('coleta recusa séries ambíguas, valores inválidos e métricas de outro ambiente',()=>{
  const ambiguous=payload(0);ambiguous.data.result.push(...payload(1).data.result);
  assert.equal(readVector(ambiguous,'staging').size,0);
  assert.equal(readVector(payload(Infinity),'staging').size,0);
  assert.deepEqual(buildMetrics([2,30,120,.2,now/1000].map(v=>readVector(payload(v),'staging')),[service],now),[]);
  assert.throws(()=>readVector({status:'success',data:{resultType:'matrix',result:[]}},'staging'));
});
test('o ensaio só congela telemetria comprovadamente saudável, recente e com tráfego',()=>{
  const names=['error_ratio','latency_p95_ms','requests_per_minute','saturation_ratio','observed_at_seconds'];
  const snapshot=(values:number[])=>new Map(names.map((name,index)=>['/api/v1/query?query=sentinela_service_'+name,JSON.stringify(payload(values[index]))]));
  assert.equal(healthySnapshot(snapshot([0,30,120,.2,now/1000]),now),true);
  for(const values of [[NaN,30,120,.2,now/1000],[0,500,120,.2,now/1000],[0,30,0,.2,now/1000],[0,30,120,.9,now/1000],[0,30,120,.2,(now-20000)/1000],[0,30,120,.2,(now+1)/1000]])assert.equal(healthySnapshot(snapshot(values),now),false);
});
