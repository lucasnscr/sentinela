import type { Diagnosis, Evidence, Mitigation } from './domain';

export function evidenceDiagnosis(evidence:Evidence[],service:string,warning:string|null=null):Diagnosis{
  const logs=evidence.filter(e=>e.kind==='log'),changes=evidence.filter(e=>e.kind==='change');
  const candidates:Array<{code:string;change:string;cause:string;action:Mitigation;target:string}>=[
    {code:'POOL_ACQUIRE_TIMEOUT',change:'pool_limit',cause:'Esgotamento do pool de conexões em payments após alteração de configuração.',action:'restore_pool',target:'payments'},
    {code:'DEPENDENCY_TIMEOUT',change:'response_delay_ms',cause:'A dependência inventory excede o deadline do checkout após aumento no tempo de resposta.',action:'disable_latency',target:'inventory'},
    {code:'PAYMENT_SIGNATURE_INVALID',change:'signature_validator',cause:'A versão payments-2.4.1 rejeita assinaturas que eram aceitas pela versão anterior.',action:'rollback',target:'payments'}
  ];
  for(const candidate of candidates){
    const log=logs.find(e=>e.title.includes(candidate.code));
    const change=changes.find(e=>JSON.stringify(e.data).includes(candidate.change)&&e.service===candidate.target);
    if(!log||!change)continue;
    const supporting=[log.id,change.id,...evidence.filter(e=>e.kind==='metric'&&e.service===service).slice(-1).map(e=>e.id)];
    return {summary:'A investigação encontrou sinais compatíveis entre comportamento observado e uma alteração recente.',cause:candidate.cause,confidence:'probable',
      hypotheses:[{title:candidate.cause,explanation:'A hipótese combina erro observado, alteração de configuração ou versão e degradação da janela. A recuperação após mitigação ainda precisa ser verificada.',supportingEvidence:supporting,contradictingEvidence:[],nextCheck:'Aplicar a mitigação revisada no laboratório e observar três janelas saudáveis.'}],
      action:candidate.action,actionService:candidate.target,actionReason:'Restaurar a última configuração saudável do serviço afetado.',missingInformation:['Verificação da recuperação após a mitigação.'],mode:'rules',warning};
  }
  return {summary:'A degradação foi detectada, mas as evidências disponíveis ainda não explicam seu mecanismo.',cause:'Causa ainda não determinada',confidence:'insufficient',
    hypotheses:[],action:'observe',actionService:service,actionReason:'Reunir evidências adicionais antes de propor alteração.',missingInformation:['Logs do erro e mudanças relacionadas ao início da falha.'],mode:'rules',warning};
}
export function validateDiagnosis(diagnosis:Diagnosis,evidence:Evidence[],service:string):Diagnosis{
  const ids=new Set(evidence.map(e=>e.id));
  let invalid=false;
  const hypotheses=diagnosis.hypotheses.map(h=>{
    if([...h.supportingEvidence,...h.contradictingEvidence].some(id=>!ids.has(id)))invalid=true;
    return {...h,supportingEvidence:h.supportingEvidence.filter(id=>ids.has(id)),contradictingEvidence:h.contradictingEvidence.filter(id=>ids.has(id))};
  });
  const guard=evidenceDiagnosis(evidence,service);
  const allowed=diagnosis.action==='observe'||(diagnosis.action===guard.action&&diagnosis.actionService===guard.actionService);
  if(invalid||!hypotheses.some(h=>h.supportingEvidence.length>=2&&h.supportingEvidence.some(id=>evidence.some(e=>e.id===id&&['log','trace'].includes(e.kind)))&&new Set(h.supportingEvidence.map(id=>evidence.find(e=>e.id===id)?.kind)).size>=2))return {...diagnosis,hypotheses,confidence:'insufficient',action:'observe',actionReason:'As referências ainda não sustentam uma ação.',missingInformation:[...diagnosis.missingInformation,'Evidências válidas e independentes para a hipótese principal.']};
  return {...diagnosis,hypotheses,action:allowed?diagnosis.action:'observe',actionReason:allowed?diagnosis.actionReason:'A ação proposta não é sustentada pelo mecanismo observado.'};
}
