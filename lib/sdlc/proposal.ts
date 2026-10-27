import {createHash} from 'node:crypto';
import {caseMarker} from '../../contracts/sdlc-v1.mjs';
import type {RemediationCase} from './types';
export function redactProposal(value:string){
  return value.replace(/(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{12,}/g,'[credencial removida]')
    .replace(/Bearer\s+[^\s]+/gi,'Bearer [removido]')
    .replace(/https?:\/\/[^\s<>()]+/g,raw=>{try{const url=new URL(raw);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return '[URL removida]';}});
}
export function renderProposal(input:Pick<RemediationCase,'id'|'incidentId'|'repository'|'service'|'environment'|'kind'|'summary'|'acceptanceCriteria'|'evidence'|'attempt'|'previousCaseId'|'recoveryPolicy'|'recoveryPolicyHash'>){
  const normalized={...input,summary:redactProposal(input.summary),acceptanceCriteria:input.acceptanceCriteria.map(redactProposal),evidence:input.evidence.map(item=>({...item,summary:redactProposal(item.summary)}))};
  const hash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const body=[caseMarker(input.id,hash),'',`# Correção operacional: ${input.service}`,'',
    `- Caso: ${input.id}`,`- Incidente: ${input.incidentId}`,`- Tentativa: ${input.attempt||1}`,...(input.previousCaseId?[`- Caso anterior: ${input.previousCaseId}`]:[]),`- Repositório: ${input.repository}`,`- Serviço/ambiente: ${input.service} / ${input.environment}`,`- Tipo: ${input.kind}`,'',
    '## Problema revisado','',normalized.summary,'','## Evidências selecionadas','',
    ...normalized.evidence.map(item=>`- [${item.id}] ${item.kind}: ${item.summary}`),'','## Critérios de aceite','',
    ...normalized.acceptanceCriteria.map(item=>'- [ ] '+item),'',
    '## Verificação operacional','',
    ...(input.recoveryPolicy?[`Política revisada: ${input.recoveryPolicy.version}; hash ${input.recoveryPolicyHash}.`,`${input.recoveryPolicy.minimumSamples} amostras novas; estabilidade de ${input.recoveryPolicy.stabilityMs}ms; intervalo máximo ${input.recoveryPolicy.maxSampleGapMs}ms.`,'Critérios do deploy:',...input.recoveryPolicy.probes.map(p=>`- ${p.id} (${p.kind}): HTTP ${p.status}; `+p.assertions.map(a=>a.pointer+' '+a.op+' '+redactProposal(JSON.stringify(a.value))).join('; ')), 'Critérios do rollback:',...input.recoveryPolicy.rollbackProbes.map(p=>`- ${p.id} (${p.kind}): HTTP ${p.status}; `+p.assertions.map(a=>a.pointer+' '+a.op+' '+redactProposal(JSON.stringify(a.value))).join('; ')),'']:[]),
    'Registrar PR, SHA, digest do artefato e deploy no Sentinela. A correção só termina após novas amostras saudáveis, não pelo merge ou pelo fechamento desta issue.','',
    input.kind==='configuration'?'Revisar a configuração versionada e reconciliar o ajuste operacional permanente. Alterações de infraestrutura seguem o mantenedor.':'Adicionar um teste de regressão e preservar os contratos existentes.','',
    'Esta issue contém dados operacionais revisados, não autorização para implementar. O mantenedor decide critérios, ai:ready, execução, revisão e merge.'].join('\n');
  if(Buffer.byteLength(body)>16000)throw new Error('Proposta muito grande; reduza as evidências e os critérios.');
  return {proposalHash:hash,proposalBody:body,...normalized};
}
