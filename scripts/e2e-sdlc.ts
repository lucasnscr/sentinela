import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {config} from '../lib/config';
import {catalogFixture} from './sdlc-test/catalog.mjs';
import {waitFor} from './sdlc-test/process.mjs';
import type {Snapshot} from '../lib/domain';
import type {RemediationCase} from '../lib/sdlc/types';

const peer=process.env.ISSUE_TO_PR_AI_DIR;if(!peer)throw new Error('Configure ISSUE_TO_PR_AI_DIR com o checkout issue-to-pr-ai.');
assert.equal(await readFile('contracts/sdlc-v1.mjs','utf8'),await readFile(path.join(peer,'contracts/sdlc-v1.mjs'),'utf8'),'Os contratos dos dois repositórios devem ser idênticos.');
const directory=await mkdtemp(path.join(tmpdir(),'sentinela-sdlc-')),suffix=randomUUID().slice(0,8);
const database='sentinela_sdlc_'+suffix.replaceAll('-',''),admin=new pg.Client({connectionString:config.databaseUrl});
const token=randomUUID()+randomUUID(),callback=randomUUID()+randomUUID(),repo='lucasnscr/issue-to-pr-ai';
let app:ChildProcess|undefined,catalog:Awaited<ReturnType<typeof catalogFixture>>|undefined,created=false,appLog='';
try{
  await admin.connect();await admin.query('CREATE DATABASE "'+database+'"');created=true;
  console.log('SDLC 1/7: build e deploy de uma regressão controlada no catálogo Java.');
  catalog=await catalogFixture(path.resolve(peer),suffix);await catalog.failed();
  const stateFile=path.join(directory,'github.json');await writeFile(stateFile,JSON.stringify({repository:repo,issues:[]}));
  const gh=path.join(directory,'gh-contract');await writeFile(gh,'#!/usr/bin/env node\n'+await readFile('scripts/sdlc-test/github-cli.mjs','utf8'));await chmod(gh,0o700);
  const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
  const base='http://127.0.0.1:'+port,url=new URL(config.databaseUrl);url.pathname='/'+database;
  const env={...process.env,DATABASE_URL:url.toString(),PORT:String(port),APP_ORIGINS:base,MONITOR_INTERVAL_MS:'1000',LAB_ENABLED:'false',OPERATIONS_ENABLED:'false',AI_MODE:'rules',AI_PROVIDER:'none',EMBEDDING_PROVIDER:'none',
    PROMETHEUS_URL:catalog.prometheusUrl,MONITORED_SERVICES:'catalog-api',MONITORED_ENVIRONMENT:'contract-test',SDLC_ENABLED:'true',SDLC_REPOSITORY:repo,SDLC_ENVIRONMENT:'contract-test',SDLC_SERVICES:'catalog-api',SDLC_VERIFY_TIMEOUT_MS:'30000',
    SDLC_GH_BIN:gh,SDLC_CONTRACT_STATE:stateFile,SENTINELA_GITHUB_TOKEN:'contract-only-not-a-real-key',OPERATIONS_API_TOKEN:token,SDLC_CALLBACK_TOKEN:callback,
    OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:'',GH_TOKEN:'',GITHUB_TOKEN:''};
  app=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{env,stdio:['ignore','pipe','pipe']});app.stdout?.on('data',chunk=>{appLog=(appLog+chunk).slice(-4000);});app.stderr?.on('data',chunk=>{appLog=(appLog+chunk).slice(-4000);});
  async function snapshot():Promise<Snapshot>{const response=await fetch(base+'/api/snapshot',{signal:AbortSignal.timeout(4000)});assert.ok(response.ok);return response.json();}
  async function command(body:unknown){const response=await fetch(base+'/api/sdlc',{method:'POST',headers:{origin:base,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,202,await response.clone().text());const {id}=await response.json();await waitFor('comando SDLC',async()=>{const state=await(await fetch(base+'/api/commands/'+id)).json();if(state.status==='failed')throw new Error(state.result);return state.status==='completed';});return id;}
  async function cases():Promise<RemediationCase[]>{return (await(await fetch(base+'/api/sdlc')).json()).cases;}
  async function prepareCase(excluding:string[]=[]){
    const incident=await waitFor('incidente real do catálogo',async()=>{const data=await snapshot();return data.incidents.find(item=>!excluding.includes(item.id)&&item.status!=='resolved'&&item.evidence.length>0);},120000);
    await command({kind:'sdlc_propose',incidentId:incident.id,correctionKind:'application',summary:'A versão implantada devolve HTTP 503 ao listar produtos. Corrigir a regressão e preservar o contrato da API.',acceptanceCriteria:['GET /api/products retorna HTTP 200 com PostgreSQL real.','Teste de regressão deve falhar antes da correção e passar depois.','Confirmar três novas amostras saudáveis após o deploy.'],evidenceIds:incident.evidence.slice(0,4).map((item:{id:string})=>item.id)});
    const item=(await cases()).find(value=>value.incidentId===incident.id)!;assert.equal(item.state,'proposed');
    const [one,two]=await Promise.all([command({kind:'sdlc_publish',caseId:item.id,proposalHash:item.proposalHash}),command({kind:'sdlc_publish',caseId:item.id,proposalHash:item.proposalHash})]);assert.equal(one,two);
    return (await cases()).find(value=>value.id===item.id)!;
  }
  const first=await prepareCase();const github=JSON.parse(await readFile(stateFile,'utf8'));assert.equal(github.issues.length,1);assert.deepEqual(github.issues[0].labels,[]);
  console.log('SDLC 2/7: incidente detectado, proposta revisada e issue publicada uma única vez, sem ai:ready.');
  // Exercise the existing issue-to-pr authorization and task preparation gates.
  const require=createRequire(import.meta.url),authorize=require(path.join(catalog.checkout,'.github/scripts/authorize.cjs')),prepare=require(path.join(catalog.checkout,'.github/scripts/prepare-implementation.cjs'));
  const issue=github.issues[0],outputs:Record<string,string>={};let approved=false;
  const apiGate={rest:{repos:{getCollaboratorPermissionLevel:async()=>({data:{permission:'write'}}),getCommit:async()=>({data:{sha:catalog!.badSha}})},issues:{get:async()=>({data:{...issue,labels:approved?[{name:'ai:ready'}]:[]}})}}};
  const context={repo:{owner:'lucasnscr',repo:'issue-to-pr-ai'},actor:'contract-maintainer',runId:'contract',payload:{comment:{body:'@claude',user:{type:'User',login:'contract-maintainer'}},issue:{number:issue.number},repository:{default_branch:'main'}}};
  const core={setOutput:(key:string,value:string)=>{outputs[key]=value;},notice:()=>{}};
  await authorize({github:apiGate,context,core});assert.equal(outputs.agent,'');
  approved=true;await authorize({github:apiGate,context,core});assert.equal(outputs.agent,'claude');
  const previous={RUNNER_TEMP:process.env.RUNNER_TEMP,CHECKOUT_SHA:process.env.CHECKOUT_SHA};Object.assign(process.env,{RUNNER_TEMP:directory,CHECKOUT_SHA:catalog.badSha});
  try{await prepare({github:apiGate,context,core});}finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  assert.match(await readFile(outputs.task,'utf8'),/untrusted_issue/);
  const fixed=await catalog.implement({body:await readFile(outputs.task,'utf8')});
  console.log('SDLC 3/7: gate do issue-to-pr, agente controlado, teste vermelho e Maven/PostgreSQL completos aprovados.');
  const {notifyImplementation}=await import(pathToFileURL(path.join(peer,'scripts/sentinela/notify-pr.mjs')).href);
  const {deliver}=await import(pathToFileURL(path.join(peer,'scripts/sentinela/deliver.mjs')).href);
  const deliveryEnv={SENTINELA_ENABLED:'true',SENTINELA_DELIVERY_ENABLED:'true',SENTINELA_URL:base,SENTINELA_CALLBACK_TOKEN:callback,GITHUB_REPOSITORY:repo,SENTINELA_SERVICE:'catalog-api',SENTINELA_ENVIRONMENT:'contract-test',SENTINELA_PR_NUMBER:'7',GITHUB_SHA:fixed.integratedSha,SENTINELA_ARTIFACT_DIGEST:fixed.digest,SENTINELA_DEPLOYMENT_ID:'contract-'+suffix};
  let merged=false;
  let currentIssue=issue,currentSha=fixed.sha,prNumber=7;
  const api=async(endpoint:string)=>{const pr={number:prNumber,state:merged?'closed':'open',merged,merge_commit_sha:currentSha,head:{sha:currentSha,repo:{full_name:repo}},base:{repo:{full_name:repo}},body:'Closes #'+currentIssue.number};if(endpoint.includes('/commits/'))return [pr];if(endpoint.includes('/pulls/'))return pr;if(endpoint.includes('/issues/'))return currentIssue;if(endpoint.includes('/compare/'))return {status:'identical'};throw new Error('Unexpected GitHub metadata request.');};
  const ciEvent=()=>({workflow_run:{conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo},head_sha:currentSha}});
  await notifyImplementation({env:deliveryEnv,api,event:ciEvent()});await notifyImplementation({env:deliveryEnv,api,event:ciEvent()});
  let deployments=0;await assert.rejects(deliver({env:deliveryEnv,api,deploy:async()=>{deployments++;},rollback:async()=>{}}),/merge/);assert.equal(deployments,0);
  merged=true;
  const verified=await deliver({env:deliveryEnv,api,deploy:async()=>{deployments++;await catalog!.use(catalog!.fixedImage);},rollback:async()=>catalog!.use(catalog!.badImage),verifyOptions:{timeoutMs:90000,pollMs:500}});
  assert.equal(verified.state,'verified');assert.equal(verified.commitSha,fixed.integratedSha);assert.notEqual(fixed.sha,fixed.integratedSha);assert.equal(deployments,1);
  console.log('SDLC 4/7: PR/CI vinculadas, gate de merge preservado e deploy corretivo verificado com três amostras novas.');
  await catalog.use(catalog.badImage);const second=await prepareCase([first.incidentId]);
  currentIssue=JSON.parse(await readFile(stateFile,'utf8')).issues.find((value:any)=>value.number===second.issueNumber);currentSha=catalog.badSha;prNumber=8;merged=false;
  const badEnv={...deliveryEnv,SENTINELA_PR_NUMBER:'8',GITHUB_SHA:currentSha,SENTINELA_ARTIFACT_DIGEST:await catalog.digest(catalog.badImage),SENTINELA_DEPLOYMENT_ID:'bad-contract-'+suffix};
  // Lose the pre-merge CI callback deliberately; delivery must reconcile it.
  assert.equal((await cases()).find(value=>value.id===second.id)?.state,'issue_open');merged=true;let rollbacks=0;
  await assert.rejects(deliver({env:badEnv,api,deploy:async()=>catalog!.use(catalog!.badImage),rollback:async()=>{rollbacks++;await catalog!.use(catalog!.fixedImage);},verifyOptions:{timeoutMs:90000,pollMs:500}}),/rollback/);
  assert.equal(rollbacks,1);assert.equal((await cases()).find(value=>value.id===second.id)?.state,'rolled_back');
  console.log('SDLC 5/7: artefato defeituoso recusado pela verificação e rollback executado uma única vez.');
  await waitFor('recuperação após rollback',async()=>(await snapshot()).incidents.find(item=>item.id===second.incidentId)?.status==='resolved',120000);
  await catalog.use(catalog.badImage);const third=await prepareCase([first.incidentId,second.incidentId]);
  currentIssue=JSON.parse(await readFile(stateFile,'utf8')).issues.find((value:any)=>value.number===third.issueNumber);currentSha=fixed.sha;prNumber=9;
  const staleEnv={...deliveryEnv,SENTINELA_PR_NUMBER:'9',SENTINELA_DEPLOYMENT_ID:'stale-contract-'+suffix};
  let telemetryFrozen=false,staleRollbacks=0;
  await assert.rejects(deliver({env:staleEnv,api,deploy:async()=>{await catalog!.use(catalog!.fixedImage);await waitFor('métricas saudáveis congeladas',()=>catalog!.freezeHealthyTelemetry());telemetryFrozen=true;},rollback:async()=>{staleRollbacks++;catalog!.resumeTelemetry();await catalog!.use(catalog!.fixedImage);},verifyOptions:{timeoutMs:90000,pollMs:500}}),/rollback/);
  assert.equal(telemetryFrozen,true,'O cenário exige que métricas saudáveis tenham sido congeladas antes da conclusão do deploy.');assert.equal(staleRollbacks,1);
  assert.equal((await cases()).find(value=>value.id===third.id)?.state,'rolled_back');
  console.log('SDLC 6/7: métricas saudáveis congeladas não verificam uma nova entrega.');
  await waitFor('recuperação após terceiro cenário',async()=>(await snapshot()).incidents.find(item=>item.id===third.incidentId)?.status==='resolved',120000);
  await catalog.use(catalog.badImage);const fourth=await prepareCase([first.incidentId,second.incidentId,third.incidentId]);
  currentIssue=JSON.parse(await readFile(stateFile,'utf8')).issues.find((value:any)=>value.number===fourth.issueNumber);currentSha=catalog.badSha;prNumber=10;
  const failedRollbackEnv={...badEnv,SENTINELA_PR_NUMBER:'10',SENTINELA_DEPLOYMENT_ID:'failed-rollback-'+suffix};let failedRollbacks=0;
  await assert.rejects(deliver({env:failedRollbackEnv,api,deploy:async()=>catalog!.use(catalog!.badImage),rollback:async()=>{failedRollbacks++;await catalog!.use(catalog!.badImage);},verifyOptions:{timeoutMs:90000,pollMs:500}}),/escale/);
  assert.equal(failedRollbacks,1);assert.equal((await cases()).find(item=>item.id===fourth.id)?.state,'rollback_failed');
  assert.ok((await snapshot()).events.some(event=>event.kind==='escalation'&&event.incidentId===fourth.incidentId));
  console.log('FASE 1 PASS: rollback saudável confirmado e reversão sem recuperação escalada.');
  const report={protocol:'sentinela-sdlc/v1',result:'passed',repositories:[repo,'lucasnscr/sentinela'],real:['Java HTTP','PostgreSQL','Prometheus','Next.js worker','MCP','governed implementation wrapper','regression tests','Docker replacement','verification','rollback'],controlled:['GitHub API','agent response','maintainer approval','frozen telemetry proxy'],caseId:first.id,implementationSha:fixed.sha,commitSha:fixed.integratedSha,artifactDigest:fixed.digest,healthySamples:verified.healthySamples,rollbackCaseId:second.id,staleTelemetryCaseId:third.id,failedRollbackCaseId:fourth.id,checks:['merged SHA differs from implementation SHA','missing CI callback reconciled','frozen healthy telemetry rejected','rollback recovery independently verified','failed rollback escalated']};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/sdlc-integration-report.json',JSON.stringify(report,null,2));console.log('SDLC 7/7: PASS ciclo integrado e cenário de rollback. Relatório em test-results/sdlc-integration-report.json.');
  if(process.argv.includes('--preview')){console.log('Prévia isolada, GitHub/agente controlados: '+base+'/sdlc');await Promise.race([once(process,'SIGINT'),once(process,'SIGTERM')]);}
}catch(error){console.error(error instanceof Error?error.message:'SDLC integration failed');if(appLog)console.error(appLog.slice(-1500));process.exitCode=1;}
finally{
  if(app&&app.exitCode===null){const stopped=once(app,'exit');app.kill('SIGTERM');const timer=setTimeout(()=>app?.kill('SIGKILL'),15000);await stopped;clearTimeout(timer);}
  await catalog?.cleanup();if(created)await admin.query('DROP DATABASE "'+database+'" WITH(FORCE)');await admin.end();await rm(directory,{recursive:true,force:true});
}
