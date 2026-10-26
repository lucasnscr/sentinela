import type { OperationAction, OperationPlan, OperationsSettings, RuntimeObservation, RuntimeTarget } from './types';
import { targetHash } from './configuration';

export function validateOperation(target: RuntimeTarget, observation: RuntimeObservation, action: OperationAction, replicas?: number) {
  if (observation.targetId !== target.id || observation.runtime !== target.runtime || observation.service !== target.service) throw new Error('Observação não corresponde ao alvo.');
  if (!target.actions.includes(action)) throw new Error('Ação não permitida para este alvo.');
  if (Date.now() - new Date(observation.at).getTime() > 60000) throw new Error('Observação antiga. Aguarde uma nova coleta.');
  if (target.runtime === 'kubernetes') {
    if (observation.details.paused || observation.phase === 'unknown' || observation.phase === 'transitioning') throw new Error('Deployment pausado ou em transição. Aguarde antes de ajustar.');
    if (action === 'scale') {
      if (observation.details.hpa !== false) throw new Error('Escala manual bloqueada: HPA presente ou estado não confirmado.');
      if (!Number.isInteger(replicas) || replicas! < target.minReplicas || replicas! > target.maxReplicas) throw new Error(`Réplicas devem ficar entre ${target.minReplicas} e ${target.maxReplicas}.`);
      if (replicas === observation.details.desired) throw new Error('O Deployment já possui essa quantidade de réplicas.');
    } else if (action !== 'restart' || observation.phase === 'inactive') throw new Error('Ação não aplicável ao Deployment.');
  } else {
    if (!target.healthUrl) throw new Error('Configure healthUrl para verificar o resultado do ajuste no Azure.');
    if (observation.details.enabled !== true) throw new Error('Function App desabilitada; a reativação exige revisão da configuração no Azure.');
    if (action === 'start' && observation.details.state !== 'Stopped') throw new Error('Iniciar só é permitido para uma Function App parada.');
    if (action === 'restart' && observation.details.state !== 'Running') throw new Error('Reiniciar exige uma Function App em execução.');
    if (action !== 'start' && action !== 'restart') throw new Error('Ação não suportada no Azure Functions.');
  }
  if (action !== 'scale' && replicas !== undefined) throw new Error('Réplicas só se aplicam à ação de escala.');
}
export function validateReviewedPlan(settings: OperationsSettings, target: RuntimeTarget, plan: OperationPlan, current: RuntimeObservation) {
  if (!settings.enabled || !settings.executionEnabled) throw new Error('Execução operacional desabilitada.');
  if (plan.state !== 'executing') throw new Error('Plano não está reservado para execução.');
  if (Date.now() >= new Date(plan.expiresAt).getTime()) throw new Error('Plano expirado. Gere outro plano.');
  if (plan.configHash !== targetHash(target)) throw new Error('Política do alvo mudou. Gere outro plano.');
  if (plan.before.version !== current.version) throw new Error('O alvo mudou após a proposta. Gere outro plano.');
  validateOperation(target, current, plan.action, plan.replicas);
}
export function operationImpact(action: OperationAction, observation: RuntimeObservation, replicas?: number) {
  if (action === 'scale') return `Alterar de ${observation.details.desired} para ${replicas} réplicas. Pode alterar custo e capacidade; o controlador fará a convergência.`;
  if (action === 'start') return 'Iniciar a Function App. Pode retomar triggers e processamento pendente, além de gerar consumo.';
  return 'Reiniciar o workload. Pode interromper requisições ou execuções em andamento; não corrige código ou configuração defeituosa.';
}
export function isOperationRecovered(plan: OperationPlan, observation: RuntimeObservation) {
  if (observation.targetId !== plan.targetId || observation.phase !== 'healthy' || !plan.executedAt || new Date(observation.at) <= new Date(plan.executedAt)) return false;
  if (plan.runtime === 'azure-functions') return observation.details.healthCheck === 'passed';
  if (plan.action === 'scale') return observation.details.desired === plan.replicas;
  return observation.details.restartMarker === plan.id;
}
