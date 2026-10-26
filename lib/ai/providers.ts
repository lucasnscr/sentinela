import { z } from 'zod';
import type { EmbeddingProvider, EmbeddingVector, GenerationRequest, GenerationResult, ModelProvider, ProviderSettings } from './types';
import type { AiFailureCategory } from '../ai-errors';

export class ProviderError extends Error {
  constructor(message: string, public category: AiFailureCategory, public status?: number, public code?: string) {
    super(message); this.name = 'ProviderError';
  }
}
type Json = Record<string, any>;
export type Fetch = typeof globalThis.fetch;

function redact(text: string, settings: ProviderSettings) {
  const masked = settings.apiKey ? text.split(settings.apiKey).join('[credencial removida]') : text;
  return masked.replace(/sk-[\w-]+|AIza[\w-]+/g, '[credencial removida]').slice(0, 500);
}
function httpCategory(status: number, message: string, code: string): AiFailureCategory {
  if (/insufficient_quota|no credits|credit balance|billing quota|current quota/i.test(message + ' ' + code)) return 'quota';
  if (status === 401 || /API_KEY_INVALID|invalid_api_key|unauthenticated/i.test(code + ' ' + message)) return 'authentication';
  if (status === 403) return 'access';
  if (status === 404 || status === 400 || status === 422) return 'configuration';
  return status === 429 ? 'rate_limit' : 'transport';
}
async function post(settings: ProviderSettings, path: string, body: Json, fetcher: Fetch): Promise<Json> {
  if (!settings.configured) throw new ProviderError(settings.configurationError || 'Provedor desativado.', 'configuration');
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (settings.provider === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (settings.apiKey) headers['x-api-key'] = settings.apiKey; }
  else if (settings.provider === 'google') { if (settings.apiKey) headers['x-goog-api-key'] = settings.apiKey; }
  else if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
  let response: Response;
  try {
    response = await fetcher(settings.baseUrl + '/' + path, {method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(settings.timeoutMs), redirect: 'error'});
  } catch (error) {
    throw new ProviderError(redact(settings.label + ': ' + (error instanceof Error ? error.message : 'falha de transporte'), settings), 'transport');
  }
  let payload: Json;
  try { payload = await response.json(); }
  catch { throw new ProviderError(settings.label + ': resposta HTTP ' + response.status + ' não contém JSON válido.', response.ok ? 'invalid_output' : httpCategory(response.status, '', '')); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ProviderError(settings.label + ': envelope de resposta inválido.', 'invalid_output');
  if (!response.ok || payload.error) {
    const message = String(payload.error?.message || payload.error || 'Falha no provedor.');
    const code = String(payload.error?.code || payload.error?.type || payload.error?.status || '');
    throw new ProviderError(redact(settings.label + ' · HTTP ' + response.status + ': ' + message, settings), httpCategory(response.status, message, code), response.status, code);
  }
  return payload;
}
function jsonSchema<T>(request: GenerationRequest<T>) {
  const {$schema: _dialect, ...schema} = z.toJSONSchema(request.schema, {target: 'draft-7'});
  // enum is accepted by more provider subsets than const. Keep local Zod
  // validation authoritative and preserve user property names verbatim.
  function portable(source: Json): Json {
    const result: Json = {...source};
    if (Object.hasOwn(result, 'const')) {result.enum = [result.const]; delete result.const;}
    for (const key of ['properties', 'patternProperties', 'definitions', '$defs']) if (source[key]) result[key] = Object.fromEntries(Object.entries(source[key]).map(([name, value]) => [name, portable(value as Json)]));
    for (const key of ['items', 'additionalProperties', 'not']) if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) result[key] = portable(source[key]);
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(source[key])) result[key] = source[key].map(portable);
    return result;
  }
  return portable(schema);
}
function validated<T>(text: unknown, request: GenerationRequest<T>, settings: ProviderSettings, totalTokens: unknown): GenerationResult<T> {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError(settings.label + ': resposta estruturada ausente.', 'invalid_output');
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1] : text); }
  catch { throw new ProviderError(settings.label + ': o modelo não retornou JSON válido.', 'invalid_output'); }
  const parsed = request.schema.safeParse(value);
  if (!parsed.success) throw new ProviderError(settings.label + ': a resposta não atende ao contrato do diagnóstico.', 'invalid_output');
  return {value: parsed.data, provider: settings.provider, providerLabel: settings.label, model: settings.model,
    totalTokens: typeof totalTokens === 'number' && Number.isFinite(totalTokens) ? totalTokens : null};
}
function assertComplete(complete: boolean, settings: ProviderSettings) {
  if (!complete) throw new ProviderError(settings.label + ': resposta recusada ou incompleta.', 'invalid_output');
}

