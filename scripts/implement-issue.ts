import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateImplementationConfig(value:unknown){
  const config=value as {version?:number;repository?:string;profile?:string;engineRepository?:string;engineSha?:string};
  if(config?.version!==1||config.repository!=='lucasnscr/sentinela'||config.profile!=='sentinela-typescript'||
    config.engineRepository!=='lucasnscr/issue-to-pr-ai'||!/^[a-f0-9]{40}$/.test(config.engineSha||''))throw new Error('Configuração de implementação inválida; use repositório, perfil e SHA revisados.');
  return config as Required<typeof config>;
}

async function main(){
  const argument=process.argv[2]?.match(/^--issue=([1-9]\d*)$/);
  if(!argument||!Number.isSafeInteger(Number(argument[1]))||process.argv.length!==3)throw new Error('Use npm run implement:issue -- --issue=N.');
  const config=validateImplementationConfig(JSON.parse(readFileSync(new URL('../config/implementation.json',import.meta.url),'utf8')));
  const temporary=mkdtempSync(join(tmpdir(),'sentinela-engine-'));
  const engine=join(temporary,'engine');
  try{
    execFileSync('git',['clone','--quiet','https://github.com/'+config.engineRepository+'.git',engine],{stdio:'inherit'});
    execFileSync('git',['checkout','--quiet','--detach',config.engineSha],{cwd:engine,stdio:'inherit'});
    const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:engine,encoding:'utf8'}).trim();
    if(actual!==config.engineSha)throw new Error('SHA do engine divergente.');
    execFileSync(process.execPath,[join(engine,'scripts/local-issue.mjs'),'--repo='+config.repository,'--issue='+argument[1]],{cwd:engine,stdio:'inherit'});
  }finally{
    const reports=new URL('../test-results/',import.meta.url);mkdirSync(reports,{recursive:true});
    for(const suffix of ['.json','-failed-usage.json','-validation.log','-scope.txt','-failed.patch','-http.log']){
      const name='local-issue-'+argument[1]+suffix;
      try{copyFileSync(join(engine,'artifacts',name),new URL(name,reports));}catch{}
    }
    rmSync(temporary,{recursive:true,force:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main().catch(()=>{console.error('Implementação interrompida. Confira autorização, VM dedicada e configuração do engine.');process.exitCode=1;});
