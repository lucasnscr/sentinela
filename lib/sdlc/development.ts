import type {RemediationCase} from './types';
export function staleCi(item:RemediationCase,message:any){
  if(!message.runId)return false;
  if((item.latestCiRunId||0)>message.runId||item.latestCiRunId===message.runId&&(item.latestCiRunAttempt||0)>message.runAttempt)return true;
  item.latestCiRunId=message.runId;item.latestCiRunAttempt=message.runAttempt;return false;
}
export function applyDevelopmentOutcome(item:RemediationCase,message:any){
  if(['ci.failed','ci.cancelled'].includes(message.type)){
    if(staleCi(item,message)||!['issue_open','pr_open','ci_failed','implementation_failed'].includes(item.state))return;
    if(item.pullRequestNumber&&item.pullRequestNumber!==message.pullRequestNumber)throw new Error('PR divergente.');
    item.pullRequestNumber=message.pullRequestNumber;item.implementationSha=message.commitSha;item.state='ci_failed';
    item.result=message.type==='ci.cancelled'?'CI cancelada; aguarde outra execução ou encerre a PR.':'CI reprovada; a entrega permanece bloqueada.';
  }else if(message.type==='pull_request.closed'){
    if(!['issue_open','pr_open','ci_failed','implementation_failed','abandoned'].includes(item.state))return;
    if(item.pullRequestNumber&&item.pullRequestNumber!==message.pullRequestNumber)throw new Error('PR divergente.');
    item.pullRequestNumber=message.pullRequestNumber;item.developmentClosedAt=new Date().toISOString();item.state='cancelled';item.result='PR encerrada sem merge. Outra correção exige nova tentativa revisada.';
  }else{
    if(item.pullRequestNumber||!['issue_open','implementation_failed'].includes(item.state))return;
    item.state=message.type==='implementation.cancelled'?'cancelled':'implementation_failed';
    item.result=message.type==='implementation.cancelled'?'Implementação cancelada; nenhuma entrega foi autorizada.':'Implementação interrompida; revise a execução antes de continuar.';
  }
  item.development={type:message.type,executionId:message.executionId,reason:message.reason,at:new Date().toISOString()};
}
