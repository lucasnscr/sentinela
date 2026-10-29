import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run} from './process.mjs';
export function deliveryIdentity(pr,issue){
  assert.ok(Number.isSafeInteger(issue)&&issue>0);
  assert.equal(pr.head.repo.full_name,'lucasnscr/issue-to-pr-ai');
  assert.equal(pr.base.repo.full_name,pr.head.repo.full_name);
  const match=new RegExp('^ai/issue-'+issue+'-run-([1-9][0-9]*)$').exec(pr.head.ref);assert.ok(match,'PR precisa pertencer ao publisher local controlado.');
  assert.ok(pr.body.includes('<!-- local-ai-issue:'+issue+' -->'));
  const runId=Number(match[1]);assert.ok(Number.isSafeInteger(runId));return runId;
}
export async function realDelivery(pr,issue,api){
  const id=deliveryIdentity(pr,issue),repo=pr.base.repo.full_name;
  const source=api(`repos/${repo}/actions/runs/${id}`);
  assert.equal(source.path,'.github/workflows/ollama-implementation.yml');assert.equal(source.conclusion,'success');
  assert.equal(source.head_repository.full_name,repo);assert.equal(source.head_branch,'main');
  const jobs=api(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`).jobs;
  for(const name of ['authorize','Model patch','validate','publish'])assert.ok(jobs.some(job=>job.name==='implementation / '+name&&job.conclusion==='success'));
  const directory=await mkdtemp(join(tmpdir(),'real-delivery-evidence-'));
  try{
    await run('gh',['run','download',String(id),'--repo',repo,'--name',`local-frozen-${id}-${source.run_attempt}`,'--dir',directory],{quiet:true});
    const read=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
    const [task,manifest,usage]=await Promise.all(['task.json','manifest.json','ai-usage.json'].map(read));
    assert.equal(task.repository,repo);assert.equal(task.issue,issue);assert.equal(task.runId,String(id));assert.equal(task.attempt,String(source.run_attempt));
    assert.equal(manifest.engineSha,source.head_sha);assert.equal(manifest.base,task.base);
    assert.ok(['ahead','identical'].includes(api(`repos/${repo}/compare/${task.base}...${pr.base.sha}`).status));
    const hash=createHash('sha256').update(await readFile(join(directory,'candidate.patch'))).digest('hex');assert.equal(hash,manifest.patchHash);assert.ok(pr.body.includes('<!-- local-ai-patch:'+hash+' -->'));
    // A maintainer may update the branch with reviewed main. Prove the final
    // tree still equals the frozen patch applied to that updated base.
    const checkout=join(directory,'repository');
    await run('git',['clone','--quiet','--no-checkout','https://github.com/'+repo+'.git',checkout],{quiet:true});
    await run('git',['read-tree',pr.base.sha],{cwd:checkout,quiet:true});
    await run('git',['apply','--cached',join(directory,'candidate.patch')],{cwd:checkout,quiet:true});
    const expected=await run('git',['write-tree'],{cwd:checkout,quiet:true});
    const actual=await run('git',['rev-parse',pr.head.sha+'^{tree}'],{cwd:checkout,quiet:true});assert.equal(expected.output,actual.output);
    assert.equal(usage.model,'ollama/qwen3-coder:30b');assert.equal(usage.outcome,'completed');assert.equal(usage.usage.complete,true);assert.equal(usage.policy.decision,'allow');
    return {runId:id,attempt:source.run_attempt,model:usage.model,modelDigest:manifest.digest,context:manifest.context,engineSha:manifest.engineSha,patchHash:hash,steps:usage.usage.steps,policyTokenUnits:usage.usage.policyTokenUnits,durationSeconds:usage.durationSeconds,validatedHead:pr.head.sha,baseUpdated:task.base!==pr.base.sha};
  }finally{await rm(directory,{recursive:true,force:true});}
}
