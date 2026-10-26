export type RuntimeKind = 'kubernetes' | 'azure-functions';
export type OperationAction = 'restart' | 'scale' | 'start';
export type RuntimePhase = 'healthy' | 'degraded' | 'transitioning' | 'inactive' | 'unknown';
export interface RuntimeIssue { code: string; message: string }
export interface RuntimeObservation {
  targetId: string; runtime: RuntimeKind; service: string; scope: string;
  at: string; phase: RuntimePhase; version: string; summary: string;
  issues: RuntimeIssue[]; details: Record<string, unknown>;
  allowedActions: OperationAction[];
}
interface BaseTarget {
  id: string; service: string; actions: OperationAction[];
  healthUrl?: string; healthKeyEnv?: string;
}
export interface KubernetesTarget extends BaseTarget {
  runtime: 'kubernetes'; context: string; namespace: string; deployment: string;
  minReplicas: number; maxReplicas: number;
}
export interface AzureFunctionsTarget extends BaseTarget {
  runtime: 'azure-functions'; resourceId: string; expectedRunning: boolean;
}
export type RuntimeTarget = KubernetesTarget | AzureFunctionsTarget;
export interface OperationsSettings {
  enabled: boolean; executionEnabled: boolean; intervalMs: number;
  cooldownMs: number; targets: RuntimeTarget[];
}
export type OperationState = 'pending' | 'declined' | 'expired' | 'executing' | 'verifying' | 'succeeded' | 'failed' | 'uncertain' | 'acknowledged';
export interface OperationPlan {
  id: string; targetId: string; service: string; runtime: RuntimeKind;
  action: OperationAction; replicas?: number; state: OperationState;
  reason: string; impact: string; before: RuntimeObservation;
  expected: string; configHash: string; requestId: string;
  createdAt: string; expiresAt: string; executedAt?: string;
  verificationDeadline?: string; healthyChecks: number;
  result: string | null; incidentId: string | null;
}
export interface OperationsSnapshot {
  enabled: boolean; executionEnabled: boolean; intervalMs: number;
  targets: RuntimeObservation[]; plans: OperationPlan[]; error: string | null;
}
