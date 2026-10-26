import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Annotation,StateGraph,START,END,interrupt,Command} from '@langchain/langgraph';
import {PostgresSaver} from '@langchain/langgraph-checkpoint-postgres';
import {migrate,openIncident,pool,closeIncident,incidentEvidenceSince} from '../../lib/db';
import {config} from '../../lib/config';
import {connectTools} from '../../worker/mcp-client';
after(async()=>{await pool.end();});
test('alertas concorrentes criam somente um incidente ativo',async()=>{
  await migrate();const key='test:'+randomUUID();
  const results=await Promise.all(Array.from({length:8},()=>openIncident('test-service','test','Teste isolado',key)));
  assert.equal(new Set(results.map(r=>r.incident.id)).size,1);
  assert.equal(results.filter(r=>r.created).length,1);
  await pool.query('DELETE FROM incidents WHERE fingerprint=$1',[key]);
});
test('um novo incidente não coleta falhas anteriores à última recuperação',async()=>{
  const key='test-window:'+randomUUID();
  const first=await openIncident('test-service','test','Primeira falha',key);
  try{
    await closeIncident(first.incident.id);
    const second=await openIncident('test-service','test','Segunda falha',key);
    const since=await incidentEvidenceSince(second.incident);
    const {rows}=await pool.query('SELECT resolved_at FROM incidents WHERE id=$1',[first.incident.id]);
    assert.equal(new Date(since).getTime(),new Date(rows[0].resolved_at).getTime());
  }finally{await pool.query('DELETE FROM events WHERE incident_id IN(SELECT id FROM incidents WHERE fingerprint=$1)',[key]);await pool.query('DELETE FROM incidents WHERE fingerprint=$1',[key]);}
});
test('reconstruir o grafo mantém uma revisão pendente no PostgreSQL',async()=>{
  const saver=PostgresSaver.fromConnString(config.databaseUrl);await saver.setup();
  const id='test-'+randomUUID();
  const State=Annotation.Root({approved:Annotation<boolean>()});
  const build=()=>new StateGraph(State).addNode('review',()=>({approved:interrupt('revisar')===true})).addEdge(START,'review').addEdge('review',END).compile({checkpointer:saver});
  const opts={configurable:{thread_id:id}};
  await build().invoke({approved:false},opts);
  const recreated=build();const saved=await recreated.getState(opts);
  assert.deepEqual(saved.next,['review']);
  const result=await recreated.invoke(new Command({resume:true}),opts);assert.equal(result.approved,true);
  await saver.deleteThread(id);await saver.end();
});
test('o cliente chama ferramentas reais no servidor MCP v2',async()=>{
  const tools=await connectTools();
  try{const result=await tools.call<unknown[]>('get_service_metrics',{services:['test-service'],since:new Date().toISOString()});assert.ok(Array.isArray(result));}
  finally{await tools.close();}
});

test('busca lexical encontra código de erro mesmo com termos extras',async()=>{
  const {searchRunbooks}=await import('../../lib/knowledge');
  const id='test-'+randomUUID();
  await pool.query('INSERT INTO runbooks(id,title,service,content) VALUES($1,$2,$3,$4)',[id,'Investigação exclusiva de teste','payments','SENTINEL_QUANTUM_TEST: procedimento exclusivo para validar recuperação lexical.']);
  try{
    const matches=await searchRunbooks('ruidoaleatorio SENTINEL_QUANTUM_TEST',['payments']);
    assert.equal(matches[0]?.id,id);assert.equal(matches[0]?.searchMode,'lexical');
    const missing=await searchRunbooks('nonexistentnucleotidezz',['payments']);assert.equal(missing.length,0);
  }finally{await pool.query('DELETE FROM runbooks WHERE id=$1',[id]);}
});
test('ingestão autenticada preserva IDs e rejeita token incorreto',async()=>{
  const {POST}=await import('../../app/api/telemetry/route');
  const id='test-'+randomUUID();const previous=process.env.TELEMETRY_INGEST_TOKEN;
  process.env.TELEMETRY_INGEST_TOKEN='local-test-'+randomUUID();
  const body=JSON.stringify({events:[{id,kind:'log',service:'payments',at:new Date().toISOString(),title:'Telemetria de teste isolada',detail:'Registro de validação da ingestão.',data:{test:true}}]});
  const request=()=>new Request('http://127.0.0.1:4320/api/telemetry',{method:'POST',headers:{authorization:'Bearer '+process.env.TELEMETRY_INGEST_TOKEN,'content-type':'application/json'},body});
  try{
    assert.equal((await POST(request())).status,202);assert.equal((await POST(request())).status,202);
    const {rows}=await pool.query('SELECT id FROM evidence WHERE id=$1',[id]);assert.equal(rows.length,1);
    assert.equal((await POST(new Request('http://127.0.0.1:4320/api/telemetry',{method:'POST',headers:{authorization:'Bearer wrong'},body}))).status,401);
  }finally{if(previous===undefined)delete process.env.TELEMETRY_INGEST_TOKEN;else process.env.TELEMETRY_INGEST_TOKEN=previous;await pool.query('DELETE FROM evidence WHERE id=$1',[id]);}
});
