import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {run,waitFor} from './process.mjs';

// Explicit synthetic ingress policy. The measured responses are real HTTP;
// this adapter is not a Prometheus deployment or a production saturation probe.
/** @param {string} baseSha @param {string} suffix @param {{resumeDirectory?:string,ingressPort?:number}} [options] */
export async function localAiCatalog(baseSha,suffix,{resumeDirectory,ingressPort=0}={}){
  assert.match(baseSha,/^[a-f0-9]{40}$/);
  const directory=resumeDirectory?await realpath(resumeDirectory):await mkdtemp(join(tmpdir(),'sentinela-real-catalog-'));
  assert.equal(dirname(directory),await realpath(tmpdir()));assert.ok(basename(directory).startsWith('sentinela-real-catalog-'));
  const checkout=join(directory,'source'),network='sentinela-real-'+suffix,db=network+'-db',api=network+'-api';
  const oldImage=network+':before',fixedImage=network+':after';
  const docker=args=>run('docker',args,{quiet:true});
  let appPort='',upstream='',load,ingress,metrics;const samples=[];
  const git=args=>run('git',args,{cwd:checkout,quiet:true});
  async function deploy(image){
    await run('docker',['rm','-f',api],{quiet:true,allowFailure:true});
    await docker(['run','-d','--name',api,'--network',network,'-p','127.0.0.1:'+appPort+':8080',
      '-e','DATABASE_URL=jdbc:postgresql://'+db+':5432/catalog','-e','DATABASE_USER=catalog','-e','DATABASE_PASSWORD=catalog',image]);
    appPort=JSON.parse((await docker(['inspect',api])).output)[0].NetworkSettings.Ports['8080/tcp'][0].HostPort;
    upstream='http://127.0.0.1:'+appPort;
    await waitFor('catalog readiness',async()=>(await fetch(upstream+'/actuator/health/readiness')).ok);
  }
  const listen=async(handler,port=0)=>{const server=createServer(handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;};
  const origin=server=>'http://127.0.0.1:'+server.address().port;
  async function cleanup({preserve=false}={}){
    clearInterval(load);
    for(const server of [ingress,metrics])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(preserve)return;
    for(const name of [api,db])await run('docker',['rm','-f',name],{allowFailure:true,quiet:true});
    await run('docker',['network','rm',network],{allowFailure:true,quiet:true});
    await run('docker',['image','rm',oldImage,fixedImage],{allowFailure:true,quiet:true});await rm(directory,{recursive:true,force:true});
  }
  try{
    if(!resumeDirectory){
      await run('git',['clone','--quiet','https://github.com/lucasnscr/issue-to-pr-ai.git',checkout],{quiet:true});
      await git(['checkout','--detach',baseSha]);await docker(['network','create',network]);
      await docker(['run','-d','--name',db,'--network',network,'-e','POSTGRES_DB=catalog','-e','POSTGRES_USER=catalog','-e','POSTGRES_PASSWORD=catalog','postgres:17-alpine']);
      await waitFor('catalog database',async()=>(await run('docker',['exec',db,'pg_isready','-U','catalog'],{allowFailure:true,quiet:true})).code===0);
      await docker(['build','-t',oldImage,checkout]);await deploy(oldImage);
      const seed=await fetch(upstream+'/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sku:'REF-OPERATIONS',name:'Operational reference',category:'sentinela',price:19.9})});assert.equal(seed.status,201);
    }else{
      const container=JSON.parse((await docker(['inspect',api])).output)[0];assert.equal(container.Config.Image,oldImage);
      appPort=container.NetworkSettings.Ports['8080/tcp'][0].HostPort;upstream='http://127.0.0.1:'+appPort;
      const reference=await(await fetch(upstream+'/api/products')).json();assert.equal(reference.content[0].sku,'REF-OPERATIONS');
    }
    ingress=await listen(async(request,response)=>{
      try{
        if(!['/api/products','/api/products/categories'].includes(request.url)){response.writeHead(404).end();return;}
        const value=await fetch(upstream+request.url,{signal:AbortSignal.timeout(3000)});
        const rejected=request.url.endsWith('/categories')&&value.headers.get('x-content-type-options')!=='nosniff';
        response.writeHead(rejected?503:value.status,{'content-type':'application/json'});
        response.end(rejected?JSON.stringify({error:'Synthetic ingress policy requires X-Content-Type-Options: nosniff'}):await value.text());
      }catch{response.writeHead(503).end();}
    },ingressPort);
    const url=origin(ingress);
    load=setInterval(async()=>{const start=Date.now();let ok=false;try{const result=await fetch(url+'/api/products/categories',{signal:AbortSignal.timeout(4000)});ok=result.ok;await result.body?.cancel();}catch{}samples.push({at:Date.now(),ok,latency:Date.now()-start});while(samples[0]?.at<Date.now()-10000)samples.shift();},500);
    metrics=await listen((request,response)=>{
      const name=new URL(request.url,'http://localhost').searchParams.get('query')?.split('{')[0];
      const latest=samples.at(-1),latencies=samples.map(sample=>sample.latency).sort((a,b)=>a-b);
      const values={sentinela_service_error_ratio:samples.filter(sample=>!sample.ok).length/Math.max(1,samples.length),
        sentinela_service_latency_p95_ms:latencies[Math.floor(latencies.length*.95)]||0,
        sentinela_service_requests_per_minute:samples.length*6,sentinela_service_saturation_ratio:0,
        sentinela_service_observed_at_seconds:latest?.at/1000};
      if(!Object.hasOwn(values,name)){response.writeHead(404).end();return;}
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({status:'success',data:{resultType:'vector',result:latest?[{metric:{service:'catalog-api',environment:'contract-test'},value:[Date.now()/1000,String(values[name])]}]:[]}}));
    });
    assert.equal((await fetch(url+'/api/products/categories')).status,503);
    return {url,prometheusUrl:origin(metrics),baseSha,directory,ingressPort:ingress.address().port,cleanup,
      async build(sha){assert.match(sha,/^[a-f0-9]{40}$/);await git(['fetch','origin','main']);await git(['checkout','--detach',sha]);await docker(['build','-t',fixedImage,checkout]);return (await docker(['image','inspect',fixedImage,'--format','{{.Id}}'])).output;},
      deploy:()=>deploy(fixedImage),rollback:()=>deploy(oldImage)};
  }catch(error){await cleanup();throw error;}
}
