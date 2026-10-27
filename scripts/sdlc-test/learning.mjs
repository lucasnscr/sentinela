import assert from 'node:assert/strict';
import {readFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run,waitFor} from './process.mjs';
export async function exerciseLearning({base,token,callback,item,peer,catalog,repo,stateFile}){
 const endpoint=base+`/api/sdlc/cases/${item.id}/learning`;
 const content={owner:'catalog reference team',rootCause:'Regressão no endpoint de listagem que devolvia HTTP 503.',evidenceIds:item.evidence.slice(0,1).map(e=>e.id),regression:{profile:'catalog-java-v1',seed:{sku:'REF-LEARNING',name:'Learning reference',price:'19.90'},path:'/api/products',status:200,assertions:[{pointer:'/totalElements',equals:1},{pointer:'/content/0/sku',equals:'REF-LEARNING'},{pointer:'/content/0/price',equals:19.9}]},evaluation:{action:'observe',causeKeywords:['regressão','listagem']},runbook:'Conferir o HTTP 503, comparar a mudança e reproduzir a regressão com PostgreSQL. Após a correção, validar listagem, SKU e preço; aguardar a recuperação observada antes de encerrar.'};
 async function post(body){return fetch(endpoint,{method:'POST',headers:{origin:base,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});}
 const draftResponse=await post({kind:'propose',content});assert.equal(draftResponse.status,200,await draftResponse.clone().text());const draft=await draftResponse.json();
 assert.equal((await post({kind:'approve',version:draft.version,hash:'0'.repeat(64),reviewer:'contract-maintainer'})).status,400);
 const approval=await post({kind:'approve',version:draft.version,hash:draft.hash,reviewer:'contract-maintainer'});assert.equal(approval.status,200);
 const {fetchLearning,generateLearning}=await import(pathToFileURL(path.join(peer,'scripts/sentinela/learning.mjs')).href);
 const approved=await fetchLearning(item.id,1,{env:{GITHUB_REPOSITORY:repo,SENTINELA_URL:base,SENTINELA_CALLBACK_TOKEN:callback}});
 const learningIssue=await waitFor('issue de aprendizado aprovada',async()=>JSON.parse(await readFile(stateFile,'utf8')).issues.find(issue=>issue.body.includes('sentinela-learning/v1')&&issue.body.includes('case='+item.id)));
 const {prepareLearningIssue}=await import(pathToFileURL(path.join(peer,'scripts/sentinela/learning-issue.mjs')).href);
 const prepared=await prepareLearningIssue(learningIssue.number,{env:{GITHUB_REPOSITORY:repo,SENTINELA_URL:base,SENTINELA_CALLBACK_TOKEN:callback},api:async()=>learningIssue});assert.equal(prepared.hash,approved.hash);
 const manifest=await generateLearning(approved,{root:catalog.checkout,repository:repo});assert.deepEqual(await generateLearning(approved,{root:catalog.checkout,repository:repo}),manifest);
 const {evaluateDiagnosis}=await import(pathToFileURL(path.join(peer,'contracts/learning-v1.mjs')).href);
 assert.equal(evaluateDiagnosis(approved,{action:'rollback',cause:'Sem evidências',hypotheses:[]}).passed,false);
 assert.equal(evaluateDiagnosis(approved,{action:'observe',cause:'Regressão de listagem reproduzida',hypotheses:[{supportingEvidence:content.evidenceIds}]}).passed,true);
 const red=path.join(catalog.directory,'learning-red');
 await run('git',['worktree','add','--detach',red,catalog.badSha],{cwd:catalog.checkout,quiet:true});
 try{
  for(const name of Object.keys(manifest.files).filter(name=>name.startsWith('apps/'))){await mkdir(path.dirname(path.join(red,name)),{recursive:true});await cp(path.join(catalog.checkout,name),path.join(red,name));}
  const args=['-B','-ntp','verify','-Dit.test='+manifest.className,'-DfailIfNoTests=false','-Dsentinela.contract.failure=true'];
  const failed=await run('./mvnw',args,{cwd:red,quiet:true,allowFailure:true});assert.notEqual(failed.code,0,'O teste gerado deve reproduzir a regressão.');
  const report=await readFile(path.join(red,'apps/catalog-api/target/failsafe-reports/TEST-dev.continuousai.catalog.product.'+manifest.className+'.xml'),'utf8');assert.match(report,/<failure/);assert.match(report,/503/);
  await run('./mvnw',args,{cwd:catalog.checkout,quiet:true});
 }finally{await run('git',['worktree','remove','--force',red],{cwd:catalog.checkout,quiet:true,allowFailure:true});}
 console.log('FASE 4 PASS: aprendizado aprovado, teste gerado vermelho/verde com PostgreSQL e avaliação verificável.');
 return {caseId:item.id,version:approved.version,hash:approved.hash,className:manifest.className};
}
