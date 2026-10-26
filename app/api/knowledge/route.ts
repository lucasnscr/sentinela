import { z } from 'zod';
import { listRunbooks, migrate } from '@/lib/db';
import { queryEmbedding, saveRunbook, searchRunbooks } from '@/lib/knowledge';
import { checkMutation, safeError } from '@/lib/security';
import type { EmbeddingVector } from '@/lib/ai/types';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  await migrate();const query=new URL(request.url).searchParams.get('q')?.trim().slice(0,1000);
  if(!query)return Response.json(await listRunbooks());
  let embedding:EmbeddingVector|null=null;
  try{embedding=await queryEmbedding(query);}catch{}
  return Response.json(await searchRunbooks(query,['checkout','payments','inventory'],embedding));
}
export async function POST(request:Request){
  try{
    checkMutation(request);await migrate();
    const body=z.object({title:z.string().min(3).max(160),service:z.enum(['*','checkout','payments','inventory']),content:z.string().min(30).max(30000)}).parse(await request.json());
    return Response.json(await saveRunbook(body.title,body.service,body.content),{status:201});
  }catch(error){return Response.json({error:error instanceof z.ZodError?'Informe título e conteúdo com pelo menos 30 caracteres.':safeError(error)},{status:400});}
}
