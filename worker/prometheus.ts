import { config } from '../lib/config';
import { addMetric } from '../lib/db';
import type { Metric } from '../lib/domain';
import {readVector,buildMetrics,recordingNames} from './prometheus-data';
async function query(expression:string){
  const url=new URL('/api/v1/query',config.prometheusUrl);
  if(!['http:','https:'].includes(url.protocol))throw new Error('URL do Prometheus inválida.');
  url.searchParams.set('query',expression+(config.monitoredEnvironment?'{environment='+JSON.stringify(config.monitoredEnvironment)+'}':''));
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Prometheus retornou HTTP '+response.status);
  const result=await response.json();
  return readVector(result,config.monitoredEnvironment);
}
export async function samplePrometheus():Promise<Metric[]>{
  const vectors=await Promise.all(recordingNames.map(query));
  const metrics=buildMetrics(vectors,config.services);
  for(const metric of metrics)await addMetric(metric);
  return metrics;
}
