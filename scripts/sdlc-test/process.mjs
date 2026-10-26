import {spawn} from 'node:child_process';
export async function run(command,args,{cwd,env=process.env,allowFailure=false,quiet=false,timeout=600000,input}={}){
  const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe']});let output='';
  child.stdin.on('error',()=>{});child.stdin.end(input);
  const capture=chunk=>{output=(output+chunk).slice(-12000);if(!quiet)process.stdout.write(chunk);};child.stdout.on('data',capture);child.stderr.on('data',capture);
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);
  if(code!==0&&!allowFailure)throw new Error(command+' failed: '+code+'\n'+output.slice(-1200));return {code,output:output.trim()};
}
export async function waitFor(label,fn,timeout=90000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await fn();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}throw new Error('Timeout: '+label);}
