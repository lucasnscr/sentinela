import type {RecoveryPolicy,RecoveryCheck} from './recovery-policy';
export type CaseState='proposed'|'publishing'|'publish_uncertain'|'issue_open'|'pr_open'|'deploying'|'verifying'|'verified'|'regressed'|'rollback_verifying'|'rolled_back'|'rollback_failed'|'rollback_unverified'|'ci_failed'|'implementation_failed'|'cancelled'|'abandoned'|'deployment_uncertain';
export interface RemediationCase {
  id:string;incidentId:string;repository:string;service:string;environment:string;
  state:CaseState;kind:'application'|'configuration';summary:string;acceptanceCriteria:string[];
  evidence:Array<{id:string;kind:string;summary:string}>;proposalHash:string;proposalBody:string;
  createdAt:string;updatedAt:string;issueNumber:number|null;issueUrl:string|null;
  pullRequestNumber:number|null;implementationSha:string|null;commitSha:string|null;
  artifactDigest:string|null;deploymentId:string|null;verificationStartedAt:string|null;
  verificationDeadline:string|null;lastSampleAt:string|null;healthySamples:number;result:string|null;
  rollbackStartedAt?:string;rollbackDeadline?:string;lastRollbackSampleAt?:string|null;rollbackSamples?:number;
  recoveryPolicy?:RecoveryPolicy;recoveryPolicyHash?:string;healthySince?:string|null;rollbackHealthySince?:string|null;
  lastRecoveryCheck?:{policyHash:string;metricAt:string|null;stableForMs:number;checks:RecoveryCheck[];policyChanged:boolean};
  attempt?:number;previousCaseId?:string|null;
  latestCiRunId?:number;latestCiRunAttempt?:number;developmentClosedAt?:string;
  development?:{type:string;executionId:string;reason:string;at:string};
}
export interface SdlcSettings {
  enabled:boolean;repository:string;environment:string;services:string[];
  githubTokenEnv:string;verifyTimeoutMs:number;
  maxAttempts?:number;
  inactivityTimeoutMs?:number;deploymentTimeoutMs?:number;
}
