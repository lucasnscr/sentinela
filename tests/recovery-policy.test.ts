import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {parsePolicy,policyFor,policyHash,policySnapshot} from '../lib/sdlc/recovery-policy';import {runProbe} from '../worker/sdlc/probes';
const input={version:'catalog-v1',stabilityMs:5000,probes:[{id:'product-data',kind:'data',url:'http://127.0.0.1:8080/api/products',assertions:[{pointer:'/content/0/sku',op:'equals',value:'REF-1'}]}]};
test('política usa escopo exato, hash estável, versão e limites de probes',()=>{
 const p=parsePolicy(input);assert.equal(p.minimumSamples,3);assert.deepEqual(p.rollbackProbes,p.probes);assert.equal(policyHash(p),policyHash(parsePolicy({...input,version:'catalog-v1'})));
 const env={SDLC_RECOVERY_POLICIES_JSON:JSON.stringify([{service:'catalog',environment:'test',policy:input}])};assert.equal(policyFor('catalog','test',env).version,'catalog-v1');assert.equal(policyFor('other','test',env).version,'technical-v1');
 const duplicate=JSON.parse(env.SDLC_RECOVERY_POLICIES_JSON);duplicate.push(duplicate[0]);assert.throws(()=>policyFor('catalog','test',{SDLC_RECOVERY_POLICIES_JSON:JSON.stringify(duplicate)}),/duplicada/);
 for(const patch of [{url:'http://external.example/path'},{url:'https://user:password@example.com'},{headerEnv:'GH_TOKEN'},{kind:'data',assertions:[]},{assertions:[{pointer:'/price',op:'min',value:'wrong'}]}])assert.throws(()=>parsePolicy({...input,probes:[{...input.probes[0],...patch}]}));
 assert.throws(()=>parsePolicy({...input,minimumSamples:2}));assert.throws(()=>parsePolicy({...input,stabilityMs:540001}));
});
test('HTTP 200 com dados errados, redirect, JSON inválido e payload grande não comprovam resultado',async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/redirect'){res.writeHead(302,{location:'/good'});res.end();}else if(req.url==='/large')res.end(JSON.stringify({secret:'x'.repeat(140000)}));else if(req.url==='/invalid')res.end('invalid');else if(req.url==='/wrong')res.end(JSON.stringify({content:[{sku:'CONFIDENTIAL-WRONG'}]}));else res.end(JSON.stringify({content:[{sku:'REF-1'}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as any).port;
 try{
  const probe=parsePolicy({...input,probes:[{...input.probes[0],url:base+'/good'}]}).probes[0];assert.equal((await runProbe(probe)).passed,true);
  for(const endpoint of ['wrong','redirect','large','invalid']){const result=await runProbe({...probe,url:base+'/'+endpoint});assert.equal(result.passed,false);assert.ok(!JSON.stringify(result).includes('CONFIDENTIAL'));}
  assert.equal((await runProbe({...probe,headerEnv:'SENTINELA_PROBE_CATALOG'},{env:{}})).reason,'credentials');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('probe cancela requisição lenta e não registra cabeçalhos de credencial',async()=>{
 let timer:ReturnType<typeof setTimeout>|undefined;const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer synthetic-probe-only');timer=setTimeout(()=>res.end('{}'),3000);});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const probe=parsePolicy({...input,probes:[{...input.probes[0],url:'http://127.0.0.1:'+(server.address() as any).port,headerEnv:'SENTINELA_PROBE_CATALOG'}]}).probes[0];const result=await runProbe(probe,{env:{SENTINELA_PROBE_CATALOG:'synthetic-probe-only'}});assert.equal(result.reason,'unavailable');assert.ok(!JSON.stringify(result).includes('synthetic-probe-only'));}finally{clearTimeout(timer);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('janela deve caber no prazo e credencial de Azure Functions vai em cabeçalho configurado',async()=>{
 const previous=process.env.SDLC_RECOVERY_POLICIES_JSON;try{process.env.SDLC_RECOVERY_POLICIES_JSON=JSON.stringify([{service:'catalog',environment:'test',policy:input}]);assert.throws(()=>policySnapshot('catalog','test',5000),/prazo/);assert.equal(policySnapshot('catalog','test',6000).recoveryPolicy.version,'catalog-v1');}finally{if(previous===undefined)delete process.env.SDLC_RECOVERY_POLICIES_JSON;else process.env.SDLC_RECOVERY_POLICIES_JSON=previous;}
 assert.throws(()=>parsePolicy({...input,probes:[{...input.probes[0],url:'https://functions.example/api/probe?code=secret'}]}));
 const probe=parsePolicy({...input,probes:[{...input.probes[0],url:'https://functions.example/api/probe',headerEnv:'SENTINELA_PROBE_FUNCTIONS',headerName:'x-functions-key'}]}).probes[0];
 const result=await runProbe(probe,{env:{SENTINELA_PROBE_FUNCTIONS:'synthetic-function-key'},request:async(_url,options)=>{assert.equal((options?.headers as Record<string,string>)['x-functions-key'],'synthetic-function-key');assert.equal(options?.redirect,'error');return new Response(JSON.stringify({content:[{sku:'REF-1'}]}));}});assert.equal(result.passed,true);
});
