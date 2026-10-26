import { aiConnectionStatus, checkProvider, recordAiFailure } from '../lib/ai';
import { migrate, pool } from '../lib/db';
import { safeError } from '../lib/security';
import type { AiRole } from '../lib/ai/types';

const role:AiRole=process.argv.includes('--embedding')?'embedding':'diagnosis';
try{
  await migrate();
  const connection=await aiConnectionStatus(role);
  if(!connection.configured)throw new Error(connection.error||'Configure o provedor antes de executar este teste.');
  const result=await checkProvider(role);
  console.log(connection.label+': '+role+' validado com '+connection.model+('dimensions' in result?' ('+result.dimensions+' dimensões)':'')+'.');
}catch(error){
  await recordAiFailure(error,role).catch(()=>{});
  console.error('IA: '+safeError(error));process.exitCode=1;
}finally{await pool.end();}
