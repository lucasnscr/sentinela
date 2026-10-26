import assert from 'node:assert/strict';
import type {Incident,Scenario,Snapshot} from '../lib/domain';
const base=process.env.APP_URL||'http://127.0.0.1:4320';
async function snapshot():Promise<Snapshot>{const response=await fetch(base+'/api/snapshot');assert.equal(response.status,200);return response.json();}
async function command(body:unknown){
  const response=await fetch(base+'/api/commands',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,202,JSON.stringify(result));
  return result.id as string;
}
async function waitFor<T>(label:string,fn:()=>Promise<T|undefined>,timeout=100000):Promise<T>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,1200));}
  throw new Error('Tempo excedido: '+label);
}
const scenarios:Scenario[]=process.argv.includes('--one')?['pool_exhaustion']:['pool_exhaustion','dependency_latency','bad_deployment'];
for(const scenario of scenarios){
  const before=await snapshot();assert.equal(before.incidents.filter(i=>i.status!=='resolved').length,0,'Resolva o incidente ativo antes do E2E.');
  const known=new Set(before.incidents.map(i=>i.id));
  await command({kind:'inject',scenario});
  const incident=await waitFor<Incident>('diagnóstico de '+scenario,async()=>{
    const data=await snapshot();return data.incidents.find(i=>!known.has(i.id)&&i.status==='awaiting_review');
  });
  assert.equal(incident.diagnosis?.confidence,'probable');
  assert.ok(incident.evidence.some(e=>e.kind==='log'));
  assert.ok(incident.evidence.some(e=>e.kind==='change'));
  const expected={pool_exhaustion:'restore_pool',dependency_latency:'disable_latency',bad_deployment:'rollback'};
  assert.equal(incident.diagnosis?.action,expected[scenario]);
  const ids=new Set(incident.evidence.map(e=>e.id));
  for(const h of incident.diagnosis!.hypotheses)assert.ok(h.supportingEvidence.every(id=>ids.has(id)));
  const [reviewA,reviewB]=await Promise.all([command({kind:'review',incidentId:incident.id,approve:true}),command({kind:'review',incidentId:incident.id,approve:true})]);
  assert.equal(reviewA,reviewB,'Revisão duplicada deve retornar o mesmo comando.');
  const resolved=await waitFor<Incident>('recuperação de '+scenario,async()=>(await snapshot()).incidents.find(i=>i.id===incident.id&&i.status==='resolved'));
  assert.ok(resolved.resolvedAt);
  const report=await fetch(base+'/api/incidents/'+incident.id+'/postmortem');assert.equal(report.status,200);assert.match(await report.text(),/Recuperação verificada/);
  console.log('PASS '+scenario+': detecção automática → evidências → revisão idempotente → recuperação.');
}
const csrf=await fetch(base+'/api/commands',{method:'POST',headers:{'content-type':'application/json',origin:'https://invalid.example'},body:JSON.stringify({kind:'reset'})});
assert.equal(csrf.status,400);
console.log('PASS origem externa recusada.');
