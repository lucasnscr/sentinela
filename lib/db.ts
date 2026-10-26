import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { aiConnectionStatus } from './ai';
import type { Diagnosis, Evidence, Incident, IncidentStatus, Metric, Runbook, Snapshot, TimelineEvent } from './domain';

const globalPg = globalThis as typeof globalThis & { sentinelPool?: pg.Pool; sentinelMigration?: Promise<void> };
export const pool = globalPg.sentinelPool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000 });
pool.on('error', () => console.error('[database] conexão interrompida; novas operações tentarão reconectar'));

export async function migrate() {
  if (!globalPg.sentinelMigration) globalPg.sentinelMigration = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(742901)');
      await client.query(await readFile(path.resolve('lib/schema.sql'), 'utf8'));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); globalPg.sentinelMigration = undefined; throw error; }
    finally { client.release(); }
  })();
  return globalPg.sentinelMigration;
}
const iso = (date: unknown) => new Date(date as string).toISOString();
export function incidentFromRow(r: Record<string, any>): Incident {
  return { id:r.id, fingerprint:r.fingerprint, service:r.service, environment:r.environment, title:r.title, severity:r.severity,
    status:r.status, stage:r.stage, createdAt:iso(r.created_at), updatedAt:iso(r.updated_at),
    resolvedAt:r.resolved_at ? iso(r.resolved_at) : null, evidence:r.evidence, diagnosis:r.diagnosis,
    attempts:r.attempts, lastError:r.last_error };
}
export function evidenceFromRow(r: Record<string, any>): Evidence {
  return { id:r.id, kind:r.kind, service:r.service, at:iso(r.at), title:r.title, detail:r.detail, data:r.data };
}
export function metricFromRow(r: Record<string, any>): Metric {
  return {service:r.service, at:iso(r.at), errorRate:r.error_rate, p95:r.p95, rpm:r.rpm,
    saturation:r.saturation, requests:r.requests, source:r.source};
}
export async function setMeta(key:string,value:unknown) {
  await pool.query('INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()',[key,JSON.stringify(value)]);
}
export async function getMeta<T>(key:string):Promise<T|null> {
  const {rows}=await pool.query('SELECT value FROM metadata WHERE key=$1',[key]);
  return rows[0]?.value ?? null;
}
export async function event(kind:string,title:string,detail='',incidentId:string|null=null) {
  await pool.query('INSERT INTO events(id,incident_id,kind,title,detail) VALUES($1,$2,$3,$4,$5)',[randomUUID(),incidentId,kind,title,detail]);
}
export async function putEvidence(e:Evidence) {
  await pool.query('INSERT INTO evidence(id,kind,service,at,title,detail,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[e.id,e.kind,e.service,e.at,e.title,e.detail,JSON.stringify(e.data)]);
}
export async function addMetric(m:Metric) {
  await pool.query('INSERT INTO metrics(service,at,error_rate,p95,rpm,saturation,requests,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[m.service,m.at,m.errorRate,m.p95,m.rpm,m.saturation,m.requests,m.source]);
}
export async function findIncident(id:string):Promise<Incident|null> {
  const {rows}=await pool.query('SELECT * FROM incidents WHERE id=$1',[id]);
  return rows[0]?incidentFromRow(rows[0]):null;
}
export async function incidentEvidenceSince(incident:Incident){
  const {rows}=await pool.query('SELECT max(resolved_at) AS previous_resolution FROM incidents WHERE fingerprint=$1 AND id<>$2 AND resolved_at<=$3',[incident.fingerprint,incident.id,incident.createdAt]);
  const previous=rows[0]?.previous_resolution?new Date(rows[0].previous_resolution).getTime():0;
  return new Date(Math.max(new Date(incident.createdAt).getTime()-45000,previous)).toISOString();
}
export async function openIncident(service:string,environment:string,title:string,fingerprint:string) {
  const {rows}=await pool.query(
    "INSERT INTO incidents(id,service,environment,title,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(fingerprint) WHERE status <> 'resolved' DO UPDATE SET updated_at=now() RETURNING *, (xmax=0) AS inserted",
    [randomUUID(),service,environment,title,fingerprint]);
  return {incident:incidentFromRow(rows[0]),created:rows[0].inserted as boolean};
}
export async function updateIncident(id:string,patch:Partial<{status:IncidentStatus;stage:string;evidence:Evidence[];diagnosis:Diagnosis|null;lastError:string|null;attempts:number;title:string}>) {
  const names:Record<string,string>={status:'status',stage:'stage',evidence:'evidence',diagnosis:'diagnosis',lastError:'last_error',attempts:'attempts',title:'title'};
  const entries=Object.entries(patch).filter(([k])=>names[k]);
  if(!entries.length)return;
  const values=entries.map(([k,v])=>k==='evidence'||k==='diagnosis'?JSON.stringify(v):v);
  await pool.query('UPDATE incidents SET '+entries.map(([k],i)=>names[k]+'=$'+(i+2)).join(',')+',updated_at=now() WHERE id=$1',[id,...values]);
}
export async function closeIncident(id:string) {
  const result=await pool.query("UPDATE incidents SET status='resolved',stage='complete',resolved_at=now(),updated_at=now() WHERE id=$1 AND status <> 'resolved' RETURNING id",[id]);
  if(result.rowCount)await event('recovery','Recuperação verificada','Três janelas consecutivas sem degradação.',id);
}
export async function enqueue(kind:string,payload:unknown,idempotencyKey:string|null=null) {
  const id=randomUUID();
  const {rows}=await pool.query('INSERT INTO commands(id,kind,payload,idempotency_key) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,status',[id,kind,JSON.stringify(payload),idempotencyKey]);
  return rows[0] as {id:string;status:string};
}
export async function claimCommand() {
  const {rows}=await pool.query("UPDATE commands SET status='executing',updated_at=now() WHERE id=(SELECT id FROM commands WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
  return rows[0] as {id:string;kind:string;payload:Record<string,any>}|undefined;
}
export async function finishCommand(id:string,error?:string) {
  await pool.query('UPDATE commands SET status=$2,result=$3,updated_at=now() WHERE id=$1',[id,error?'failed':'completed',error||'Concluído']);
}
export async function getEvidence(services:string[],kind?:string,since?:string,limit=30) {
  const {rows}=await pool.query('SELECT * FROM evidence WHERE service=ANY($1) AND ($2::text IS NULL OR kind=$2) AND at >= $3::timestamptz ORDER BY at DESC LIMIT $4',[services,kind||null,since||new Date(Date.now()-15*60000).toISOString(),limit]);
  return rows.map(evidenceFromRow);
}
export async function getMetrics(services:string[],since?:string) {
  const {rows}=await pool.query('SELECT * FROM metrics WHERE service=ANY($1) AND at >= $2::timestamptz ORDER BY at ASC LIMIT 1000',[services,since||new Date(Date.now()-15*60000).toISOString()]);
  return rows.map(metricFromRow);
}
export async function getSnapshot():Promise<Snapshot> {
  await migrate();
  const [incidents,metrics,events,metadata,count,diagnosis,embedding]=await Promise.all([
    pool.query('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 100'),
    pool.query("SELECT * FROM (SELECT * FROM metrics WHERE at>now()-interval '20 minutes' ORDER BY at DESC LIMIT 900) m ORDER BY at ASC"),
    pool.query('SELECT * FROM events ORDER BY at DESC LIMIT 70'),
    pool.query("SELECT key,value FROM metadata WHERE key IN ('heartbeat','mcp','lastAiError','labScenario','workerId','aiMode')"),
    pool.query('SELECT count(*)::int AS count FROM runbooks'),
    aiConnectionStatus('diagnosis'),aiConnectionStatus('embedding')
  ]);
  const meta=Object.fromEntries(metadata.rows.map(r=>[r.key,r.value]));
  return {
    incidents:incidents.rows.map(incidentFromRow), metrics:metrics.rows.map(metricFromRow),
    events:events.rows.map(r=>({id:r.id,incidentId:r.incident_id,at:iso(r.at),kind:r.kind,title:r.title,detail:r.detail} as TimelineEvent)),
    worker:{heartbeat:meta.heartbeat??null,mcp:meta.mcp===true,ai:meta.aiMode??config.aiMode,lastAiError:diagnosis.error,labScenario:meta.labScenario??null,labEnabled:config.labEnabled,workerId:meta.workerId??null},
    connections:{database:true,diagnosis,embedding,source:config.prometheusUrl?'prometheus':'laboratory'},
    runbooksCount:count.rows[0].count,now:new Date().toISOString()
  };
}
export async function listRunbooks():Promise<Runbook[]> {
  const {rows}=await pool.query('SELECT id,title,service,content,updated_at FROM runbooks ORDER BY updated_at DESC');
  return rows.map(r=>({id:r.id,title:r.title,service:r.service,content:r.content,updatedAt:iso(r.updated_at)}));
}
export async function prune() {
  await pool.query("DELETE FROM metrics WHERE at<now()-interval '1 day'");
  await pool.query("DELETE FROM evidence WHERE at<now()-interval '2 days'");
  await pool.query("DELETE FROM events WHERE at<now()-interval '30 days'");
}
