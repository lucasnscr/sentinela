import type {Metric} from '../lib/domain';

export const recordingNames=['sentinela_service_error_ratio','sentinela_service_latency_p95_ms',
  'sentinela_service_requests_per_minute','sentinela_service_saturation_ratio','sentinela_service_observed_at_seconds'];
type Value={value:number;environment:string|undefined};
export function readVector(payload:any,environment:string):Map<string,Value>{
  if(payload.status!=='success'||payload.data?.resultType!=='vector'||!Array.isArray(payload.data.result))throw new Error('Resposta Prometheus inválida.');
  const values=new Map<string,Value>(),ambiguous=new Set<string>();
  for(const row of payload.data.result){
    const service=row.metric?.service,scope=row.metric?.environment;
    if(typeof service!=='string'||(environment&&scope!==environment))continue;
    if(ambiguous.has(service))continue;
    const value=Number(row.value?.[1]);
    if(values.has(service)||!Number.isFinite(value)){values.delete(service);ambiguous.add(service);continue;}
    values.set(service,{value,environment:scope});
  }
  return values;
}
export function buildMetrics(vectors:Map<string,Value>[],services:string[],now=Date.now()):Metric[]{
  const result:Metric[]=[];
  for(const service of services){
    const entries=vectors.map(vector=>vector.get(service));
    if(entries.some(value=>!value)||entries.some(value=>value!.environment!==entries[0]!.environment))continue;
    const [errorRate,p95,rpm,saturation,observed]=entries.map(value=>value!.value),age=now-observed*1000;
    if(age<0||age>=20000||errorRate<0||errorRate>1||p95<0||rpm<0||saturation<0)continue;
    result.push({service,environment:entries[0]!.environment,at:new Date(observed*1000).toISOString(),errorRate,p95,rpm,saturation,requests:Math.floor(rpm/5),source:'prometheus'});
  }
  return result;
}
