import type {RecoveryProbe,RecoveryCheck} from '../../lib/sdlc/recovery-policy';
function pointer(value:any,path:string){for(const part of path.slice(1).split('/')){const key=part.replaceAll('~1','/').replaceAll('~0','~');if(value===null||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,key))return undefined;value=value[key];}return value;}
export async function runProbe(probe:RecoveryProbe,{request=fetch,env=process.env}:{request?:typeof fetch;env?:Record<string,string|undefined>}={}):Promise<RecoveryCheck>{
 const result=(passed:boolean,reason:RecoveryCheck['reason']):RecoveryCheck=>({id:probe.id,kind:probe.kind,passed,reason,at:new Date().toISOString()});
 const headers:Record<string,string>={accept:'application/json'};
 if(probe.headerEnv){const secret=env[probe.headerEnv];if(!secret||secret.length>8192)return result(false,'credentials');headers[probe.headerName]=probe.headerName==='authorization'?'Bearer '+secret:secret;}
 try{
  const response=await request(probe.url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(2000)});
  if(response.status!==probe.status){await response.body?.cancel();return result(false,'status');}
  if(!probe.assertions.length){await response.body?.cancel();return result(true,'ok');}
  if(Number(response.headers.get('content-length'))>131072){await response.body?.cancel();return result(false,'payload');}
  const reader=response.body?.getReader();if(!reader)return result(false,'payload');
  let bytes=0;const chunks:Uint8Array[]=[];try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>131072){await reader.cancel();return result(false,'payload');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return result(false,'payload');}
  const passed=probe.assertions.every(a=>{const value=pointer(body,a.pointer);return a.op==='equals'?value===a.value:typeof value==='number'&&Number.isFinite(value)&&value>=(a.value as number);});
  return result(passed,passed?'ok':'assertion');
 }catch{return result(false,'unavailable');}
}
export const runProbes=(probes:RecoveryProbe[])=>Promise.all(probes.map(probe=>runProbe(probe)));
