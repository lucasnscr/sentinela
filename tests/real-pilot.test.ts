import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {deliveryIdentity} from '../scripts/sdlc-test/real-delivery.mjs';
test('evidência real recusa PR de fork, outro caso e branch que imita o publisher',()=>{
  const repo={full_name:'lucasnscr/issue-to-pr-ai'};
  const pr={head:{repo,ref:'ai/issue-85-run-40931294568'},base:{repo},body:'Closes #85\n<!-- local-ai-issue:85 -->'};
  assert.equal(deliveryIdentity(pr,85),40931294568);
  assert.throws(()=>deliveryIdentity({...pr,head:{...pr.head,repo:{full_name:'attacker/fork'}}},85));
  assert.throws(()=>deliveryIdentity({...pr,base:{repo:{full_name:'other/target'}}},85));
  assert.throws(()=>deliveryIdentity({...pr,body:'Closes #85'},85));
  assert.throws(()=>deliveryIdentity(pr,86));
  assert.throws(()=>deliveryIdentity({...pr,head:{...pr.head,ref:'ai/issue-85-run-999999999999999999999'}},85));
});
test('piloto real exige opt-in antes de iniciar banco, Docker ou publicação',()=>{
  const result=spawnSync(process.execPath,['--import','tsx','scripts/sdlc-real-pilot.ts'],{encoding:'utf8',timeout:10000,env:{...process.env,DATABASE_URL:'postgresql://invalid:invalid@127.0.0.1:1/invalid'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Opt-in obrigatório/);
  assert.doesNotMatch(result.stderr,/ECONNREFUSED|Docker|GitHub não confirmou/);
});
