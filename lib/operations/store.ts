import { pool } from '../db';
import type { OperationPlan, RuntimeObservation, OperationsSnapshot } from './types';
import { getMeta } from '../db';

export async function saveObservation(observation: RuntimeObservation) {
  await pool.query('INSERT INTO runtime_observations(target_id,payload) VALUES($1,$2) ON CONFLICT(target_id) DO UPDATE SET payload=$2,updated_at=now()', [observation.targetId, JSON.stringify(observation)]);
}
export async function savePlan(plan: OperationPlan) {
  try {
    const { rows } = await pool.query('INSERT INTO operation_plans(id,target_id,state,request_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(target_id,request_id) DO NOTHING RETURNING id', [plan.id, plan.targetId, plan.state, plan.requestId, JSON.stringify(plan)]);
    return rows.length > 0;
  } catch (error) {
    if ((error as {code?:string}).code === '23505') throw new Error('Já existe um plano ativo para este alvo.');
    throw error;
  }
}
export async function getPlan(id: string): Promise<OperationPlan | null> {
  const { rows } = await pool.query('SELECT payload,state FROM operation_plans WHERE id=$1', [id]);
  return rows[0] ? { ...rows[0].payload, state: rows[0].state } : null;
}
export async function findPlanByRequest(targetId:string,requestId:string):Promise<OperationPlan|null>{
  const {rows}=await pool.query('SELECT payload,state FROM operation_plans WHERE target_id=$1 AND request_id=$2',[targetId,requestId]);
  return rows[0]?{...rows[0].payload,state:rows[0].state}:null;
}
export async function hasRecentExecution(targetId:string,excludeId:string,cooldownMs:number){
  const {rows}=await pool.query("SELECT id FROM operation_plans WHERE target_id=$1 AND id<>$2 AND payload->>'executedAt' IS NOT NULL AND (payload->>'executedAt')::timestamptz>now()-($3::double precision*interval '1 millisecond') LIMIT 1",[targetId,excludeId,cooldownMs]);
  return rows.length>0;
}
export async function setPlanState(plan: OperationPlan) {
  await pool.query('UPDATE operation_plans SET state=$2,payload=$3,updated_at=now() WHERE id=$1', [plan.id, plan.state, JSON.stringify(plan)]);
}
export async function expirePendingPlan(plan:OperationPlan){
  const {rows}=await pool.query("UPDATE operation_plans SET state='expired',payload=$2,updated_at=now() WHERE id=$1 AND state='pending' RETURNING id",[plan.id,JSON.stringify(plan)]);
  return rows.length>0;
}
export async function claimPlan(id: string): Promise<OperationPlan | null> {
  const { rows } = await pool.query("UPDATE operation_plans SET state='executing',updated_at=now() WHERE id=$1 AND state='pending' RETURNING payload", [id]);
  return rows[0] ? { ...rows[0].payload, state: 'executing' } : null;
}
export async function operationPlans(states?: string[]): Promise<OperationPlan[]> {
  const { rows } = await pool.query('SELECT payload,state FROM operation_plans WHERE ($1::text[] IS NULL OR state=ANY($1)) ORDER BY created_at DESC LIMIT 100', [states || null]);
  return rows.map(row => ({ ...row.payload, state: row.state }));
}
export async function operationsSnapshot(): Promise<OperationsSnapshot> {
  const settings = await getMeta<{ enabled: boolean; executionEnabled: boolean; intervalMs: number; targetIds: string[]; error: string | null }>('operationsSettings');
  const { rows } = await pool.query('SELECT payload FROM runtime_observations WHERE target_id=ANY($1) ORDER BY target_id', [settings?.targetIds || []]);
  return { enabled: settings?.enabled || false, executionEnabled: settings?.executionEnabled || false,
    intervalMs: settings?.intervalMs || 15000, error: settings?.error || null,
    targets: rows.map(row => row.payload), plans: await operationPlans() };
}
