import {sdlcSettings} from '@/lib/sdlc/configuration';
import {migrate} from '@/lib/db';
import {changeLearning,listLearning,exportLearning} from '@/lib/sdlc/learning';
import {checkMutation,verifyToken} from '@/lib/security';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const url=new URL(request.url),exporting=url.searchParams.has('version');
 const token=exporting?process.env.SDLC_CALLBACK_TOKEN:process.env.OPERATIONS_API_TOKEN;
 if(!verifyToken(request.headers.get('authorization'),token))return Response.json({error:'Não autorizado.'},{status:401});
 try{await migrate();const {id}=await params;return Response.json(exporting?await exportLearning(id,Number(url.searchParams.get('version'))):await listLearning(id),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Aprendizado não disponível.'},{status:404});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  checkMutation(request);if(!verifyToken(request.headers.get('authorization'),process.env.OPERATIONS_API_TOKEN))return Response.json({error:'Não autorizado.'},{status:401});
  if(!sdlcSettings().enabled)return Response.json({error:'Integração desabilitada.'},{status:503});
  const raw=await request.text();if(Buffer.byteLength(raw)>16000)return Response.json({error:'Conteúdo excede o limite.'},{status:413});
  await migrate();const {id}=await params;return Response.json(await changeLearning(id,JSON.parse(raw)));
 }catch{return Response.json({error:'Revise o conteúdo, versão, hash, evidências e estado da correção.'},{status:400});}
}
