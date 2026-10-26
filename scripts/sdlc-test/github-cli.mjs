import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const file=process.env.SDLC_CONTRACT_STATE;if(!file||!path.basename(path.dirname(file)).startsWith('sentinela-sdlc-'))throw new Error('Isolated contract state required.');
const state=JSON.parse(await readFile(file,'utf8')),args=process.argv.slice(2),endpoint=args.find(value=>value.startsWith('repos/'));
if(args.includes('POST')){
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());
  const number=state.issues.length+1;const issue={...input,number,html_url:'https://github.com/'+state.repository+'/issues/'+number,state:'open'};state.issues.push(issue);await writeFile(file,JSON.stringify(state));console.log(JSON.stringify(issue));
}else if(endpoint?.includes('/issues?'))console.log(JSON.stringify([state.issues]));
else throw new Error('Unsupported contract command.');
