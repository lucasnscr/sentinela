import { randomUUID } from 'node:crypto';
import { pool } from './db';
import { config } from './config';
import type { Runbook } from './domain';
import { aiAvailability, embedTexts, recordAiFailure, clearAiFailure } from './ai';
import type { EmbeddingVector } from './ai/types';

const seed=[
  {id:'rb-pool',service:'payments',title:'Pool de conexões esgotado',content:'# Pool de conexões esgotado\n\nSintomas: checkout com HTTP 503, erro POOL_ACQUIRE_TIMEOUT e espera crescente na aquisição de conexões. Verifique pool_used/pool_limit, volume de requisições e o diff de configuração. Pool pequeno demais ou conexões retidas são causas possíveis; diferencie de lentidão do banco.\n\nProcedimento no laboratório: restaurar pool_limit=20 e connection_hold_ms=25. Validar por três janelas sem erros. Não concluir a causa apenas pela proximidade de um deploy.'},
  {id:'rb-latency',service:'inventory',title:'Timeout na dependência de estoque',content:'# Timeout na dependência de estoque\n\nSintomas: checkout retorna 504, spans de inventory ultrapassam o deadline e logs registram DEPENDENCY_TIMEOUT. Compare latência da dependência com a janela anterior. Verifique rede, configuração de atraso e carga antes de atribuir a causa.\n\nNo laboratório, remover response_delay_ms adicional e acompanhar a recuperação do checkout.'},
  {id:'rb-release',service:'payments',title:'Regressão de autenticação após deploy',content:'# Regressão de autenticação após deploy\n\nSintomas: erros PAYMENT_SIGNATURE_INVALID, respostas HTTP 502 e falhas concentradas na versão nova. Verifique diff de validação de assinatura e a primeira ocorrência do erro. Compare a versão anterior quando disponível.\n\nNo laboratório, reverter a versão do serviço payments para a última versão saudável e confirmar recuperação.'},
  {id:'rb-triage',service:'*',title:'Roteiro de investigação de incidentes',content:'# Investigação com evidências\n\nIdentifique janela, ambiente e serviços afetados. Correlacione métricas, logs, traces e alterações. Formule hipóteses alternativas e procure contraevidências. Diferencie o serviço que apresenta o sintoma da dependência que originou a falha. Quando faltarem dados, registre diagnóstico inconclusivo e a próxima consulta necessária.'},
];
async function embed(text:string):Promise<EmbeddingVector|null>{
  if(!(await aiAvailability('embedding')).allowed)return null;
  try{
    const [vector]=await embedTexts([text.slice(0,14000)]);
    await clearAiFailure('embedding');
    return vector;
  }catch(error){await recordAiFailure(error,'embedding');throw error;}
}
async function persistVector(id:string,vector:EmbeddingVector,updatedAt?:Date){
  await pool.query('UPDATE runbooks SET embedding=$2::vector,embedding_space=$3,embedding_dimensions=$4 WHERE id=$1 AND ($5::timestamptz IS NULL OR updated_at=$5)',
    [id,JSON.stringify(vector.values),vector.space,vector.dimensions,updatedAt||null]);
}
export async function seedKnowledge(){
  for(const book of seed)await pool.query('INSERT INTO runbooks(id,title,service,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[book.id,book.title,book.service,book.content]);
}
export async function indexKnowledge(){
  if(!(await aiAvailability('embedding')).allowed)return;
  const {rows}=await pool.query('SELECT id,title,content,updated_at FROM runbooks WHERE embedding IS NULL OR embedding_space IS DISTINCT FROM $1 ORDER BY updated_at DESC LIMIT 12',[config.embedding.embeddingSpace]);
  if(!rows.length)return;
  try{
    const vectors=await embedTexts(rows.map(r=>(r.title+'\n'+r.content).slice(0,14000)));
    for(let i=0;i<rows.length;i++)await persistVector(rows[i].id,vectors[i],rows[i].updated_at);
    await clearAiFailure('embedding');
  }catch(error){await recordAiFailure(error,'embedding');throw error;}
}
export async function saveRunbook(title:string,service:string,content:string){
  const id=randomUUID();
  await pool.query('INSERT INTO runbooks(id,title,service,content) VALUES($1,$2,$3,$4)',[id,title,service,content]);
  let indexed=false;
  try{const vector=await embed(title+'\n'+content);if(vector){await persistVector(id,vector);indexed=true;}}catch{/* O texto permanece pesquisável sem inferência. */}
  return {id,indexed};
}
export async function searchRunbooks(query:string,services:string[],vector?:EmbeddingVector|null):Promise<Runbook[]>{
  if(vector&&(vector.values.length!==vector.dimensions||!vector.values.length||vector.values.length>16000||!vector.values.every(Number.isFinite)))throw new Error('Embedding de consulta inválido.');
  const lexicalQuery=[...new Set(query.match(/[\p{L}\p{N}_]+/gu)||[])].filter(word=>word.length>2).slice(0,30).join(' OR ');
  const {rows}=await pool.query(
    'SELECT id,title,service,content,updated_at,ts_rank_cd(search_text,websearch_to_tsquery($1,$2)) AS lexical, CASE WHEN embedding IS NOT NULL AND embedding_space=$6 AND embedding_dimensions=$7 AND vector_dims(embedding)=$7 AND $4::vector IS NOT NULL THEN 1-(embedding <=> $4::vector) ELSE 0 END AS semantic FROM runbooks WHERE service=ANY($3) OR service=$5',
    ['portuguese',lexicalQuery,services,vector?JSON.stringify(vector.values):null,'*',vector?.space||null,vector?.dimensions||null]);
  const lexical=[...rows].sort((a,b)=>b.lexical-a.lexical).filter(r=>r.lexical>0);
  const semantic=vector?[...rows].filter(r=>r.semantic>0).sort((a,b)=>b.semantic-a.semantic):[];
  const scores=new Map<string,number>();
  for(const ranked of [lexical,semantic])ranked.forEach((r,i)=>scores.set(r.id,(scores.get(r.id)||0)+1/(60+i+1)));
  return rows.filter(r=>(scores.get(r.id)||0)>0).map(r=>({id:r.id,title:r.title,service:r.service,content:r.content,updatedAt:new Date(r.updated_at).toISOString(),score:scores.get(r.id)||0,searchMode:semantic.length?'hybrid':'lexical'})).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4);
}
export async function queryEmbedding(query:string){return embed(query);}
