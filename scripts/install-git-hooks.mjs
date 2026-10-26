import {execFileSync} from 'node:child_process';
import {chmodSync} from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let current='';try{current=git('config','--get','core.hooksPath');}catch{}
if(current&&current!=='.githooks')throw new Error('An existing core.hooksPath is configured. Integrate .githooks/pre-commit with that hook instead of overwriting it.');
const root=git('rev-parse','--show-toplevel');process.chdir(root);
chmodSync('.githooks/pre-commit',0o755);
git('config','--local','core.hooksPath','.githooks');
console.log('Installed staged-file limit hook for this checkout: 5,000 tokens = 20,000 bytes.');
