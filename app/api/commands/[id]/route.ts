import { pool } from '@/lib/db';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const {rows}=await pool.query('SELECT id,status,result FROM commands WHERE id=$1',[id]);
  return rows[0]?Response.json(rows[0]):Response.json({error:'Comando não encontrado.'},{status:404});
}
