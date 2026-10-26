import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const checker=path.resolve('scripts/check-staged-file-size.mjs');
function fixture(run){
  const dir=mkdtempSync(path.join(tmpdir(),'staged-limit-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  const write=(name,value)=>{mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),value);};
  const check=()=>spawnSync(process.execPath,[checker],{cwd:dir,encoding:'utf8'});
  try{git('init','-q');git('config','user.name','contract-test');git('config','user.email','test@example.invalid');run({git,write,check});}
  finally{rmSync(dir,{recursive:true,force:true});}
}
test('exactly 20,000 staged bytes passes and 20,001 fails with splitting instructions',()=>fixture(({git,write,check})=>{
  write('source.ts','x'.repeat(20000));git('add','source.ts');assert.equal(check().status,0);
  write('source.ts','x'.repeat(20001));git('add','source.ts');const result=check();assert.equal(result.status,1);
  assert.match(result.stderr,/20001 bytes/);assert.match(result.stderr,/Split each file by responsibility/);assert.match(result.stderr,/git add/);
}));
test('checks staged blobs rather than unstaged working files, including UTF-8 bytes',()=>fixture(({git,write,check})=>{
  write('source.ts','é'.repeat(10000));git('add','source.ts');write('source.ts','x'.repeat(50000));assert.equal(check().status,0);
  write('source.ts','é'.repeat(10001));git('add','source.ts');write('source.ts','small');assert.equal(check().status,1);
}));
test('unstaged files are not scanned and lockfiles and declared generated files are ignored',()=>fixture(({git,write,check})=>{
  write('unstaged.ts','x'.repeat(50000));write('package-lock.json','x'.repeat(50000));write('client.generated.ts','x'.repeat(50000));
  write('api/client.ts','x'.repeat(50000));write('.gitattributes','api/** linguist-generated=true\n');git('add','package-lock.json','client.generated.ts','api/client.ts','.gitattributes');assert.equal(check().status,0);
}));
test('unstaged generated attributes cannot exempt a staged authored source',()=>fixture(({git,write,check})=>{
  write('source.ts','x'.repeat(20001));git('add','source.ts');write('.gitattributes','source.ts linguist-generated=true\n');assert.equal(check().status,1);
}));
test('supports paths containing spaces and newlines and skips staged deletions',()=>fixture(({git,write,check})=>{
  const name='path with space/file\nname.ts';write(name,'x'.repeat(20001));git('add','--',name);assert.equal(check().status,1);
  git('commit','-qm','fixture baseline');git('rm','--',name);assert.equal(check().status,0);
}));

test('installed hook rejects an actual commit of an oversized staged file',()=>fixture(({git,write})=>{
  write('scripts/check-staged-file-size.mjs',readFileSync(checker));
  write('.githooks/pre-commit','#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/check-staged-file-size.mjs"\n');
  const root=git('rev-parse','--show-toplevel').toString().trim();
  execFileSync('chmod',['755','.githooks/pre-commit'],{cwd:root});git('config','core.hooksPath','.githooks');
  write('source.ts','x'.repeat(20001));git('add','.');
  const attempt=spawnSync('git',['commit','-m','must be blocked'],{cwd:root,encoding:'utf8'});
  assert.notEqual(attempt.status,0);assert.match(attempt.stderr,/Commit blocked/);assert.match(attempt.stderr,/Split each file/);
}));
