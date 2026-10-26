import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '@/lib/config';
import { migrate, putEvidence } from '@/lib/db';
import { verifyToken } from '@/lib/security';
const schema=z.object({events:z.array(z.object({
  id:z.string().min(1).max(150).optional(),kind:z.enum(['log','trace','change']),
  service:z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),at:z.iso.datetime(),
  title:z.string().min(1).max(200),detail:z.string().max(4000),
  data:z.record(z.string(),z.unknown())
})).max(50)});
export async function POST(request:Request){
  if(!verifyToken(request.headers.get('authorization'),process.env.TELEMETRY_INGEST_TOKEN))return Response.json({error:'Não autorizado.'},{status:401});
  const body=await request.text();
  if(body.length>100000)return Response.json({error:'Payload muito grande.'},{status:413});
  let parsed;
  try{parsed=schema.safeParse(JSON.parse(body));}catch{return Response.json({error:'JSON inválido.'},{status:400});}
  if(!parsed.success)return Response.json({error:'Telemetria inválida.'},{status:400});
  if(parsed.data.events.some(e=>!config.services.includes(e.service)))return Response.json({error:'Serviço fora do escopo configurado.'},{status:400});
  await migrate();
  for(const item of parsed.data.events)await putEvidence({...item,id:item.id||randomUUID()});
  return Response.json({accepted:parsed.data.events.length},{status:202});
}
