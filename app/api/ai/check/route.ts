import { z } from 'zod';
import { aiConnectionStatus, checkProvider, recordAiFailure } from '@/lib/ai';
import { checkMutation } from '@/lib/security';
import { migrate } from '@/lib/db';
import { indexKnowledge } from '@/lib/knowledge';
export async function POST(request:Request){
  try{checkMutation(request);}catch{return Response.json({error:'Solicitação recusada.'},{status:400});}
  await migrate();
  const body=z.object({role:z.enum(['diagnosis','embedding']).default('diagnosis')}).safeParse(await request.json().catch(()=>null));
  if(!body.success)return Response.json({error:'Informe diagnosis ou embedding.'},{status:400});
  const {role}=body.data;
  const connection=await aiConnectionStatus(role);
  if(!connection.configured)return Response.json({error:connection.error||'Nenhum provedor foi configurado para esta função.'},{status:503});
  try{
    const result=await checkProvider(role);
    if(role==='embedding')void indexKnowledge().catch(()=>{});
    return Response.json({ok:true,role,provider:connection.provider,providerLabel:connection.label,model:connection.model,...result});
  }catch(error){return Response.json({error:await recordAiFailure(error,role)},{status:503});}
}
