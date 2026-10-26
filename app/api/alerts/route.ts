import { z } from 'zod';
import { config } from '@/lib/config';
import { enqueue, migrate } from '@/lib/db';
import { verifyToken } from '@/lib/security';
const schema=z.object({alerts:z.array(z.object({status:z.enum(['firing','resolved']),labels:z.object({service:z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),alertname:z.string().max(150).optional()}),annotations:z.object({summary:z.string().max(300).optional()}).optional(),fingerprint:z.string().max(100).optional()})).max(50)});
export async function POST(request:Request){
  if(!process.env.ALERT_WEBHOOK_TOKEN)return Response.json({error:'Webhook não configurado.'},{status:503});
  if(!verifyToken(request.headers.get('authorization'),process.env.ALERT_WEBHOOK_TOKEN))return Response.json({error:'Não autorizado.'},{status:401});
  if(Number(request.headers.get('content-length')||0)>100000)return Response.json({error:'Payload muito grande.'},{status:413});
  const text=await request.text();if(text.length>100000)return Response.json({error:'Payload muito grande.'},{status:413});
  let parsed;try{parsed=schema.safeParse(JSON.parse(text));}catch{return Response.json({error:'JSON inválido.'},{status:400});}
  if(!parsed.success)return Response.json({error:'Payload Alertmanager inválido.'},{status:400});
  await migrate();let accepted=0;
  for(const alert of parsed.data.alerts)if(alert.status==='firing'&&config.services.includes(alert.labels.service)){
    await enqueue('alert',{service:alert.labels.service,title:alert.annotations?.summary||alert.labels.alertname||'Degradação em '+alert.labels.service});accepted++;
  }
  return Response.json({accepted},{status:202});
}
