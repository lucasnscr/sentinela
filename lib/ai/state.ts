import type { ProviderSettings } from './types';
import { classifyAiFailure } from '../ai-errors';

export interface AiCircuit {category: string; reason: string; retryAfter: number | null}
export interface AiStateStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}
export function circuitKey(settings: ProviderSettings) { return 'aiCircuit:' + settings.role + ':' + settings.identity; }

export function createAiState(settings: ProviderSettings, mode: string, store: AiStateStore) {
  async function circuit() {
    const key = circuitKey(settings);
    if (settings.inheritLegacyCircuit) {
      const marker = 'aiLegacyImported:' + settings.role;
      if (!(await store.get<boolean>(marker))) {
        const legacy = await store.get<AiCircuit>('aiCircuit');
        if (legacy && !(await store.get<AiCircuit>(key))) await store.set(key, legacy);
        await store.set(marker, true);
      }
    }
    return store.get<AiCircuit>(key);
  }
  return {
    async availability(ignoreMode = false): Promise<{allowed: boolean; reason: string | null}> {
      if (!ignoreMode && mode === 'rules') return {allowed: false, reason: null};
      if (!settings.configured) return {allowed: false, reason: settings.configurationError};
      const current = await circuit();
      if (current && (current.retryAfter === null || current.retryAfter > Date.now())) return {allowed: false, reason: current.reason};
      return {allowed: true, reason: null};
    },
    async failure(error: unknown) {
      const category = classifyAiFailure(error);
      const raw = error instanceof Error ? error.message : 'Falha inesperada no provedor.';
      const masked = settings.apiKey ? raw.split(settings.apiKey).join('[credencial removida]') : raw;
      const message = masked.replace(/sk-[\w-]+|AIza[\w-]+/g, '[credencial removida]').slice(0, 500);
      const reason = category === 'quota' ? settings.label + ': cota ou créditos indisponíveis. Revise o provedor e use “Testar conexão”.' : message;
      const permanent = ['quota', 'authentication', 'access', 'configuration'].includes(category);
      await store.set(circuitKey(settings), {category, reason, retryAfter: permanent ? null : Date.now() + 60000} satisfies AiCircuit);
      return reason;
    },
    async clear() {
      await store.set(circuitKey(settings), null);
      if (settings.inheritLegacyCircuit) await store.set('aiLegacyImported:' + settings.role, true);
    },
  };
}
