import {pool} from '../db';
import type {RemediationCase} from './types';
export const fromCaseRow=(row:any):RemediationCase=>({...row.payload,state:row.state});
export async function getCase(id:string){const {rows}=await pool.query('SELECT state,payload FROM remediation_cases WHERE id=$1',[id]);return rows[0]?fromCaseRow(rows[0]):null;}
export async function listCases(){const {rows}=await pool.query('SELECT state,payload FROM remediation_cases ORDER BY created_at DESC LIMIT 100');return rows.map(fromCaseRow);}
export async function saveCase(item:RemediationCase){await pool.query('UPDATE remediation_cases SET state=$2,payload=$3,updated_at=now() WHERE id=$1',[item.id,item.state,JSON.stringify({...item,updatedAt:new Date().toISOString()})]);}
