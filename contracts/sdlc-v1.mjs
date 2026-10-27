// Shared, dependency-free wire contract. Keep identical in both repositories.
export const protocol='sentinela-sdlc/v1';
export const developmentTypes=['ci.failed','ci.cancelled','implementation.failed','implementation.cancelled','pull_request.closed'];
const fail=message=>{throw new Error(message);};
const string=(value,name,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max?value:fail('Invalid '+name);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'')?value:fail('Invalid case ID');
const number=value=>Number.isSafeInteger(value)&&value>0?value:fail('Invalid issue/PR number');
export function repository(value){return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value||'')&&value.length<=200?value:fail('Invalid repository');}
export function caseMarker(caseId,proposalHash){
  uuid(caseId);if(!/^[a-f0-9]{64}$/.test(proposalHash||''))fail('Invalid proposal hash');
  return '<!-- '+protocol+' case='+caseId+' proposal='+proposalHash+' -->';
}
export function extractCase(body){
  if(typeof body!=='string')return null;
  const matches=[...body.matchAll(/<!-- sentinela-sdlc\/v1 case=([a-f0-9-]+) proposal=([a-f0-9]+) -->/g)];
  if(!matches.length)return null;if(matches.length!==1)fail('Ambiguous Sentinela case marker');
  caseMarker(matches[0][1],matches[0][2]);return {caseId:matches[0][1],proposalHash:matches[0][2]};
}
export function validateEvent(input){
  if(!input||input.protocol!==protocol)fail('Unsupported SDLC protocol');
  const types=['implementation.published','deployment.started','deployment.completed','deployment.failed','deployment.rolled_back','deployment.rollback_failed',...developmentTypes];
  if(!types.includes(input.type))fail('Invalid lifecycle event');
  const type=input.type;
  const id=string(input.id,'event ID',180);if(!/^[A-Za-z0-9:_.-]+$/.test(id))fail('Invalid event ID');
  const at=string(input.at,'timestamp',40);if(!Number.isFinite(Date.parse(at)))fail('Invalid timestamp');
  const caseId=uuid(input.caseId),repo=repository(input.repository);
  const proposalHash=string(input.proposalHash,'proposal hash',64);if(!/^[a-f0-9]{64}$/.test(proposalHash))fail('Invalid proposal hash');
  const commitSha=string(input.commitSha,'commit',40);if(!/^[a-f0-9]{40}$/.test(commitSha))fail('Full commit SHA required');
  const service=string(input.service,'service',64),environment=string(input.environment,'environment',64);
  if(!/^[A-Za-z0-9_.-]+$/.test(service)||!/^[A-Za-z0-9_.-]+$/.test(environment))fail('Invalid service/environment');
  const beforePr=['implementation.failed','implementation.cancelled'].includes(type);
  if(beforePr&&input.pullRequestNumber!==null)fail('Pre-PR outcome must not bind a pull request');
  if(type.startsWith('ci.')&&input.runId===undefined)fail('CI outcome requires execution identity');
  const result={protocol,type,id,at,caseId,repository:repo,proposalHash,commitSha,service,environment,
    issueNumber:number(input.issueNumber),pullRequestNumber:beforePr&&input.pullRequestNumber==null?null:number(input.pullRequestNumber)};
  if(input.runId!==undefined){result.runId=number(input.runId);result.runAttempt=number(input.runAttempt);}
  if(developmentTypes.includes(type)){
    const executionId=string(input.executionId,'execution ID',100);if(!/^[A-Za-z0-9:_.-]+$/.test(executionId))fail('Invalid execution ID');
    const reason=type==='pull_request.closed'?'closed_without_merge':type.endsWith('cancelled')?'cancelled':'failure';
    if(input.reason!==reason)fail('Invalid development outcome');
    return {...result,executionId,reason};
  }
  if(type.startsWith('deployment.')){
    const deploymentId=string(input.deploymentId,'deployment ID',150);
    if(!/^[A-Za-z0-9_.:-]+$/.test(deploymentId))fail('Invalid deployment ID');
    const artifactDigest=string(input.artifactDigest,'artifact digest',71);
    if(!/^sha256:[a-f0-9]{64}$/.test(artifactDigest))fail('Immutable artifact digest required');
    return {...result,deploymentId,artifactDigest};
  }
  return result;
}
export function eventId(type,caseId,identity){return type+':'+uuid(caseId)+':'+string(identity,'event identity',100);}
