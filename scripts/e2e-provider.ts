import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import pg from 'pg';
import {config} from '../lib/config';
import {evidenceDiagnosis} from '../lib/diagnosis';
import {safeError} from '../lib/security';
import type {Snapshot} from '../lib/domain';

// Runs real Next.js, LangGraph, MCP and PostgreSQL against a controlled native
// Ollama protocol server. No actual model, credential or external API is used.
const suffix=randomUUID().replaceAll('-','').slice(0,12);
const database='sentinela_provider_test_'+suffix;
const model='contract-model-'+suffix;
const admin=new pg.Client({connectionString:config.databaseUrl});
let app:ChildProcess|undefined,suite:ChildProcess|undefined,created=false,appLog='';
let generationCalls=0,embeddingCalls=0;
const mock=http.createServer(async(request,response)=>{
  try{
    assert.equal(request.headers.authorization,undefined,'Uma credencial real não pode chegar ao servidor de teste.');
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('content-type','application/json');
    if(request.url==='/api/embed'){
      embeddingCalls++;assert.equal(body.dimensions,3);
      response.end(JSON.stringify({embeddings:body.input.map(()=>[1,.2,.1])}));return;
    }
    if(request.url==='/api/chat'){
      generationCalls++;assert.equal(body.model,model);assert.equal(body.stream,false);
      let value:unknown={status:'ok'};
      if(String(body.messages[1].content).startsWith('{')){
        const input=JSON.parse(body.messages[1].content);
        assert.deepEqual(Object.keys(input).sort(),['evidence','incident']);
        assert.equal(input.incident.scenario,undefined);
        const {mode:_mode,warning:_warning,...diagnosis}=evidenceDiagnosis(input.evidence,input.incident.service);
        value={...diagnosis,summary:'Resposta controlada para validar o contrato do provedor.'};
      }
      response.end(JSON.stringify({done:true,done_reason:'stop',message:{content:JSON.stringify(value)},prompt_eval_count:10,eval_count:20}));return;
    }
    response.writeHead(404);response.end(JSON.stringify({error:'Rota de teste desconhecida.'}));
  }catch(error){response.writeHead(500);response.end(JSON.stringify({error:safeError(error)}));}
});
function listen(server:net.Server,port=0){return new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve((server.address() as net.AddressInfo).port);});});}
async function freePort(){const server=net.createServer();const port=await listen(server);await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
async function labPorts(){
  for(let attempt=0;attempt<10;attempt++){
    const first=await freePort();if(first>65000)continue;
    const servers:net.Server[]=[];
    try{for(let i=0;i<4;i++){const server=net.createServer();servers.push(server);await listen(server,first+i);}return first;}
    catch{/* Try another free range. */}
    finally{await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));}
  }
  throw new Error('Não foi possível reservar portas para o laboratório de teste.');
}
async function stop(child:ChildProcess|undefined){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),12000);
  await exited;clearTimeout(timer);
}
try{
  await admin.connect();await admin.query('CREATE DATABASE "'+database+'"');created=true;
  const databaseUrl=new URL(config.databaseUrl);databaseUrl.pathname='/'+database;
  const providerPort=await listen(mock),webPort=await freePort(),labPort=await labPorts();
  const base='http://127.0.0.1:'+webPort;
  const env={...process.env,DATABASE_URL:databaseUrl.toString(),PORT:String(webPort),APP_URL:base,APP_ORIGINS:base,
    LAB_ENABLED:'true',LAB_BASE_PORT:String(labPort),MONITOR_INTERVAL_MS:'1000',PROMETHEUS_URL:'',
    AI_MODE:'model',AI_PROVIDER:'ollama',AI_MODEL:model,AI_BASE_URL:'http://127.0.0.1:'+providerPort,
    AI_API_KEY:'',AI_API_KEY_ENV:'',EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'contract-embedding',
    EMBEDDING_BASE_URL:'http://127.0.0.1:'+providerPort,EMBEDDING_DIMENSIONS:'3',EMBEDDING_API_KEY:'',EMBEDDING_API_KEY_ENV:'',
    OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:''};
  app=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{env,stdio:['ignore','pipe','pipe']});
  app.stdout?.on('data',chunk=>{appLog=(appLog+chunk).slice(-8000);});app.stderr?.on('data',chunk=>{appLog=(appLog+chunk).slice(-8000);});
  let ready=false;
  for(let i=0;i<60;i++){
    if(app.exitCode!==null)throw new Error('A aplicação de teste encerrou durante a inicialização.');
    try{
      const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)});
      if(health.ok){const snapshot:Snapshot=await (await fetch(base+'/api/snapshot')).json();if(snapshot.connections.diagnosis.model===model&&snapshot.worker.mcp){ready=true;break;}}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'A aplicação isolada não ficou pronta.');
  for(const role of ['diagnosis','embedding']){
    const response=await fetch(base+'/api/ai/check',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({role})});
    assert.equal(response.status,200,await response.text());
  }
  suite=spawn(process.execPath,['--import','tsx','scripts/e2e.ts'],{env,stdio:'inherit'});
  const timeout=setTimeout(()=>suite?.kill('SIGTERM'),150000);
  const [code]=await once(suite,'exit');clearTimeout(timeout);assert.equal(code,0,'Os cenários de integração falharam.');
  const snapshot:Snapshot=await (await fetch(base+'/api/snapshot')).json();
  assert.equal(snapshot.incidents.length,3);
  assert.ok(snapshot.incidents.every(incident=>incident.diagnosis?.mode==='model'&&incident.diagnosis.provider==='ollama'&&incident.diagnosis.model===model));
  assert.equal(snapshot.connections.embedding.dimensions,3);
  assert.ok(generationCalls>=4&&embeddingCalls>=4);
  console.log('PASS três cenários completos com provedor alternativo, embeddings de 3 dimensões e testes independentes de conexão.');
}catch(error){console.error(safeError(error));if(appLog)console.error(safeError(new Error(appLog.slice(-2000))));process.exitCode=1;}
finally{
  await stop(suite);await stop(app);
  await new Promise<void>(resolve=>mock.close(()=>resolve()));
  if(created)await admin.query('DROP DATABASE "'+database+'" WITH (FORCE)');
  await admin.end();
}
