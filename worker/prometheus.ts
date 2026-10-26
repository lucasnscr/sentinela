import { config } from '../lib/config';
import { addMetric } from '../lib/db';
import type { Metric } from '../lib/domain';
async function query(expression:string){
  const url=new URL('/api/v1/query',config.prometheusUrl);
  if(!['http:','https:'].includes(url.protocol))throw new Error('URL do Prometheus inválida.');
  url.searchParams.set('query',expression);
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Prometheus retornou HTTP '+response.status);
  const result=await response.json();
  if(result.status!=='success')throw new Error('Consulta Prometheus falhou.');
  return new Map<string,number>(result.data.result.map((r:any)=>[r.metric.service,Number(r.value[1])]));
}
export async function samplePrometheus():Promise<Metric[]>{
  const [errors,latency,rpm,saturation]=await Promise.all(['sentinela_service_error_ratio','sentinela_service_latency_p95_ms','sentinela_service_requests_per_minute','sentinela_service_saturation_ratio'].map(query));
  const metrics:Metric[]=[];
  for(const service of config.services){
    if(!errors.has(service)||!latency.has(service)||!rpm.has(service))continue;
    const rate=rpm.get(service)||0;
    const metric:Metric={service,at:new Date().toISOString(),errorRate:errors.get(service)||0,p95:latency.get(service)||0,rpm:rate,saturation:saturation.get(service)||0,requests:Math.round(rate/5),source:'prometheus'};
    if(!Object.values(metric).some(value=>typeof value==='number'&&!Number.isFinite(value))){await addMetric(metric);metrics.push(metric);}
  }
  return metrics;
}
