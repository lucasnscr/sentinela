import {spawn} from 'node:child_process';
import type {SdlcSettings,RemediationCase} from '../../lib/sdlc/types';
export interface IssueClient {find(item:RemediationCase):Promise<{number:number;url:string}|null>;create(item:RemediationCase,title?:string):Promise<{number:number;url:string}>}
export function githubIssues(settings:SdlcSettings):IssueClient {
  async function api(args:string[],body?:unknown):Promise<any>{
    const token=process.env[settings.githubTokenEnv];if(!token)throw new Error('Credencial de publicação GitHub não configurada.');
    const program=process.env.SDLC_GH_BIN||'gh';
    return new Promise((resolve,reject)=>{
      const child=spawn(program,['api','--hostname','github.com',...args],{env:{...process.env,GH_TOKEN:token,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1'},stdio:['pipe','pipe','pipe']});
      let output='',size=0;const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2_000_000)child.kill('SIGKILL');else output+=chunk;});
      child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(body?JSON.stringify(body):undefined);
      child.on('error',()=>{});child.on('close',code=>{clearTimeout(timer);if(code!==0||size>2_000_000)return reject(new Error('GitHub não confirmou a operação. Confira acesso e permissões.'));try{resolve(JSON.parse(output));}catch{reject(new Error('Resposta GitHub inválida.'));}});
    });
  }
  function issue(item:RemediationCase,value:any){
    const number=value?.number,url=value?.html_url;
    if(!Number.isInteger(number)||number<1||url!==`https://github.com/${item.repository}/issues/${number}`)throw new Error('Identidade da issue não confirmada.');
    return {number,url};
  }
  return {
    async find(item){
      const pages=await api([`repos/${item.repository}/issues?state=all&per_page=100&since=${encodeURIComponent(item.createdAt)}`,'--paginate','--slurp']);
      const found=pages.flat().filter((value:any)=>!value.pull_request&&typeof value.body==='string'&&value.body.includes(`case=${item.id} proposal=${item.proposalHash} -->`));
      if(found.length>1)throw new Error('Há mais de uma issue para este caso; confira a vinculação.');
      return found[0]?issue(item,found[0]):null;
    },
    async create(item,title=`Correção operacional: ${item.service}`){return issue(item,await api([`repos/${item.repository}/issues`,'--method','POST','--input','-'],{title,body:item.proposalBody,labels:[]}));},
  };
}
