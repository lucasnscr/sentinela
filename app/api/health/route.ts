import { getMeta, migrate, pool } from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){
  try{
    await migrate();await pool.query('SELECT 1');
    const heartbeat=await getMeta<string>('heartbeat');
    const worker=!!heartbeat&&Date.now()-new Date(heartbeat).getTime()<15000;
    return Response.json({database:true,worker},{status:worker?200:503});
  }catch{return Response.json({database:false,worker:false},{status:503});}
}
