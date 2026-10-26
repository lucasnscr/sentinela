import {execFileSync} from 'node:child_process';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
const LIMIT=20000;
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024});
const lockfiles=new Set(['package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb','Cargo.lock','Gemfile.lock','poetry.lock','uv.lock','Pipfile.lock','composer.lock','packages.lock.json']);
export function checkStagedFiles(){
  const root=git('rev-parse','--show-toplevel').trim();process.chdir(root);
  const paths=git('diff','--cached','--name-only','--diff-filter=ACMRT','-z').split('\0').filter(Boolean);
  const failures=[];
  for(const path of paths){
    const name=basename(path);
    if(lockfiles.has(name)||name==='next-env.d.ts'||/\.(?:generated|g)\.[^/]+$/.test(name)||name.endsWith('.tsbuildinfo')||/(?:^|\/)(?:__generated__|generated|generated-sources|node_modules|\.next)(?:\/|$)/.test(path))continue;
    const attributes=git('check-attr','--cached','-z','linguist-generated','generated','--',path).split('\0');
    if(attributes.some((value,index)=>index%3===2&&(value==='true'||value==='set')))continue;
    const entry=git('ls-files','--stage','-z','--',path).split('\0').find(value=>value.endsWith('\t'+path));
    if(!entry||entry.startsWith('160000 '))continue;
    const object=entry.split(' ')[1];
    const bytes=Number(git('cat-file','-s',object).trim());
    if(bytes>LIMIT)failures.push({path,bytes,tokens:bytes/4});
  }
  if(failures.length){
    console.error('Commit blocked: authored staged files must not exceed 5,000 estimated tokens (20,000 bytes; tokens = bytes/4).');
    for(const file of failures)console.error('  '+file.path+': '+file.bytes+' bytes / '+file.tokens+' estimated tokens');
    console.error('\nSplit each file by responsibility before committing:\n  1. Move independent components, functions, schemas, styles, or test suites into named modules.\n  2. Keep a small entry point that imports those modules; preserve existing behavior and tests.\n  3. For documentation, move sections into separate pages and link them from an index.\n  4. Run the relevant checks, then git add the split files and commit again.\nGenerated output should be regenerated rather than split manually. Mark genuine codegen with a staged .gitattributes entry: path/to/output/** linguist-generated=true. Do not mark maintained source as generated.');
    return 1;
  }
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=checkStagedFiles();
