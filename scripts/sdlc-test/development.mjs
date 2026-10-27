import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function exerciseDevelopment({command,cases,fourth,fixed,stateFile,deliveryEnv,api,notifyImplementation,ciEvent,setContext}){
  await command({kind:'sdlc_propose',requestId:randomUUID(),incidentId:fourth.incidentId,previousCaseId:fourth.id,correctionKind:'application',summary:'Nova hipótese após falha de rollback; acompanhar CI e encerramento.',acceptanceCriteria:['Não entregar uma PR reprovada ou encerrada.'],evidenceIds:[]});
  const outcome=(await cases()).find(item=>item.previousCaseId===fourth.id);
  await command({kind:'sdlc_publish',requestId:randomUUID(),caseId:outcome.id,proposalHash:outcome.proposalHash});
  const published=(await cases()).find(item=>item.id===outcome.id);
  const currentIssue=JSON.parse(await readFile(stateFile,'utf8')).issues.find(value=>value.number===published.issueNumber);setContext(currentIssue,fixed.sha,12,false);
  const failedCi=ciEvent();failedCi.workflow_run.id=50;failedCi.workflow_run.conclusion='failure';
  await notifyImplementation({env:deliveryEnv,api,event:failedCi});assert.equal((await cases()).find(item=>item.id===outcome.id)?.state,'ci_failed');
  const goodCi=ciEvent();goodCi.workflow_run.id=51;await notifyImplementation({env:deliveryEnv,api,event:goodCi});
  await notifyImplementation({env:deliveryEnv,api,event:failedCi});assert.equal((await cases()).find(item=>item.id===outcome.id)?.state,'pr_open');
  setContext(currentIssue,fixed.sha,12,true);await notifyImplementation({env:deliveryEnv,api,event:{action:'closed',pull_request:{number:12,head:{sha:fixed.sha}}}});
  assert.equal((await cases()).find(item=>item.id===outcome.id)?.state,'cancelled');
  console.log('FASE 3 PASS: CI falha/retoma, evento antigo ignorado e PR encerrada bloqueada.');
  return outcome;
}
