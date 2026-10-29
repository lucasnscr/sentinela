import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import pg from 'pg';
import {config} from '../lib/config';
import {localAiCatalog} from './sdlc-test/local-ai-catalog.mjs';
import {realDelivery} from './sdlc-test/real-delivery.mjs';
import {waitFor} from './sdlc-test/process.mjs';

if(!process.argv.includes('--enable-real-github'))throw new Error('Opt-in obrigatório: este piloto cria uma issue real. Use --enable-real-github e PILOT_BASE_SHA.');
const baseSha=process.env.PILOT_BASE_SHA||'',peer=process.env.ISSUE_TO_PR_AI_DIR;
assert.match(baseSha,/^[a-f0-9]{40}$/);assert.ok(peer);
const resume=process.argv.includes('--resume')?JSON.parse(await readFile('test-results/real-pilot-pending.json','utf8')):null;
if(resume){assert.equal(resume.baseSha,baseSha);assert.match(resume.suffix,/^[a-f0-9]{8}$/);assert.match(resume.caseId,/^[a-f0-9-]{36}$/);assert.ok(Number.isSafeInteger(resume.issueNumber));}
const repo='lucasnscr/issue-to-pr-ai',suffix=resume?.suffix||randomUUID().slice(0,8),database='sentinela_real_'+suffix;
const admin=new pg.Client({connectionString:config.databaseUrl}),token=randomUUID()+randomUUID(),callback=randomUUID()+randomUUID();
const gh=(args:string[])=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:2_000_000}).trim();
const api=(endpoint:string)=>JSON.parse(gh(['api',endpoint]));
let app:ChildProcess|undefined,catalog:Awaited<ReturnType<typeof localAiCatalog>>|undefined,created=false,finished=false,appLog='';
try{
  await admin.connect();if(!resume)await admin.query('CREATE DATABASE "'+database+'"');created=true;
  console.log('Real pilot: build da base revisada e falha sintética de política de ingresso.');
  catalog=await localAiCatalog(baseSha,suffix,resume?{resumeDirectory:resume.catalogDirectory,ingressPort:resume.ingressPort}:{});
  const server=net.createServer();await new Promise<void>(resolve=>server.listen(resume?Number(new URL(resume.base).port):0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
  const base='http://127.0.0.1:'+port,url=new URL(config.databaseUrl);url.pathname='/'+database;
  const policy={version:'real-header-v1',stabilityMs:5000,maxSampleGapMs:20000,probes:[
    {id:'categories-business',kind:'business',url:catalog.url+'/api/products/categories',status:200},
    {id:'catalog-data',kind:'data',url:catalog.url+'/api/products',status:200,assertions:[{pointer:'/totalElements',op:'min',value:1},{pointer:'/content/0/sku',op:'equals',value:'REF-OPERATIONS'}]}]};
  // Only the trusted Sentinela issue publisher receives this in-memory credential.
  // It is never written to a file, printed or passed to the model/candidate.
  const publisherToken=gh(['auth','token']);
  const env={...process.env,DATABASE_URL:url.toString(),PORT:String(port),APP_ORIGINS:base,MONITOR_INTERVAL_MS:'1000',LAB_ENABLED:'false',OPERATIONS_ENABLED:'false',AI_MODE:'rules',AI_PROVIDER:'none',EMBEDDING_PROVIDER:'none',
    PROMETHEUS_URL:catalog.prometheusUrl,MONITORED_SERVICES:'catalog-api',MONITORED_ENVIRONMENT:'contract-test',SDLC_ENABLED:'true',SDLC_REPOSITORY:repo,SDLC_ENVIRONMENT:'contract-test',SDLC_SERVICES:'catalog-api',SDLC_VERIFY_TIMEOUT_MS:'60000',SDLC_RECOVERY_POLICIES_JSON:JSON.stringify([{service:'catalog-api',environment:'contract-test',policy}]),
    SDLC_GH_BIN:'gh',SENTINELA_GITHUB_TOKEN:publisherToken,OPERATIONS_API_TOKEN:token,SDLC_CALLBACK_TOKEN:callback,GH_TOKEN:'',GITHUB_TOKEN:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:''};
  app=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{env,stdio:['ignore','pipe','pipe']});app.stdout?.on('data',chunk=>{appLog=(appLog+chunk).slice(-4000);});app.stderr?.on('data',chunk=>{appLog=(appLog+chunk).slice(-4000);});
  const json=async(path:string)=>{const response=await fetch(base+path,{signal:AbortSignal.timeout(4000)});assert.ok(response.ok);return response.json();};
  async function command(body:unknown){const response=await fetch(base+'/api/sdlc',{method:'POST',headers:{origin:base,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,202,await response.clone().text());const {id}=await response.json();await waitFor('SDLC command',async()=>{const state=await json('/api/commands/'+id);if(state.status==='failed')throw new Error(state.result);return state.status==='completed';});}
  let item:any;
  if(!resume){
  const incident:any=await waitFor('incidente coletado',async()=>{const data=await json('/api/snapshot');return data.incidents.find((item:any)=>item.status!=='resolved'&&item.evidence.length>0);},120000);
  await command({kind:'sdlc_propose',incidentId:incident.id,correctionKind:'application',summary:'O ingresso sintético do piloto recusa GET /api/products/categories com HTTP 503 porque a resposta da aplicação não inclui X-Content-Type-Options: nosniff. Incluir esse cabeçalho somente nessa resposta, preservando Cache-Control: no-store, status 200 e corpo JSON. Não mudar o ingresso, os testes existentes ou a política para contornar a falha.',acceptanceCriteria:[
    'Adicionar .header("X-Content-Type-Options", "nosniff") à cadeia ResponseEntity já existente no método categories, preservando imports existentes.',
    'Adicionar teste de integração em ProductCategoriesIT que verifica nosniff e no-store; preservar os testes existentes, sem novos imports desnecessários.',
    'Documentar o novo cabeçalho na descrição OpenAPI e no README da aplicação.',
    'Maven/PostgreSQL e aceitação HTTP independentes devem passar; o ingresso volta a responder 200 com o novo cabeçalho.'],evidenceIds:incident.evidence.slice(0,4).map((item:any)=>item.id)});
  item=(await json('/api/sdlc')).cases.find((value:any)=>value.incidentId===incident.id);assert.equal(item.state,'proposed');
  await command({kind:'sdlc_publish',caseId:item.id,proposalHash:item.proposalHash});
  item=(await json('/api/sdlc')).cases.find((value:any)=>value.id===item.id);
  const issue=api(`repos/${repo}/issues/${item.issueNumber}`);assert.deepEqual(issue.labels,[]);
  }else{
    item=await waitFor('caso persistido',async()=>(await json('/api/sdlc')).cases.find((value:any)=>value.id===resume.caseId));assert.equal(item.issueNumber,resume.issueNumber);
  }
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/real-pilot-pending.json',JSON.stringify({caseId:item.id,issueNumber:item.issueNumber,baseSha,base,suffix,catalogDirectory:catalog.directory,ingressPort:catalog.ingressPort,startedAt:resume?.startedAt||new Date().toISOString()},null,2));
  console.log(`REAL_ISSUE=${item.issueNumber}; case=${item.id}; aguardando autorização humana /oc e CI. Nenhum ai:ready foi adicionado pelo Sentinela.`);
  const pr:any=await waitFor('PR com CI real aprovada',async()=>{
    const prs=api(`repos/${repo}/pulls?state=all&per_page=100`).filter((value:any)=>new RegExp('Closes #'+item.issueNumber+'\\b','i').test(value.body||''));
    if(prs.length!==1)return false;
    const runs=api(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${prs[0].head.sha}&per_page=10`).workflow_runs;
    const ci=runs.find((value:any)=>value.conclusion==='success');return ci?{...prs[0],ci}:false;
  },3600000);
  const modelEvidence=await realDelivery(pr,item.issueNumber,api);
  const {notifyImplementation}=await import(pathToFileURL(peer+'/scripts/sentinela/notify-pr.mjs').href);
  const {deliver}=await import(pathToFileURL(peer+'/scripts/sentinela/deliver.mjs').href);
  const deliveryEnv={SENTINELA_ENABLED:'true',SENTINELA_DELIVERY_ENABLED:'true',SENTINELA_URL:base,SENTINELA_CALLBACK_TOKEN:callback,GITHUB_REPOSITORY:repo,SENTINELA_SERVICE:'catalog-api',SENTINELA_ENVIRONMENT:'contract-test',SENTINELA_PR_NUMBER:String(pr.number)};
  await notifyImplementation({env:deliveryEnv,event:{workflow_run:pr.ci}});
  console.log(`REAL_PR_READY=${pr.number}; CI=${pr.ci.id}; aguardando revisão e merge pelo mantenedor.`);
  const merged:any=await waitFor('merge autorizado',async()=>{const value=api(`repos/${repo}/pulls/${pr.number}`);return value.merged?value:false;},3600000);
  const digest=await catalog.build(merged.merge_commit_sha);assert.match(digest,/^sha256:[a-f0-9]{64}$/);
  const result=await deliver({env:{...deliveryEnv,GITHUB_SHA:merged.merge_commit_sha,SENTINELA_ARTIFACT_DIGEST:digest,SENTINELA_DEPLOYMENT_ID:'real-'+suffix},deploy:catalog.deploy,rollback:catalog.rollback,verifyOptions:{timeoutMs:120000,pollMs:1000}});
  assert.equal(result.state,'verified');assert.ok(result.healthySamples>=3);assert.ok(result.recovery.stableForMs>=5000);
  const report={result:'passed',baseSha,issueNumber:item.issueNumber,pullRequestNumber:pr.number,ciRunId:pr.ci.id,caseId:item.id,implementationSha:pr.head.sha,mergeSha:merged.merge_commit_sha,artifactDigest:digest,healthySamples:result.healthySamples,stabilityMs:result.recovery.stableForMs,modelEvidence,
    real:['GitHub issue published by Sentinela','authorized OpenCode/Qwen delivery','GitHub CI','maintainer merge','Java HTTP','PostgreSQL','Docker replacement','SDLC callbacks','business and data probes'],controlled:['synthetic ingress header policy','HTTP-probe Prometheus protocol adapter with saturation fixed at zero'],diagnosis:'rules',publication:'local loopback broker; no public callback endpoint'};
  await writeFile('test-results/sdlc-real-pilot-report.json',JSON.stringify(report,null,2));finished=true;console.log('REAL_SDLC_PASS: issue → Qwen → PR/CI → merge → deploy → recuperação técnica, negócio/dados e estabilidade.');
}catch(error){console.error(error instanceof Error?error.message:'Real pilot failed');if(appLog)console.error(appLog.slice(-1200));process.exitCode=1;}
finally{
  if(app&&app.exitCode===null){const stopped=once(app,'exit');app.kill('SIGTERM');const timer=setTimeout(()=>app?.kill('SIGKILL'),15000);await stopped;clearTimeout(timer);}
  await catalog?.cleanup({preserve:!!resume&&!finished});if(created&&(!resume||finished))await admin.query('DROP DATABASE "'+database+'" WITH(FORCE)');await admin.end();
}
