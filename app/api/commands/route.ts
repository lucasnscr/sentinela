import { z } from 'zod';
import { enqueue, findIncident, getMeta, migrate } from '@/lib/db';
import { checkMutation, safeError, verifyToken } from '@/lib/security';
import { config } from '@/lib/config';
const schema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('inject'),scenario:z.enum(['pool_exhaustion','dependency_latency','bad_deployment'])}),
  z.object({kind:z.literal('reset')}),
  z.object({kind:z.literal('review'),incidentId:z.uuid(),approve:z.boolean()}),
  z.object({kind:z.literal('reinvestigate'),incidentId:z.uuid()}),
  z.object({kind:z.literal('operation_plan'),targetId:z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/),action:z.enum(['start','restart','scale']),replicas:z.number().int().min(1).max(100).optional(),requestId:z.uuid()}),
  z.object({kind:z.literal('operation_review'),planId:z.uuid(),approve:z.boolean()}),
  z.object({kind:z.literal('operation_reconcile'),planId:z.uuid(),note:z.string().trim().min(10).max(500)})
]);
export async function POST(request:Request){
  try{
    checkMutation(request);await migrate();
    const heartbeat=await getMeta<string>('heartbeat');
    if(!heartbeat||Date.now()-new Date(heartbeat).getTime()>15000)return Response.json({error:'O worker está desconectado. Inicie npm run worker.'},{status:503});
    const body=schema.parse(await request.json());
    if(body.kind==='operation_plan'||body.kind==='operation_review'||body.kind==='operation_reconcile'){
      if(!verifyToken(request.headers.get('authorization'),process.env.OPERATIONS_API_TOKEN))return Response.json({error:'Token de operação inválido ou não configurado.'},{status:401});
    }
    if((body.kind==='inject'||body.kind==='reset')&&(!config.labEnabled||config.prometheusUrl))return Response.json({error:'Comando restrito ao laboratório local.'},{status:403});
    let key:string|null=null;
    if(body.kind==='operation_plan')key='operation-plan:'+body.targetId+':'+body.requestId;
    if(body.kind==='operation_review')key='operation-review:'+body.planId;
    if(body.kind==='operation_reconcile')key='operation-reconcile:'+body.planId;
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
