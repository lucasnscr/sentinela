import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OperationsSettings, RuntimeTarget } from './types';

const name = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/);
const base = {
  id: name, service: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  healthUrl: z.url({ protocol: /^https?$/ }).refine(value => {
    const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash;
  }, 'Healthcheck deve omitir credenciais e parâmetros.').optional(),
  healthKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
};
export const targetSchema = z.discriminatedUnion('runtime', [
  z.object({ ...base, runtime: z.literal('kubernetes'),
    context: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:/@-]+$/),
    namespace: name, deployment: name,
    actions: z.array(z.enum(['restart', 'scale'])).default([]),
    minReplicas: z.number().int().min(1).max(100).default(1),
    maxReplicas: z.number().int().min(1).max(100).default(5),
  }).strict().refine(value => value.maxReplicas >= value.minReplicas),
  z.object({ ...base, runtime: z.literal('azure-functions'),
    resourceId: z.string().regex(/^\/subscriptions\/[a-fA-F0-9-]{36}\/resourceGroups\/[A-Za-z0-9_.()-]+\/providers\/Microsoft\.Web\/sites\/[A-Za-z0-9-]{2,60}$/i),
    expectedRunning: z.boolean().default(true),
    actions: z.array(z.enum(['start', 'restart'])).default([]),
  }).strict(),
]);
const schema = z.object({ targets: z.array(targetSchema).max(20) }).strict();
export function parseOperationsConfig(input: unknown): RuntimeTarget[] {
  const targets = schema.parse(input).targets as RuntimeTarget[];
  for (const target of targets) if(target.healthKeyEnv){
    if(!target.healthUrl)throw new Error('Credencial de healthcheck exige uma URL.');
    const url=new URL(target.healthUrl);
    if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Healthcheck autenticado remoto exige HTTPS.');
  }
  if (new Set(targets.map(target => target.id)).size !== targets.length ||
      new Set(targets.map(target => target.service)).size !== targets.length) {
    throw new Error('Cada alvo e serviço operacional deve ter um identificador único.');
  }
  return targets;
}
export function targetHash(target: RuntimeTarget) {
  return createHash('sha256').update(JSON.stringify(target)).digest('hex');
}
function number(value: string | undefined, fallback: number, minimum: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 3600000) throw new Error('Intervalo operacional inválido.');
  return parsed;
}
export async function loadOperationsSettings(env: Record<string, string | undefined>): Promise<OperationsSettings> {
  const enabled = env.OPERATIONS_ENABLED === 'true';
  const executionEnabled = enabled && env.OPERATIONS_EXECUTION_ENABLED === 'true';
  const intervalMs = number(env.OPERATIONS_INTERVAL_MS, 15000, 5000);
  const cooldownMs = number(env.OPERATIONS_COOLDOWN_MS, 300000, 30000);
  if (!enabled) return { enabled, executionEnabled: false, intervalMs, cooldownMs, targets: [] };
  if (!env.OPERATIONS_CONFIG_FILE) throw new Error('Configure OPERATIONS_CONFIG_FILE para habilitar operações.');
  const source = await readFile(env.OPERATIONS_CONFIG_FILE, 'utf8');
  if (source.length > 100000) throw new Error('Configuração operacional muito grande.');
  let targets: RuntimeTarget[];
  try { targets = parseOperationsConfig(JSON.parse(source)); }
  catch { throw new Error('Configuração de alvos operacionais inválida. Revise o arquivo configurado.'); }
  if (executionEnabled && (!env.OPERATIONS_API_TOKEN || env.OPERATIONS_API_TOKEN.length < 24)) {
    throw new Error('A execução operacional exige OPERATIONS_API_TOKEN com pelo menos 24 caracteres.');
  }
  return { enabled, executionEnabled, intervalMs, cooldownMs, targets };
}
