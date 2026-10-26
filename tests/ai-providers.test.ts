import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseProviderSettings } from '../lib/ai/configuration';
import { createEmbeddingProvider, createModelProvider, ProviderError, type Fetch } from '../lib/ai/providers';
import type { ProviderId } from '../lib/ai/types';

const request = {system:'Instruções da aplicação.',prompt:'Evidências de teste.',schema:z.object({status:z.literal('ok')}),schemaName:'test_status',maxOutputTokens:150};
function settings(provider:ProviderId,role:'diagnosis'|'embedding'='diagnosis',extra:Record<string,string>={}) {
  const prefix=role==='diagnosis'?'AI_':'EMBEDDING_';
  return parseProviderSettings({[prefix+'PROVIDER']:provider,[prefix+'MODEL']:'test-model',[prefix+'BASE_URL']:'http://127.0.0.1:9876/v1',[prefix+'API_KEY']:'test-private-key',...extra},role);
}
function fixture(payload:unknown,check?:(url:string,body:any,headers:Headers)=>void,status=200):Fetch {
  return async(input,init)=>{
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init?.redirect,'error');
    check?.(String(input),JSON.parse(String(init?.body)),new Headers(init?.headers));
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  };
}
const cases:{provider:ProviderId;path:string;payload:unknown;check:(body:any,headers:Headers)=>void}[]=[
  {provider:'openai',path:'/responses',payload:{status:'completed',output:[{content:[{type:'output_text',text:'{"status":"ok"}'}]}],usage:{total_tokens:12}},check:(body,headers)=>{
    assert.equal(body.instructions,request.system);assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.deepEqual(body.text.format.schema.properties.status.enum,['ok']);assert.equal(headers.get('authorization'),'Bearer test-private-key');
  }},
  {provider:'openai-compatible',path:'/chat/completions',payload:{choices:[{finish_reason:'stop',message:{content:'{"status":"ok"}'}}],usage:{total_tokens:12}},check:(body,headers)=>{
    assert.equal(body.response_format.json_schema.name,'test_status');assert.equal(body.messages[1].content,request.prompt);assert.equal(headers.get('authorization'),'Bearer test-private-key');
  }},
  {provider:'anthropic',path:'/messages',payload:{stop_reason:'end_turn',content:[{type:'text',text:'{"status":"ok"}'}],usage:{input_tokens:7,output_tokens:5}},check:(body,headers)=>{
    assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.system,request.system);assert.equal(headers.get('x-api-key'),'test-private-key');assert.equal(headers.get('anthropic-version'),'2023-06-01');assert.equal(headers.get('authorization'),null);
  }},
  {provider:'google',path:'/models/test-model:generateContent',payload:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"status":"ok"}'}]}}],usageMetadata:{totalTokenCount:12}},check:(body,headers)=>{
    assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');assert.ok(body.generationConfig.responseFormat.text.schema);assert.equal(headers.get('x-goog-api-key'),'test-private-key');
  }},
  {provider:'ollama',path:'/api/chat',payload:{done:true,done_reason:'stop',message:{content:'{"status":"ok"}'},prompt_eval_count:7,eval_count:5},check:body=>{
    assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.equal(body.options.num_predict,150);
  }},
];
for(const item of cases)test(item.provider+' usa o protocolo nativo e entrega o mesmo contrato',async()=>{
  const result=await createModelProvider(settings(item.provider),fixture(item.payload,(url,body,headers)=>{
    assert.equal(url,'http://127.0.0.1:9876/v1'+item.path);assert.equal(body.model||'test-model','test-model');item.check(body,headers);
  })).generate(request);
  assert.deepEqual(result.value,{status:'ok'});assert.equal(result.provider,item.provider);assert.equal(result.totalTokens,12);
});
test('Ollama local funciona sem credencial e não herda chave da OpenAI',async()=>{
  const config=parseProviderSettings({AI_PROVIDER:'ollama',AI_MODEL:'local-model',OPENAI_API_KEY:'unrelated-key'},'diagnosis');
  assert.ok(config.configured);assert.equal(config.apiKey,undefined);
  await createModelProvider(config,fixture(cases[4].payload,(_url,_body,headers)=>assert.equal(headers.get('authorization'),null))).generate(request);
});
test('JSON inválido ou fora do schema nunca vira diagnóstico válido',async()=>{
  for(const content of ['não é JSON','{"status":"wrong"}','{"status":5}'])await assert.rejects(
    createModelProvider(settings('ollama'),fixture({done:true,message:{content}})).generate(request),
    (error:unknown)=>error instanceof ProviderError&&error.category==='invalid_output');
});
test('resposta truncada é recusada mesmo quando contém JSON aparentemente válido',async()=>{
  await assert.rejects(createModelProvider(settings('openai-compatible'),fixture({choices:[{finish_reason:'length',message:{content:'{"status":"ok"}'}}]})).generate(request),/incompleta/);
});
test('formato compatível é explícito, sem retentativa silenciosa',async()=>{
  for(const format of ['json_object','prompt']){
    let calls=0;
    const provider=createModelProvider(settings('openai-compatible','diagnosis',{AI_RESPONSE_FORMAT:format}),fixture(cases[1].payload,(_url,body)=>{
      calls++;assert.equal(body.response_format?.type,format==='prompt'?undefined:'json_object');
    }));
    await provider.generate(request);assert.equal(calls,1);
  }
});
test('erro de crédito da Anthropic é classificado sem expor a credencial',async()=>{
  await assert.rejects(createModelProvider(settings('anthropic'),fixture({error:{message:'credit balance too low test-private-key',type:'invalid_request_error'}},undefined,400)).generate(request),
    (error:unknown)=>error instanceof ProviderError&&error.category==='quota'&&!error.message.includes('test-private-key'));
});
test('resposta HTTP fora do contrato não expõe o corpo recebido',async()=>{
  await assert.rejects(createModelProvider(settings('ollama'),fixture(null)).generate(request),/envelope/);
});
for(const provider of ['openai','openai-compatible','ollama','google'] as const)test(provider+' normaliza embeddings e preserva sua procedência',async()=>{
  const config=settings(provider,'embedding',{EMBEDDING_DIMENSIONS:'3'});
  const vectors=[[1,0,0],[0,1,0]];
  const payload=provider==='ollama'?{embeddings:vectors}:provider==='google'?{embeddings:vectors.map(values=>({values}))}:{data:[{index:1,embedding:vectors[1]},{index:0,embedding:vectors[0]}]};
  const result=await createEmbeddingProvider(config,fixture(payload,(url,body)=>{
    assert.ok(url.endsWith(provider==='ollama'?'/api/embed':provider==='google'?':batchEmbedContents':'/embeddings'));
    if(provider==='google')assert.equal(body.requests[0].embedContentConfig.outputDimensionality,3);
    else assert.equal(body.dimensions,3);
  })).embed(['a','b']);
  assert.deepEqual(result.map(v=>v.values),vectors);assert.ok(result.every(v=>v.space===config.embeddingSpace&&v.dimensions===3));
});
test('embeddings com dimensão errada não entram na base',async()=>{
  await assert.rejects(createEmbeddingProvider(settings('ollama','embedding',{EMBEDDING_DIMENSIONS:'3'}),fixture({embeddings:[[1,2]]})).embed(['a']),/dimensões/);
});
test('índices duplicados e vetores nulos são rejeitados',async()=>{
  await assert.rejects(createEmbeddingProvider(settings('openai','embedding'),fixture({data:[{index:0,embedding:[1]},{index:0,embedding:[2]}]})).embed(['a','b']),/índices/);
  await assert.rejects(createEmbeddingProvider(settings('ollama','embedding'),fixture({embeddings:[[0,0]]})).embed(['a']),/vetor nulo/);
});
