import {migrate} from '@/lib/db';
import {verifyToken} from '@/lib/security';
import {acceptLifecycleEvent} from '@/lib/sdlc/events';
import {isCurrentAttempt} from '@/lib/sdlc/attempts';
export async function POST(request:Request){
  if(!verifyToken(request.headers.get('authorization'),process.env.SDLC_CALLBACK_TOKEN))return Response.json({error:'Callback não autorizado.'},{status:401});
  const text=await request.text();if(text.length>20000)return Response.json({error:'Evento muito grande.'},{status:413});
  try{await migrate();const item=await acceptLifecycleEvent(JSON.parse(text));return Response.json({caseId:item.id,state:item.state,replayed:item.receiptReplayed,currentAttempt:await isCurrentAttempt(item)},{status:202});}
  catch{return Response.json({error:'Evento SDLC inválido, divergente ou fora de ordem.'},{status:409});}
}
