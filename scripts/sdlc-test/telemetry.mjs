import http from 'node:http';
export function healthySnapshot(snapshot,now=Date.now()){
  const value=suffix=>{
    const entry=[...snapshot].find(([path])=>new URL(path,'http://localhost').searchParams.get('query')?.split('{')[0]==='sentinela_service_'+suffix);
    const rows=entry&&JSON.parse(entry[1]).data?.result;
    return rows?.length===1?Number(rows[0].value?.[1]):NaN;
  };
  const values=['error_ratio','latency_p95_ms','requests_per_minute','saturation_ratio','observed_at_seconds'].map(value);
  const [error,p95,rpm,saturation,observed]=values,age=now-observed*1000;
  return values.every(Number.isFinite)&&error>=0&&error<.03&&p95>=0&&p95<400&&rpm>=15&&saturation>=0&&saturation<.85&&age>=0&&age<20000;
}
export async function telemetryProxy(upstream){
  let frozen=null;const cached=new Map();
  const read=async path=>{const response=await fetch(upstream+path,{signal:AbortSignal.timeout(4000)});if(!response.ok)throw new Error('Prometheus unavailable');return response.text();};
  const server=http.createServer(async(request,response)=>{
    try{const path=request.url;if(!path.startsWith('/api/v1/query?')){response.writeHead(404).end();return;}
      const value=frozen?frozen.get(path):await read(path);
      if(!value){response.writeHead(503).end();return;}
      if(!frozen)cached.set(path,value);response.writeHead(200,{'content-type':'application/json'});response.end(value);
    }catch{response.writeHead(503).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,
    async freezeHealthy(){
      if(cached.size<5)return false;const snapshot=new Map();
      for(const path of cached.keys())snapshot.set(path,await read(path));
      if(!healthySnapshot(snapshot))return false;
      frozen=snapshot;return true;
    },resume(){frozen=null;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
