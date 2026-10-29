import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProviderSettings} from '../lib/ai/configuration';
import {createAiState,type AiStateStore} from '../lib/ai/state';

function store(){const data=new Map<string,unknown>();return {data,async get<T>(key:string){return (data.get(key)??null) as T|null;},async set(key:string,value:unknown){data.set(key,value);}} satisfies AiStateStore&{data:Map<string,unknown>};}
function model(provider:string,name='model-a'){return parseProviderSettings({AI_PROVIDER:provider,AI_MODEL:name,AI_API_KEY:'key-a',AI_BASE_URL:'http://localhost:9999'},'diagnosis');}
test('instalação sem configuração não exige um provedor comercial',()=>{
  assert.equal(parseProviderSettings({},'diagnosis').provider,'none');assert.equal(parseProviderSettings({},'embedding').provider,'none');
});
test('configuração OPENAI_* anterior continua válida sem reescrever a chave',()=>{
  const generation=parseProviderSettings({OPENAI_API_KEY:'legacy-key'},'diagnosis');const embedding=parseProviderSettings({OPENAI_API_KEY:'legacy-key'},'embedding');
  assert.equal(generation.provider,'openai');assert.equal(generation.model,'gpt-4.1-mini');assert.equal(embedding.dimensions,1536);assert.ok(generation.inheritLegacyCircuit);
});
test('diagnóstico e embeddings podem usar modelos e provedores diferentes',()=>{
  const env={AI_PROVIDER:'anthropic',AI_MODEL:'claude-configured',ANTHROPIC_API_KEY:'anthropic-test',EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'embedding-local'};
  const generation=parseProviderSettings(env,'diagnosis'),embedding=parseProviderSettings(env,'embedding');
  assert.ok(generation.configured&&embedding.configured);assert.equal(generation.apiKey,'anthropic-test');assert.equal(embedding.apiKey,undefined);assert.notEqual(generation.provider,embedding.provider);
});
test('selecionar outro modelo não habilita embeddings pagos implicitamente',()=>{
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',OPENAI_API_KEY:'existing'},'embedding').provider,'none');
});
test('embeddings compatíveis não recebem a credencial de outro endpoint de diagnóstico',()=>{
  const embedding=parseProviderSettings({AI_API_KEY:'diagnosis-secret',EMBEDDING_PROVIDER:'openai-compatible',EMBEDDING_MODEL:'embed',EMBEDDING_BASE_URL:'http://localhost:9998'},'embedding');
  assert.equal(embedding.apiKey,undefined);assert.equal(embedding.apiKeyEnv,'EMBEDDING_API_KEY');
});
test('configurar embeddings não apaga a configuração anterior do diagnóstico',()=>{
  assert.equal(parseProviderSettings({OPENAI_API_KEY:'existing',EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local'},'diagnosis').provider,'openai');
});
test('provedor desconhecido e URL com credencial são erros de configuração',()=>{
  assert.equal(parseProviderSettings({AI_PROVIDER:'unknown'},'diagnosis').configured,false);
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'a',AI_BASE_URL:'https://user:pass@example.com'},'diagnosis').configured,false);
});
test('dimensões são configuráveis e limitadas pela capacidade de armazenamento',()=>{
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'a',EMBEDDING_DIMENSIONS:'768'},'embedding').dimensions,768);
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'a',EMBEDDING_DIMENSIONS:'0'},'embedding').configured,false);
});
test('valores inválidos de timeout resultam em erro de configuração',()=>{
  // Test invalid AI_TIMEOUT_MS values
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',AI_TIMEOUT_MS:'-100'},'diagnosis').configured,false);
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',AI_TIMEOUT_MS:'50.5'},'diagnosis').configured,false);
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',AI_TIMEOUT_MS:'invalid'},'diagnosis').configured,false);
  assert.equal(parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',AI_TIMEOUT_MS:'500000'},'diagnosis').configured,false);
  
  // Test invalid EMBEDDING_TIMEOUT_MS values
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local',EMBEDDING_TIMEOUT_MS:'-100'},'embedding').configured,false);
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local',EMBEDDING_TIMEOUT_MS:'50.5'},'embedding').configured,false);
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local',EMBEDDING_TIMEOUT_MS:'invalid'},'embedding').configured,false);
  assert.equal(parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local',EMBEDDING_TIMEOUT_MS:'500000'},'embedding').configured,false);
  
  // Test valid values don't cause errors
  const validDiagnosis = parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local',AI_TIMEOUT_MS:'1000'},'diagnosis');
  assert.ok(validDiagnosis.configured);
  assert.equal(validDiagnosis.timeoutMs, 1000);
  
  const validEmbedding = parseProviderSettings({EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'local',EMBEDDING_TIMEOUT_MS:'2000'},'embedding');
  assert.ok(validEmbedding.configured);
  assert.equal(validEmbedding.timeoutMs, 2000);
});
test('trocar credencial isola o circuito e preserva o espaço vetorial',()=>{
  const a=parseProviderSettings({EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'a',EMBEDDING_API_KEY:'key-a'},'embedding');
  const b=parseProviderSettings({EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'a',EMBEDDING_API_KEY:'key-b'},'embedding');
  assert.notEqual(a.identity,b.identity);assert.equal(a.embeddingSpace,b.embeddingSpace);
});
test('mesma dimensão não torna embeddings de modelos diferentes compatíveis',()=>{
  const env={EMBEDDING_PROVIDER:'ollama',EMBEDDING_DIMENSIONS:'768'};
  assert.notEqual(parseProviderSettings({...env,EMBEDDING_MODEL:'a'},'embedding').embeddingSpace,parseProviderSettings({...env,EMBEDDING_MODEL:'b'},'embedding').embeddingSpace);
});
test('falha em um provedor não bloqueia outro nem outro modelo',async()=>{
  const memory=store();const first=createAiState(model('openai'),'model',memory);
  await first.failure(new Error('429 no credits remaining'));
  assert.equal((await first.availability()).allowed,false);
  assert.equal((await createAiState(model('anthropic'),'model',memory).availability()).allowed,true);
  assert.equal((await createAiState(model('ollama'),'model',memory).availability()).allowed,true);
  assert.equal((await createAiState(model('openai','model-b'),'model',memory).availability()).allowed,true);
});
test('circuitos de diagnóstico e embeddings são independentes',async()=>{
  const memory=store();const generation=createAiState(model('openai'),'model',memory);
  const embedding=createAiState(parseProviderSettings({EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'embed',EMBEDDING_API_KEY:'key-a'},'embedding'),'model',memory);
  await embedding.failure(new Error('429 no credits remaining'));
  assert.equal((await generation.availability()).allowed,true);assert.equal((await embedding.availability()).allowed,false);
  await generation.clear();assert.equal((await embedding.availability()).allowed,false);
});
test('erro legado da OpenAI não é importado para Anthropic ou Ollama',async()=>{
  const memory=store();await memory.set('aiCircuit',{category:'quota',reason:'erro legado',retryAfter:null});
  assert.equal((await createAiState(model('anthropic'),'model',memory).availability()).allowed,true);
  const legacy=createAiState(parseProviderSettings({OPENAI_API_KEY:'old'},'diagnosis'),'model',memory);
  assert.equal((await legacy.availability()).allowed,false);await legacy.clear();assert.equal((await legacy.availability()).allowed,true);
});
test('modo por regras não executa inferência, mesmo com provedor configurado',async()=>{
  assert.equal((await createAiState(model('ollama'),'rules',store()).availability()).allowed,false);
});
test('formato do diagnóstico não invalida embeddings nem altera sua identidade',()=>{
  const env={EMBEDDING_PROVIDER:'ollama',EMBEDDING_MODEL:'nomic-embed-text',EMBEDDING_API_KEY:'test-key'};
  const baseline=parseProviderSettings(env,'embedding');
  const embedding=parseProviderSettings({...env,AI_RESPONSE_FORMAT:'invalid'},'embedding');
  assert.equal(embedding.configured,true);
  assert.equal(embedding.configurationError,null);
  assert.equal(embedding.identity,baseline.identity);
  assert.equal(embedding.embeddingSpace,baseline.embeddingSpace);
  const diagnosis=parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'qwen3-coder:30b',AI_RESPONSE_FORMAT:'invalid'},'diagnosis');
  assert.equal(diagnosis.configured,false);
  assert.match(diagnosis.configurationError||'',/AI_RESPONSE_FORMAT inválido/);
});
