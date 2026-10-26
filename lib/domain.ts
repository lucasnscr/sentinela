import type { AiConnectionStatus } from './ai/types';
import type { OperationsSnapshot } from './operations/types';

export type ServiceName = string;
export type IncidentStatus = 'investigating' | 'awaiting_review' | 'verifying' | 'resolved';
export type Scenario = 'pool_exhaustion' | 'dependency_latency' | 'bad_deployment';
export type Mitigation = 'restore_pool' | 'disable_latency' | 'rollback' | 'observe';
export type EvidenceKind = 'metric' | 'log' | 'trace' | 'change' | 'runbook' | 'dependency' | 'runtime';
export interface Metric {
  environment?: string;
  service: string; at: string; errorRate: number; p95: number; rpm: number;
  saturation: number; requests: number; source: 'laboratory' | 'prometheus';
}
export interface Evidence {
  id: string; kind: EvidenceKind; service: string; at: string; title: string;
  detail: string; data: Record<string, unknown>;
}
export interface Hypothesis {
  title: string; explanation: string; supportingEvidence: string[];
  contradictingEvidence: string[]; nextCheck: string;
}
export interface Diagnosis {
  summary: string; cause: string; confidence: 'probable' | 'insufficient';
  hypotheses: Hypothesis[]; action: Mitigation; actionService: string;
  actionReason: string; missingInformation: string[];
  mode: 'model' | 'openai' | 'rules'; warning: string | null;
  provider?: string; providerLabel?: string; model?: string;
}
export interface Incident {
  id: string; fingerprint: string; service: string; environment: string; title: string;
  severity: string; status: IncidentStatus; stage: string; createdAt: string; updatedAt: string;
  resolvedAt: string | null; evidence: Evidence[]; diagnosis: Diagnosis | null;
  attempts: number; lastError: string | null;
}
export interface TimelineEvent {
  id: string; incidentId: string | null; at: string; kind: string; title: string; detail: string;
}
export interface Runbook {
  id: string; title: string; service: string; content: string; updatedAt: string;
  embedding?: number[] | null; score?: number; searchMode?: string;
}
export interface Snapshot {
  operations: OperationsSnapshot;
  incidents: Incident[]; metrics: Metric[]; events: TimelineEvent[];
  worker: { heartbeat: string | null; mcp: boolean; ai: string; lastAiError: string | null; labScenario: Scenario | null; labEnabled: boolean; workerId: string | null };
  connections: { database: boolean; diagnosis: AiConnectionStatus; embedding: AiConnectionStatus; source: string };
  runbooksCount: number; now: string;
}
export const scenarioNames: Record<Scenario, string> = {
  pool_exhaustion: 'Saturação do pool',
  dependency_latency: 'Latência na dependência',
  bad_deployment: 'Deploy com regressão',
};
export const actionNames: Record<Mitigation, string> = {
  restore_pool: 'Restaurar pool de conexões',
  disable_latency: 'Remover atraso da dependência',
  rollback: 'Reverter deploy de pagamentos',
  observe: 'Continuar investigação',
};
