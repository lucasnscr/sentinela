import { createHash } from 'node:crypto';
import type { OperationPlan, RuntimeObservation, RuntimeTarget } from '../../lib/operations/types';
import type { CommandRunner } from './command';
import { observeKubernetes, executeKubernetes } from './kubernetes';
import { observeAzureFunctions, executeAzureFunctions } from './azure-functions';

export function version(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export interface RuntimeAdapter {
  observe(target: RuntimeTarget): Promise<RuntimeObservation>;
  execute(target: RuntimeTarget, plan: OperationPlan, current: RuntimeObservation): Promise<void>;
}
export function createRuntimeAdapter(run: CommandRunner): RuntimeAdapter {
  return {
    async observe(target) {
      const observation = target.runtime === 'kubernetes' ? await observeKubernetes(target, run) : await observeAzureFunctions(target, run);
      if (target.healthUrl && observation.phase === 'healthy') {
        try {
          const headers: Record<string, string> = {};
          if (target.healthKeyEnv) {
            const key = process.env[target.healthKeyEnv];
            if (!key) throw new Error('Healthcheck sem credencial.');
            headers['x-functions-key'] = key;
          }
          const response = await fetch(target.healthUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(4000) });
          await response.body?.cancel();
          if (response.status !== 200) throw new Error('Healthcheck recusado.');
          observation.details.healthCheck = 'passed';
        } catch {
          observation.phase = 'degraded'; observation.summary = 'O healthcheck da aplicação falhou.';
          observation.issues.push({ code: 'HealthCheckFailed', message: 'O endpoint configurado não confirmou HTTP 200.' });
          observation.details.healthCheck = 'failed';
        }
      }
      if (target.runtime === 'azure-functions' && observation.phase === 'healthy' && !target.healthUrl) {
        observation.phase = 'unknown';
        observation.summary = 'Function App em execução; configure um healthcheck para verificar a aplicação.';
      }
      observation.version=version({control:observation.version,phase:observation.phase,
        issues:[...new Set(observation.issues.map(issue=>issue.code))].sort(),hpa:observation.details.hpa??null,health:observation.details.healthCheck??null});
      return observation;
    },
    execute: (target, plan, current) => target.runtime === 'kubernetes' ? executeKubernetes(target, plan, current, run) : executeAzureFunctions(target, plan, run),
  };
}
