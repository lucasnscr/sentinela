import {after,test} from 'node:test';import assert from 'node:assert/strict';
import {pool} from '../../lib/db';import {saveCase} from '../../lib/sdlc/store';import {changeLearning,listLearning,exportLearning} from '../../lib/sdlc/learning';import {caseFixture} from './helpers/sdlc';
after(()=>pool.end());
const content={owner:'catalog team',rootCause:'Regressão de listagem após alteração da aplicação.',evidenceIds:['log-1'],regression:{profile:'catalog-java-v1',seed:{sku:'REF-1',name:'Reference',price:'10.00'},path:'/api/products',status:200,assertions:[{pointer:'/totalElements',equals:1}]},evaluation:{action:'observe',causeKeywords:['regressão']},runbook:'Conferir a listagem e a evidência antes de encerrar o incidente.'};
test('aprovação exige caso verificado, evidências e hash corrente; novas revisões preservam versão aprovada',async()=>{
 const f=await caseFixture();try{
  await assert.rejects(changeLearning(f.item.id,{kind:'propose',content}),/verificada/);
  f.item.state='verified';f.item.commitSha='a'.repeat(40);f.item.evidence=[{id:'log-1',kind:'log',summary:'HTTP 503'}];await saveCase(f.item);
  await assert.rejects(changeLearning(f.item.id,{kind:'propose',content:{...content,evidenceIds:['unknown']}}),/evidências/);
  const a=await changeLearning(f.item.id,{kind:'propose',content});await assert.rejects(exportLearning(f.item.id,1),/aprovada/);
  const b=await changeLearning(f.item.id,{kind:'propose',content:{...content,rootCause:'Regressão revisada de listagem após alteração da aplicação.'}});assert.equal(b.version,1);assert.notEqual(a.hash,b.hash);
  await assert.rejects(changeLearning(f.item.id,{kind:'approve',version:1,hash:a.hash,reviewer:'maintainer'}),/hash/);
  const approved=await changeLearning(f.item.id,{kind:'approve',version:1,hash:b.hash,reviewer:'maintainer'});assert.equal((await exportLearning(f.item.id,1)).hash,b.hash);
  const same=await changeLearning(f.item.id,{kind:'propose',content:approved.content});assert.equal(same.version,1);assert.equal(same.state,'approved');
  const next=await changeLearning(f.item.id,{kind:'propose',content});assert.equal(next.version,2);assert.equal((await listLearning(f.item.id))[1].hash,approved.hash);
  const {rows}=await pool.query('SELECT content FROM runbooks WHERE id=$1',[`learning:${f.item.id}:v1`]);assert.equal(rows.length,1);assert.match(rows[0].content,/maintainer/);
  f.item.state='rollback_verifying';await saveCase(f.item);await assert.rejects(exportLearning(f.item.id,1),/verificada/);
 }finally{await f.cleanup();}
});
test('aprendizado aprovado publica uma issue própria uma vez e reconcilia envio incerto sem duplicar',async()=>{
 const {publishLearning}=await import('../../worker/sdlc/learning');const f=await caseFixture();try{
  f.item.state='verified';f.item.commitSha='a'.repeat(40);f.item.evidence=[{id:'log-1',kind:'log',summary:'HTTP 503'}];await saveCase(f.item);
  const draft=await changeLearning(f.item.id,{kind:'propose',content});const approved=await changeLearning(f.item.id,{kind:'approve',version:1,hash:draft.hash,reviewer:'maintainer'});
  let creates=0;let found:{number:number;url:string}|null=null;const issues={find:async()=>found,create:async(item:any)=>{creates++;assert.match(item.proposalBody,/sentinela-learning\/v1/);found={number:2,url:'https://github.com/example/catalog/issues/2'};throw new Error('Response lost after create');}};
  await assert.rejects(publishLearning(f.item.id,1,approved.hash,f.settings,issues),/não confirmada/);assert.equal((await listLearning(f.item.id))[0].delivery.state,'uncertain');
  await publishLearning(f.item.id,1,approved.hash,f.settings,issues);assert.equal(creates,1);
  await publishLearning(f.item.id,1,approved.hash,f.settings,issues,true);assert.equal((await listLearning(f.item.id))[0].delivery.state,'published');assert.equal(creates,1);
 }finally{await f.cleanup();}
});
