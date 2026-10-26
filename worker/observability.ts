import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, SpanStatusCode } from '@opentelemetry/api';
let sdk:NodeSDK|undefined;
export function startTelemetry(){
  if(process.env.OTEL_EXPORTER_OTLP_ENDPOINT){
    sdk=new NodeSDK({serviceName:'sentinela-worker',traceExporter:new OTLPTraceExporter({url:process.env.OTEL_EXPORTER_OTLP_ENDPOINT})});
    sdk.start();
  }
}
export async function observed<T>(name:string,attributes:Record<string,string>,fn:()=>Promise<T>):Promise<T>{
  return trace.getTracer('sentinela').startActiveSpan(name,{attributes},async span=>{
    try{return await fn();}catch(error){span.setStatus({code:SpanStatusCode.ERROR});throw error;}finally{span.end();}
  });
}
export async function stopTelemetry(){await sdk?.shutdown();}
