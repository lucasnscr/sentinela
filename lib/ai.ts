import { z } from 'zod';
import { config } from './config';
import { getMeta, setMeta } from './db';
import { createAiState } from './ai/state';
import { createEmbeddingProvider, createModelProvider } from './ai/providers';
import type { AiConnectionStatus, AiRole, GenerationRequest } from './ai/types';

export function providerSettings(role: AiRole) { return role === 'diagnosis' ? config.diagnosis : config.embedding; }
function state(role: AiRole) { return createAiState(providerSettings(role), config.aiMode, {get: getMeta, set: setMeta}); }
export function aiAvailability(role: AiRole = 'diagnosis') { return state(role).availability(); }
export function recordAiFailure(error: unknown, role: AiRole = 'diagnosis') { return state(role).failure(error); }
export function clearAiFailure(role: AiRole = 'diagnosis') { return state(role).clear(); }
export function generateStructured<T>(request: GenerationRequest<T>) { return createModelProvider(config.diagnosis).generate(request); }
export function embedTexts(inputs: string[]) { return createEmbeddingProvider(config.embedding).embed(inputs); }

export async function aiConnectionStatus(role: AiRole): Promise<AiConnectionStatus> {
  const settings = providerSettings(role);
  const availability = await state(role).availability(true);
  return {provider: settings.provider, label: settings.label, model: settings.model, configured: settings.configured,
    disabled: settings.provider === 'none' && !settings.configurationError, error: availability.reason,
    dimensions: settings.dimensions, billingUrl: settings.billingUrl};
}
/** Explicit connection tests bypass a blocked circuit, and only clear that role on success. */
export async function checkProvider(role: AiRole) {
  if (role === 'embedding') {
    const [vector] = await embedTexts(['Verificação de conexão do Sentinela.']);
    await clearAiFailure(role);
    return {dimensions: vector.dimensions};
  }
  await generateStructured({system: 'Retorne um objeto JSON com status ok.', prompt: 'Verificação de conexão do Sentinela.',
    schema: z.object({status: z.literal('ok')}), schemaName: 'connection_check', maxOutputTokens: 80});
  await clearAiFailure(role);
  return {};
}
