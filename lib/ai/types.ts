import type { z } from 'zod';

export type ProviderId = 'none' | 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama';
export type AiRole = 'diagnosis' | 'embedding';
export type ResponseFormat = 'json_schema' | 'json_object' | 'prompt';

/** Server-only configuration. Never serialize this object: it contains a credential. */
export interface ProviderSettings {
  role: AiRole;
  provider: ProviderId;
  label: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv: string;
  dimensions: number | null;
  responseFormat: ResponseFormat;
  timeoutMs: number;
  configured: boolean;
  configurationError: string | null;
  billingUrl: string | null;
  identity: string;
  embeddingSpace: string;
  inheritLegacyCircuit: boolean;
}

export interface GenerationRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface GenerationResult<T> {
  value: T;
  provider: ProviderId;
  providerLabel: string;
  model: string;
  totalTokens: number | null;
}

export interface EmbeddingVector {
  values: number[];
  space: string;
  dimensions: number;
}

export interface ModelProvider {
  generate<T>(request: GenerationRequest<T>): Promise<GenerationResult<T>>;
}

export interface EmbeddingProvider {
  embed(inputs: string[]): Promise<EmbeddingVector[]>;
}

export interface AiConnectionStatus {
  provider: ProviderId;
  label: string;
  model: string;
  configured: boolean;
  disabled: boolean;
  error: string | null;
  dimensions: number | null;
  billingUrl: string | null;
}
