import {migrate,enqueue} from '@/lib/db';
import {listCases} from '@/lib/sdlc/store';
import {sdlcSettings} from '@/lib/sdlc/configuration';
import {checkMutation,verifyToken} from '@/lib/security';
import {z} from 'zod';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('sdlc_cancel'),requestId:z.uuid().optional(),caseId:z.uuid(),proposalHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(5).max(500)}),
  z.object({kind:z.literal('sdlc_propose'),requestId:z.uuid().optional(),incidentId:z.uuid(),previousCaseId:z.uuid().optional(),summary:z.string().min(10).max(1500),acceptanceCriteria:z.array(z.string().min(5).max(300)).min(1).max(12),evidenceIds:z.array(z.string().max(150)).max(12),correctionKind:z.enum(['application','configuration'])}),
  z.object({kind:z.literal('sdlc_publish'),requestId:z.uuid().optional(),caseId:z.uuid(),proposalHash:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.object({kind:z.literal('sdlc_reconcile'),requestId:z.uuid().optional(),caseId:z.uuid()}),
]);
export async function GET(){await migrate();const settings=sdlcSettings();return Response.json({enabled:settings.enabled,repository:settings.repository,maxAttempts:settings.maxAttempts||3,cases:await listCases()},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
  try{
    checkMutation(request);if(!verifyToken(request.headers.get('authorization'),process.env.OPERATIONS_API_TOKEN))return Response.json({error:'Token de operação inválido.'},{status:401});
    const settings=sdlcSettings();if(!settings.enabled)return Response.json({error:'Integração SDLC desabilitada.'},{status:503});
    const text=await request.text();if(text.length>20000)return Response.json({error:'Solicitação muito grande.'},{status:413});
    const body=command.parse(JSON.parse(text));await migrate();const {kind,...payload}=body;
    const identity=kind==='sdlc_propose'?(payload as {incidentId:string}).incidentId:(payload as {caseId:string}).caseId;
    return Response.json(await enqueue(kind,payload,kind+':'+identity+('previousCaseId' in payload?':'+payload.previousCaseId:'')+('requestId' in payload?':'+payload.requestId:'')),{status:202});
  }catch{return Response.json({error:'Solicitação SDLC inválida.'},{status:400});}
}
