import {pool} from '../db';
import type {PoolClient} from 'pg';
import type {RemediationCase} from './types';
export {retryableStates} from './status';
export async function isCurrentAttempt(item:RemediationCase,client:PoolClient|typeof pool=pool){
  const {rows}=await client.query('SELECT id FROM remediation_cases WHERE incident_id=$1 ORDER BY attempt DESC LIMIT 1',[item.incidentId]);
  return rows[0]?.id===item.id;
}
