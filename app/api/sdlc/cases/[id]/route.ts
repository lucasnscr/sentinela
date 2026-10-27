import {migrate} from '@/lib/db';
import {getCase} from '@/lib/sdlc/store';
import {verifyToken} from '@/lib/security';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!verifyToken(request.headers.get('authorization'),process.env.SDLC_CALLBACK_TOKEN))return Response.json({error:'Não autorizado.'},{status:401});
  await migrate();const {id}=await params,item=await getCase(id);if(!item)return Response.json({error:'Caso não encontrado.'},{status:404});
  return Response.json({caseId:item.id,state:item.state,repository:item.repository,issueNumber:item.issueNumber,pullRequestNumber:item.pullRequestNumber,commitSha:item.commitSha,artifactDigest:item.artifactDigest,deploymentId:item.deploymentId,healthySamples:item.healthySamples,rollbackSamples:item.rollbackSamples||0,result:item.result},{headers:{'Cache-Control':'no-store'}});
}
