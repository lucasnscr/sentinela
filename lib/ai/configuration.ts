import { createHash } from 'node:crypto';
import type { AiRole, ProviderId, ProviderSettings, ResponseFormat } from './types';

export const providerLabels: Record<ProviderId, string> = {
  none: 'Desativado', openai: 'OpenAI', 'openai-compatible': 'API compatível',
  anthropic: 'Anthropic', google: 'Google Gemini', ollama: 'Ollama',
};
const endpoints: Record<ProviderId, string> = {
  none: '', openai: 'https://api.openai.com/v1', 'openai-compatible': '',
  anthropic: 'https://api.anthropic.com/v1', google: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://127.0.0.1:11434',
};
const keyNames: Record<ProviderId, string> = {
  none: '', openai: 'OPENAI_API_KEY', 'openai-compatible': 'AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', ollama: '',
};
const billingUrls: Partial<Record<ProviderId,string>> = {openai:'https://platform.openai.com/settings/organization/billing'};
const supported = Object.keys(providerLabels);
type Environment = Record<string, string | undefined>;

export function providerIdentity(provider: ProviderId, baseUrl: string, model: string, dimensions: number | null, revision = '') {
  return provider + ':' + createHash('sha256').update(JSON.stringify([baseUrl.replace(/\/$/, ''), model, dimensions, revision])).digest('hex').slice(0, 24);
}

export function parseProviderSettings(env: Environment, role: AiRole): ProviderSettings {
  const generation = role === 'diagnosis';
  const prefix = generation ? 'AI_' : 'EMBEDDING_';
  // Compatibility is limited to the original OPENAI_* configuration. An explicitly
  // selected provider never silently borrows credentials or embeddings from another.
  const legacy = !env.AI_PROVIDER && (generation || !env.EMBEDDING_PROVIDER) && !!env.OPENAI_API_KEY;
  const requested = env[prefix + 'PROVIDER'] || (legacy ? 'openai' : 'none');
  const provider = (supported.includes(requested) ? requested : 'none') as ProviderId;
  let configurationError: string | null = supported.includes(requested) ? null : 'Provedor desconhecido: use AI_PROVIDER ou EMBEDDING_PROVIDER com um adaptador suportado.';
  if (!generation && provider === 'anthropic') configurationError = 'Este adaptador Anthropic não oferece embeddings; configure outro EMBEDDING_PROVIDER.';
  const legacyModel = provider === 'openai' ? (generation ? env.OPENAI_MODEL : env.OPENAI_EMBEDDING_MODEL) : undefined;
  const model = env[prefix + 'MODEL'] || legacyModel || (legacy ? (generation ? 'gpt-4.1-mini' : 'text-embedding-3-small') : '');
  const baseUrl = (env[prefix + 'BASE_URL'] || endpoints[provider]).replace(/\/+$/, '');
  if (provider !== 'none') {
    if (!model) configurationError ||= 'Configure ' + prefix + 'MODEL com o identificador do modelo desejado.';
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { configurationError ||= 'Configure ' + prefix + 'BASE_URL com uma URL HTTP(S) sem credenciais, query ou fragmento.'; }
  }
  const apiKeyEnv = env[prefix + 'API_KEY_ENV'] || (provider === 'openai-compatible' && !generation ? 'EMBEDDING_API_KEY' : keyNames[provider]);
  const apiKey = env[prefix + 'API_KEY'] || (apiKeyEnv ? env[apiKeyEnv] : undefined);
  const requiresKey = ['openai', 'anthropic', 'google'].includes(provider);
  if (requiresKey && !apiKey) configurationError ||= 'Credencial do provedor não configurada (' + (apiKeyEnv || prefix + 'API_KEY') + ').';
  const rawDimensions = env.EMBEDDING_DIMENSIONS || (legacy && !generation ? '1536' : '');
  const dimensions = !generation && rawDimensions ? Number(rawDimensions) : null;
  if (!generation && dimensions !== null && (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 16000)) configurationError ||= 'EMBEDDING_DIMENSIONS deve ser um inteiro entre 1 e 16000.';
  const responseFormat = env.AI_RESPONSE_FORMAT || 'json_schema';
  if (!['json_schema', 'json_object', 'prompt'].includes(responseFormat)) configurationError ||= 'AI_RESPONSE_FORMAT inválido.';
  const rawTimeout = env[prefix + 'TIMEOUT_MS'];
  const timeoutMs = (() => {
    if (rawTimeout === undefined || rawTimeout === '') {
      return generation ? 30000 : 20000;
    }
    
    const timeoutValue = Number(rawTimeout);
    if (!Number.isInteger(timeoutValue) || timeoutValue < 100 || timeoutValue > 300000) {
      configurationError ||= `${prefix}TIMEOUT_MS deve ser um inteiro entre 100 e 300000 ms.`;
      return generation ? 30000 : 20000;
    }
    
    return timeoutValue;
  })();
  const revision = generation ? responseFormat : env.EMBEDDING_REVISION || '';
  const credentialFingerprint = createHash('sha256').update(apiKey || '').digest('hex').slice(0, 16);
  const identity = providerIdentity(provider, baseUrl, model, dimensions, revision + ':' + credentialFingerprint);
  return {role, provider, label: providerLabels[provider], model, baseUrl, apiKey, apiKeyEnv,
    dimensions, responseFormat: responseFormat as ResponseFormat, timeoutMs,
    configured: provider !== 'none' && !configurationError, configurationError, identity, billingUrl:billingUrls[provider]||null,
    embeddingSpace: providerIdentity(provider, baseUrl, model, dimensions, generation ? '' : env.EMBEDDING_REVISION || ''),
    inheritLegacyCircuit: legacy && provider === 'openai' && baseUrl === endpoints.openai};
}
