import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { config } from '../lib/config';
export async function connectTools(){
  const client=new Client({name:'sentinela-investigator',version:'0.1.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','worker/mcp.ts'],env:{PATH:process.env.PATH||'',DATABASE_URL:config.databaseUrl,AI_MODE:'rules'},stderr:'inherit'});
  await client.connect(transport);
  return {
    async call<T>(name:string,args:Record<string,unknown>):Promise<T>{
      const result=await client.callTool({name,arguments:args});
      if(result.isError)throw new Error('Ferramenta MCP '+name+' não conseguiu consultar as evidências.');
      const text=result.content?.find((c:any)=>c.type==='text') as {text:string}|undefined;
      if(!text)throw new Error('Ferramenta MCP retornou resposta vazia.');
      return JSON.parse(text.text) as T;
    },
    close:()=>client.close()
  };
}
export type Tools=Awaited<ReturnType<typeof connectTools>>;
