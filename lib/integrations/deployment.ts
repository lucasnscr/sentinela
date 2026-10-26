import { createHash } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
  commit: z.string().regex(/^[a-fA-F0-9]{7,40}$/).transform(value => value.toLowerCase()),
  service: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  environment: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  deploymentId: z.string().min(1).max(150).optional(),
  version: z.string().min(1).max(150).optional(),
  issueNumber: z.coerce.number().int().positive().optional(),
  pullRequestNumber: z.coerce.number().int().positive().optional(),
  applicationUrl: z.url({ protocol: /^https?$/ }).optional(),
  at: z.iso.datetime(),
});

export function deploymentEvent(env: Record<string, string | undefined>, at = new Date().toISOString()) {
  const parsed = schema.safeParse({
    repository: env.SOURCE_REPOSITORY || env.GITHUB_REPOSITORY,
    commit: env.SOURCE_COMMIT || env.GITHUB_SHA,
    service: env.SERVICE_NAME,
    environment: env.DEPLOYMENT_ENVIRONMENT || 'local',
    deploymentId: env.DEPLOYMENT_ID || env.GITHUB_RUN_ID || undefined,
    version: env.DEPLOYMENT_VERSION || undefined,
    issueNumber: env.SOURCE_ISSUE_NUMBER || undefined,
    pullRequestNumber: env.SOURCE_PR_NUMBER || undefined,
    applicationUrl: env.APPLICATION_URL || undefined,
    at,
  });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))];
    throw new Error('Metadados de deploy inválidos: ' + fields.join(', ') + '.');
  }
  const data = parsed.data;
  if (data.applicationUrl) {
    const url = new URL(data.applicationUrl);
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('APPLICATION_URL deve omitir credenciais, query e fragmento.');
    }
  }
  // Retries of one deployment preserve the ID; a new deploymentId distinguishes
  // redeployments of the same commit. No credential becomes event data.
  const identity = [data.repository, data.commit, data.service, data.environment, data.deploymentId || '', data.version || ''];
  const id = 'deploy-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const references = [data.issueNumber ? `issue #${data.issueNumber}` : '', data.pullRequestNumber ? `PR #${data.pullRequestNumber}` : ''].filter(Boolean);
  return {
    id, kind: 'change' as const, service: data.service, at: data.at,
    title: `Deploy ${data.service} ${data.commit.slice(0, 7)}`,
    detail: `${data.repository}@${data.commit} no ambiente ${data.environment}. ` +
      (references.length ? references.join(', ') + '. ' : '') +
      'Correlacionar com a telemetria; proximidade temporal não comprova causa.',
    data: {
      repository: data.repository, commitSha: data.commit, environment: data.environment,
      deploymentId: data.deploymentId, version: data.version,
      issueNumber: data.issueNumber, pullRequestNumber: data.pullRequestNumber,
      applicationUrl: data.applicationUrl,
    },
  };
}

export async function reportDeployment(env: Record<string, string | undefined>, event: ReturnType<typeof deploymentEvent>) {
  let endpoint: URL;
  try {
    const base = new URL(env.SENTINELA_URL || '');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && local))) throw new Error();
    endpoint = new URL('/api/telemetry', base);
  } catch {
    throw new Error('SENTINELA_URL deve ser uma origem HTTPS ou HTTP em loopback, sem credenciais.');
  }
  const token = env.SENTINELA_INGEST_TOKEN;
  if (!token || !/^\S{16,}$/.test(token)) throw new Error('Configure SENTINELA_INGEST_TOKEN com pelo menos 16 caracteres, sem espaços.');
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
    });
  } catch {
    throw new Error('Não foi possível enviar o evento ao Sentinela. Confira a URL e a conectividade.');
  }
  if (response.status !== 202) throw new Error('Sentinela recusou o evento: HTTP ' + response.status + '.');
  const result = await response.json().catch(() => null);
  if (result?.accepted !== 1) throw new Error('Sentinela não confirmou o recebimento do evento.');
}