/** Native HTTP adapters. Only this module knows provider-specific request/response shapes. */
export function createModelProvider(settings: ProviderSettings, fetcher: Fetch = globalThis.fetch): ModelProvider {
  return {async generate<T>(request: GenerationRequest<T>): Promise<GenerationResult<T>> {
    const schema = jsonSchema(request);
    switch (settings.provider) {
      case 'openai': {
        const result = await post(settings, 'responses', {model: settings.model, store: false, instructions: request.system, input: request.prompt,
          max_output_tokens: request.maxOutputTokens, text: {format: {type: 'json_schema', name: request.schemaName, strict: true, schema}}}, fetcher);
        const parts = (result.output || []).flatMap((item: Json) => item.content || []);
        assertComplete(result.status !== 'incomplete' && result.status !== 'failed' && !parts.some((part: Json) => part.type === 'refusal'), settings);
        return validated(parts.filter((part: Json) => part.type === 'output_text').map((part: Json) => part.text).join(''), request, settings, result.usage?.total_tokens);
      }
      case 'openai-compatible': {
        const system = request.system + '\nRetorne somente JSON conforme este schema: ' + JSON.stringify(schema);
        const format = settings.responseFormat === 'json_schema' ? {type: 'json_schema', json_schema: {name: request.schemaName, strict: true, schema}}
          : settings.responseFormat === 'json_object' ? {type: 'json_object'} : undefined;
        const result = await post(settings, 'chat/completions', {model: settings.model, messages: [{role: 'system', content: system}, {role: 'user', content: request.prompt}],
          max_tokens: request.maxOutputTokens, stream: false, ...(format ? {response_format: format} : {})}, fetcher);
        const choice = result.choices?.[0];
        assertComplete(!!choice && choice.finish_reason !== 'length' && choice.finish_reason !== 'content_filter' && !choice.message?.refusal, settings);
        return validated(choice.message?.content, request, settings, result.usage?.total_tokens);
      }
      case 'anthropic': {
        const result = await post(settings, 'messages', {model: settings.model, system: request.system,
          max_tokens: request.maxOutputTokens, messages: [{role: 'user', content: request.prompt}], output_config: {format: {type: 'json_schema', schema}}}, fetcher);
        assertComplete(!['max_tokens', 'refusal'].includes(result.stop_reason), settings);
        return validated((result.content || []).filter((part: Json) => part.type === 'text').map((part: Json) => part.text).join(''), request, settings,
          typeof result.usage?.input_tokens === 'number' && typeof result.usage?.output_tokens === 'number' ? result.usage.input_tokens + result.usage.output_tokens : null);
      }
      case 'google': {
        const model = encodeURIComponent(settings.model.replace(/^models\//, ''));
        const result = await post(settings, 'models/' + model + ':generateContent', {systemInstruction: {parts: [{text: request.system}]},
          contents: [{role: 'user', parts: [{text: request.prompt}]}], generationConfig: {maxOutputTokens: request.maxOutputTokens,
            responseFormat: {text: {mimeType: 'APPLICATION_JSON', schema}}}}, fetcher);
        const candidate = result.candidates?.[0];
        assertComplete(!!candidate && !result.promptFeedback?.blockReason && (!candidate.finishReason || candidate.finishReason === 'STOP'), settings);
        return validated((candidate.content?.parts || []).filter((part: Json) => !part.thought && typeof part.text === 'string').map((part: Json) => part.text).join(''), request, settings, result.usageMetadata?.totalTokenCount);
      }
      case 'ollama': {
        const result = await post(settings, 'api/chat', {model: settings.model, stream: false, format: schema,
          messages: [{role: 'system', content: request.system}, {role: 'user', content: request.prompt}], options: {num_predict: request.maxOutputTokens}}, fetcher);
        assertComplete(result.done === true && result.done_reason !== 'length', settings);
        return validated(result.message?.content, request, settings,
          typeof result.prompt_eval_count === 'number' && typeof result.eval_count === 'number' ? result.prompt_eval_count + result.eval_count : null);
      }
      default: throw new ProviderError(settings.configurationError || 'Nenhum provedor de diagnóstico foi configurado.', 'configuration');
    }
  }};
}

function validateVectors(raw: unknown, count: number, settings: ProviderSettings): EmbeddingVector[] {
  const parsed = z.array(z.array(z.number().finite()).min(1).max(16000)).safeParse(raw);
  if (!parsed.success || parsed.data.length !== count) throw new ProviderError(settings.label + ': lote de embeddings inválido.', 'invalid_output');
  const dimensions = settings.dimensions || parsed.data[0]?.length;
  if (!dimensions || parsed.data.some(vector => vector.length !== dimensions || !vector.some(value => value !== 0))) throw new ProviderError(settings.label + ': dimensões inconsistentes ou vetor nulo.', 'invalid_output');
  return parsed.data.map(values => ({values, space: settings.embeddingSpace, dimensions}));
}
export function createEmbeddingProvider(settings: ProviderSettings, fetcher: Fetch = globalThis.fetch): EmbeddingProvider {
  return {async embed(inputs: string[]) {
    if (!inputs.length || inputs.length > 32 || inputs.some(input => !input || input.length > 30000)) throw new ProviderError('Lote de textos fora do limite permitido.', 'configuration');
    let vectors: unknown;
    if (settings.provider === 'openai' || settings.provider === 'openai-compatible') {
      const result = await post(settings, 'embeddings', {model: settings.model, input: inputs,
        ...(settings.dimensions ? {dimensions: settings.dimensions} : {}), encoding_format: 'float'}, fetcher);
      const data = result.data;
      if (!Array.isArray(data) || data.some((item: Json, index: number) => !Number.isInteger(item.index) || item.index < 0 || item.index >= inputs.length) || new Set(data.map((item: Json) => item.index)).size !== inputs.length) throw new ProviderError(settings.label + ': índices de embeddings inválidos.', 'invalid_output');
      vectors = [...data].sort((a: Json, b: Json) => a.index - b.index).map((item: Json) => item.embedding);
    } else if (settings.provider === 'ollama') {
      const result = await post(settings, 'api/embed', {model: settings.model, input: inputs, truncate: false,
        ...(settings.dimensions ? {dimensions: settings.dimensions} : {})}, fetcher);
      vectors = result.embeddings;
    } else if (settings.provider === 'google') {
      const model = settings.model.replace(/^models\//, '');
      const result = await post(settings, 'models/' + encodeURIComponent(model) + ':batchEmbedContents', {requests: inputs.map(text => ({model: 'models/' + model,
        content: {parts: [{text}]}, ...(settings.dimensions ? {embedContentConfig: {outputDimensionality: settings.dimensions}} : {})}))}, fetcher);
      vectors = result.embeddings?.map((embedding: Json) => embedding.values);
    } else throw new ProviderError(settings.configurationError || 'Nenhum provedor de embeddings foi configurado.', 'configuration');
    return validateVectors(vectors, inputs.length, settings);
  }};
}
