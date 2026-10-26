import http from 'node:http';
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
      const error=[...snapshot].find(([path])=>new URL(path,'http://localhost').searchParams.get('query').startsWith('sentinela_service_error_ratio'));
      const result=error&&JSON.parse(error[1]).data.result;if(!result?.length||result.some(row=>Number(row.value[1])>=.03))return false;
      frozen=snapshot;return true;
    },resume(){frozen=null;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
