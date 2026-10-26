import type { Metric } from './domain';
export function detect(metric:Metric):{kind:string;title:string}|null {
  if(metric.requests<3)return null;
  if(metric.errorRate>=0.08)return {kind:'errors',title:'Aumento de erros em '+metric.service};
  if(metric.p95>=500)return {kind:'latency',title:'Latência elevada em '+metric.service};
  if(metric.saturation>=0.9)return {kind:'saturation',title:'Saturação em '+metric.service};
  return null;
}
export function isHealthy(metric:Metric) {
  return metric.requests>=3 && metric.errorRate<0.03 && metric.p95<400 && metric.saturation<0.85;
}
export function fingerprint(service:string,environment:string) {
  return environment+':'+service+':degradation';
}
