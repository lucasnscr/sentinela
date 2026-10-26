import { z } from 'zod';
import { enqueue, findIncident, getMeta, migrate } from '@/lib/db';
import { checkMutation, safeError } from '@/lib/security';
import { config } from '@/lib/config';
const schema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('inject'),scenario:z.enum(['pool_exhaustion','dependency_latency','bad_deployment'])}),
  z.object({kind:z.literal('reset')}),
  z.object({kind:z.literal('review'),incidentId:z.uuid(),approve:z.boolean()}),
  z.object({kind:z.literal('reinvestigate'),incidentId:z.uuid()})
]);
export async function POST(request:Request){
  try{
    checkMutation(request);await migrate();
    const heartbeat=await getMeta<string>('heartbeat');
    if(!heartbeat||Date.now()-new Date(heartbeat).getTime()>15000)return Response.json({error:'O worker está desconectado. Inicie npm run worker.'},{status:503});
    const body=schema.parse(await request.json());
    if((body.kind==='inject'||body.kind==='reset')&&(!config.labEnabled||config.prometheusUrl))return Response.json({error:'Comando restrito ao laboratório local.'},{status:403});
    let key:string|null=null;
    if(body.kind==='review'||body.kind==='reinvestigate'){
      const incident=await findIncident(body.incidentId);
      if(!incident||incident.status==='resolved')return Response.json({error:'Incidente não está ativo.'},{status:409});
      if(body.kind==='review'){
        if(incident.status!=='awaiting_review')return Response.json({error:'Não há mitigação aguardando revisão.'},{status:409});
        key='review:'+incident.id+':'+incident.attempts;
      }
    }
    const {kind,...payload}=body;
    return Response.json(await enqueue(kind,payload,key),{status:202});
  }catch(error){return Response.json({error:error instanceof z.ZodError?'Solicitação inválida.':safeError(error)},{status:400});}
}
