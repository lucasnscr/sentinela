import { getSnapshot } from '@/lib/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json(await getSnapshot(),{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Banco indisponível. Inicie o PostgreSQL com npm run db:up.'},{status:503});}
}
