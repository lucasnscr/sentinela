import { randomUUID } from 'node:crypto';
import { loadOperationsSettings, targetHash } from '../lib/operations/configuration';
import { isOperationRecovered, operationImpact, validateOperation, validateReviewedPlan } from '../lib/operations/policy';
import { claimPlan, getPlan, findPlanByRequest, hasRecentExecution, expirePendingPlan, operationPlans, saveObservation, savePlan, setPlanState } from '../lib/operations/store';
import type { OperationAction, OperationPlan, OperationsSettings, RuntimeObservation, RuntimeTarget } from '../lib/operations/types';
import { closeIncident, event, openIncident, pool, putEvidence, setMeta } from '../lib/db';
import type { Metric } from '../lib/domain';
import { isHealthy } from '../lib/detection';
import { createRuntimeAdapter, type RuntimeAdapter } from './runtime/adapter';
import { runCommand } from './runtime/command';

export async function createOperations(adapter: RuntimeAdapter = createRuntimeAdapter(runCommand), supplied?: OperationsSettings) {
  let settings: OperationsSettings;
  try { settings = supplied || await loadOperationsSettings(process.env); }
  catch {
    await setMeta('operationsSettings', { enabled: false, executionEnabled: false, intervalMs: 15000, targetIds: [], error: 'Não foi possível carregar os alvos operacionais. Revise a configuração do worker.' });
    await event('error', 'Conector operacional indisponível', 'Revise OPERATIONS_CONFIG_FILE e as políticas de execução.');
    settings = { enabled: false, executionEnabled: false, intervalMs: 15000, cooldownMs: 300000, targets: [] };
    return { tick: async (_metrics: Metric[]) => {}, plan: async () => { throw new Error('Operações indisponíveis.'); }, review: async () => { throw new Error('Operações indisponíveis.'); }, reconcile: async () => { throw new Error('Operações indisponíveis.'); } };
  }
  await setMeta('operationsSettings', { enabled: settings.enabled, executionEnabled: settings.executionEnabled, intervalMs: settings.intervalMs, targetIds: settings.targets.map(target => target.id), error: null });
  // An interrupted provider call has an ambiguous outcome. Never replay it.
  for (const plan of await operationPlans(['executing'])) {
    plan.state = 'uncertain'; plan.result = 'O worker reiniciou durante a execução. Confira o provedor antes de propor outro ajuste.';
    await setPlanState(plan); await audit(plan, 'Execução interrompida; resultado precisa de conferência');
  }
  let lastTick = 0;
  const unhealthy = new Map<string, number>(), healthy = new Map<string, number>();
  function targetFor(id: string) {
    const target = settings.targets.find(item => item.id === id);
    if (!settings.enabled || !target) throw new Error('Alvo operacional não está habilitado.');
    return target;
  }
  async function audit(plan: OperationPlan, title: string) {
    await event('operation', title, `${plan.runtime} / ${plan.targetId}: ${plan.action}. ${plan.result || plan.reason}`, plan.incidentId);
  }
  async function propose(target: RuntimeTarget, action: OperationAction, replicas: number | undefined, requestId: string, reason: string) {
    const existing = await findPlanByRequest(target.id,requestId);
    if (existing) return existing;
    const activePlans = await operationPlans(['pending', 'executing', 'verifying', 'uncertain']);
    if (activePlans.some(plan => plan.targetId === target.id)) throw new Error('Já há um plano pendente ou uma execução a conferir para este alvo.');
    const observation = await adapter.observe(target);
    validateOperation(target, observation, action, replicas);
    const { rows } = await pool.query("SELECT id FROM incidents WHERE environment=$1 AND status<>'resolved' ORDER BY created_at DESC LIMIT 1", ['runtime:' + target.id]);
    const now = Date.now();
    const plan: OperationPlan = {
      id: randomUUID(), targetId: target.id, runtime: target.runtime, service: target.service,
      action, replicas, state: 'pending', reason, impact: operationImpact(action, observation, replicas),
      before: observation, configHash: targetHash(target), requestId,
      expected: action === 'scale' ? `${replicas} réplicas disponíveis e rollout atualizado.` : target.runtime === 'azure-functions' ? 'Function App Running e três healthchecks HTTP 200.' : 'Nova revisão observada, com três coletas de réplicas prontas.',
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
      healthyChecks: 0, result: null, incidentId: rows[0]?.id || null,
    };
    if (await savePlan(plan)) {await audit(plan, 'Plano operacional proposto para revisão');return plan;}
    return (await findPlanByRequest(target.id,requestId))!;
  }
  async function review(id: string, approve: boolean) {
    const known = await getPlan(id);
    if (!known) throw new Error('Plano não encontrado.');
    if (known.state !== 'pending') return;
    if (!approve) {
      const declined = await claimPlan(id); if (!declined) return;
      declined.state = 'declined'; declined.result = 'Operador recusou o ajuste.'; await setPlanState(declined); await audit(declined, 'Ajuste operacional recusado'); return;
    }
    if (!settings.executionEnabled) throw new Error('Execução operacional desabilitada. O plano pode ser revisado sem executar.');
    const plan = await claimPlan(id); if (!plan) return;
    let mutationStarted = false;
    try {
      const target = targetFor(plan.targetId);
      const recent = await hasRecentExecution(target.id,plan.id,settings.cooldownMs);
      if (recent) throw new Error('Aguarde o intervalo mínimo entre ajustes deste alvo.');
      const current = await adapter.observe(target);
      validateReviewedPlan(settings, target, plan, current);
      plan.executedAt = new Date().toISOString();
      await setPlanState(plan); await audit(plan, 'Ajuste aprovado; execução reservada');
      mutationStarted = true;
      await adapter.execute(target, plan, current);
      plan.state = 'verifying'; plan.verificationDeadline = new Date(Date.now() + 300000).toISOString();
      plan.result = 'Comando aceito pelo provedor. Aguardando confirmação nas próximas coletas.';
      await setPlanState(plan); await audit(plan, 'Ajuste enviado; verificando resultado');
    } catch (error) {
      plan.state = mutationStarted ? 'uncertain' : 'failed';
      // Preflight errors are controlled policy errors. Provider errors never
      // reveal their response or credentials and never trigger an automatic retry.
      plan.result = mutationStarted ? 'Resultado da chamada não confirmado. Confira o provedor; a ação não será repetida automaticamente.' : error instanceof Error ? error.message : 'O ajuste foi recusado antes da execução.';
      await setPlanState(plan); await audit(plan, mutationStarted ? 'Resultado operacional precisa de conferência' : 'Ajuste bloqueado antes da execução');
      throw new Error(plan.result);
    }
  }
  async function tick(metrics: Metric[]) {
    if (!settings.enabled || Date.now() - lastTick < settings.intervalMs) return;
    lastTick = Date.now();
    for (const plan of await operationPlans(['pending'])) if (Date.now() >= new Date(plan.expiresAt).getTime()) {
      plan.state = 'expired'; plan.result = 'A validade do plano terminou. Proponha outro ajuste com uma nova observação.'; if(await expirePendingPlan(plan))await audit(plan, 'Plano operacional expirado');
    }
    for (const target of settings.targets) {
      let observation: RuntimeObservation;
      try { observation = await adapter.observe(target); }
      catch {
        observation = { targetId: target.id, runtime: target.runtime, service: target.service, scope: target.runtime === 'kubernetes' ? `${target.context}/${target.namespace}/${target.deployment}` : target.resourceId,
          at: new Date().toISOString(), phase: 'unknown', version: '', summary: 'Coleta indisponível. Confira conectividade, CLI e permissões.',
          issues: [{ code: 'CollectionUnavailable', message: 'O conector não conseguiu obter uma observação válida.' }], details: {}, allowedActions: target.actions };
      }
      await saveObservation(observation);
      await putEvidence({ id: 'runtime:' + randomUUID(), kind: 'runtime', service: target.service, at: observation.at,
        title: `Runtime ${target.runtime}: ${observation.phase}`, detail: observation.summary,
        data: { targetId: target.id, phase: observation.phase, issues: observation.issues, ...observation.details } });
      unhealthy.set(target.id, observation.phase === 'degraded' ? (unhealthy.get(target.id) || 0) + 1 : 0);
      const appMetric = metrics.find(metric => metric.service === target.service);
      const recovered = observation.phase === 'healthy' && (!appMetric || isHealthy(appMetric));
      healthy.set(target.id, recovered ? (healthy.get(target.id) || 0) + 1 : 0);
      const fingerprint = 'runtime:' + target.id + ':degradation';
      if ((unhealthy.get(target.id) || 0) >= 2) {
        const opened = await openIncident(target.service, 'runtime:' + target.id, 'Falha operacional em ' + target.service, fingerprint);
        if (opened.created) await event('alert', 'Degradação do ambiente detectada', observation.summary, opened.incident.id);
        const action = target.runtime === 'azure-functions' && observation.issues.some(issue => issue.code === 'FunctionAppStopped') && observation.details.enabled === true ? 'start' : observation.issues.some(issue => issue.code === 'HealthCheckFailed') ? 'restart' : undefined;
        if (action && target.actions.includes(action)) {
          try { await propose(target, action, undefined, 'auto:' + opened.incident.id + ':' + observation.version + ':' + action, observation.summary); }
          catch { /* A pending plan or unsupported action is visible in the console. */ }
        }
      }
      if ((healthy.get(target.id) || 0) >= 3) {
        const { rows } = await pool.query("SELECT id FROM incidents WHERE fingerprint=$1 AND status<>'resolved'", [fingerprint]);
        for (const incident of rows) await closeIncident(incident.id,true);
      }
      for (const plan of (await operationPlans(['verifying'])).filter(item => item.targetId === target.id)) {
        plan.healthyChecks = isOperationRecovered(plan, observation) && (!appMetric || isHealthy(appMetric)) ? plan.healthyChecks + 1 : 0;
        if (plan.healthyChecks >= 3) { plan.state = 'succeeded'; plan.result = 'Resultado confirmado por três coletas saudáveis após o ajuste.'; await audit(plan, 'Resultado do ajuste verificado'); }
        else if (Date.now() >= new Date(plan.verificationDeadline!).getTime()) { plan.state = 'failed'; plan.result = 'O provedor aceitou o comando, mas o resultado esperado não foi confirmado em cinco minutos.'; await audit(plan, 'Ajuste sem recuperação confirmada'); }
        await setPlanState(plan);
      }
    }
  }
  return {
    tick,
    plan: (input: { targetId: string; action: OperationAction; replicas?: number; requestId: string }) => propose(targetFor(input.targetId), input.action, input.replicas, input.requestId, 'Ajuste solicitado pelo operador.'),
    review,
    async reconcile(id:string,note:string) {
      const plan = await getPlan(id);
      if (!plan || plan.state !== 'uncertain') throw new Error('O plano não aguarda conferência.');
      if (note.trim().length < 10 || note.length > 500) throw new Error('Descreva a conferência feita no provedor.');
      const target = targetFor(plan.targetId);
      const current = await adapter.observe(target);
      plan.state = 'acknowledged';
      plan.result = `Conferência registrada pelo operador: ${note.trim()} Estado observado: ${current.phase}. Nenhuma ação foi repetida.`;
      await setPlanState(plan); await audit(plan,'Resultado incerto conferido pelo operador');
    },
  };
}
