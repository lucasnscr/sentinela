import type { AzureFunctionsTarget, OperationPlan, RuntimeObservation } from '../../lib/operations/types';
import { commandJson, type CommandRunner } from './command';
import { version } from './adapter';

export async function observeAzureFunctions(target: AzureFunctionsTarget, run: CommandRunner): Promise<RuntimeObservation> {
  const app = commandJson(await run('az', ['functionapp', 'show', '--ids', target.resourceId, '--query', '{id:id,name:name,state:state,enabled:enabled,kind:kind,lastModifiedTimeUtc:lastModifiedTimeUtc}', '--output', 'json', '--only-show-errors']));
  if (typeof app.id !== 'string' || app.id.toLowerCase() !== target.resourceId.toLowerCase() || typeof app.kind !== 'string' || !app.kind.toLowerCase().split(',').includes('functionapp')) throw new Error('O Azure não confirmou a Function App configurada.');
  const running = app.state === 'Running' && app.enabled !== false;
  const stopped = app.state === 'Stopped' || app.enabled === false;
  const phase = running ? 'healthy' : stopped ? (target.expectedRunning ? 'degraded' : 'inactive') : 'unknown';
  return {
    targetId: target.id, runtime: target.runtime, service: target.service, scope: target.resourceId,
    at: new Date().toISOString(), phase,
    version: version({ id: app.id.toLowerCase(), state: app.state, enabled: app.enabled, lastModifiedTimeUtc: app.lastModifiedTimeUtc }),
    summary: running ? 'Function App em execução no plano de controle.' : stopped ? 'Function App parada ou desabilitada.' : 'Estado de execução não confirmado pelo Azure.',
    issues: phase === 'degraded' ? [{ code: 'FunctionAppStopped', message: 'A Function App deveria estar em execução, mas está parada ou desabilitada.' }] : [],
    details: { state: typeof app.state === 'string' ? app.state.slice(0,64) : 'unknown', enabled: app.enabled !== false, lastModifiedTimeUtc: app.lastModifiedTimeUtc || null },
    allowedActions: target.actions,
  };
}
export async function executeAzureFunctions(target: AzureFunctionsTarget, plan: OperationPlan, run: CommandRunner) {
  if (plan.action !== 'start' && plan.action !== 'restart') throw new Error('Ação Azure Functions inválida.');
  await run('az', ['functionapp', plan.action, '--ids', target.resourceId, '--output', 'none', '--only-show-errors']);
}
