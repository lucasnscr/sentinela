import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrate,pool} from '../../lib/db';
import {searchRunbooks} from '../../lib/knowledge';
after(async()=>{await pool.end();});

test('busca vetorial nunca compara modelos ou dimensões incompatíveis',async()=>{
  await migrate();const prefix='test-'+randomUUID();const service='test-vector-'+randomUUID().slice(0,8);
  const books=[
    {id:prefix+'-matching',space:'provider-a:model-a',vector:[1,0],dimensions:2},
    {id:prefix+'-other-model',space:'provider-a:model-b',vector:[1,0],dimensions:2},
    {id:prefix+'-other-size',space:'provider-a:model-a',vector:[1,0,0],dimensions:3},
    {id:prefix+'-legacy',space:null,vector:Array.from({length:1536},(_,i)=>i===0?1:0),dimensions:null},
  ];
  try{
    for(const book of books)await pool.query('INSERT INTO runbooks(id,title,service,content,embedding,embedding_space,embedding_dimensions) VALUES($1,$2,$3,$4,$5::vector,$6,$7)',[book.id,'Documento de validação vetorial',service,'Conteúdo para verificar isolamento semântico.',JSON.stringify(book.vector),book.space,book.dimensions]);
    const result=await searchRunbooks('nucleotideunmatchedzz',[service],{values:[1,0],space:'provider-a:model-a',dimensions:2});
    assert.deepEqual(result.map(r=>r.id),[books[0].id]);assert.equal(result[0].searchMode,'hybrid');
    const three=await searchRunbooks('nucleotideunmatchedzz',[service],{values:[1,0,0],space:'provider-a:model-a',dimensions:3});
    assert.deepEqual(three.map(r=>r.id),[books[2].id]);
    const unavailable=await searchRunbooks('nucleotideunmatchedzz',[service],{values:[1,0],space:'unknown-space',dimensions:2});
    assert.equal(unavailable.length,0);
  }finally{await pool.query('DELETE FROM runbooks WHERE id=ANY($1)',[books.map(b=>b.id)]);}
});
test('a migração permite múltiplas dimensões sem apagar runbooks existentes',async()=>{
  await migrate();
  const client=await pool.connect();const id='test-migration-'+randomUUID();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(742901)');
    // Create this test's own existing document: a fresh checkout has no worker
    // seed data. Reapply the actual migration instead of the cached migrate().
    await client.query('INSERT INTO runbooks(id,title,service,content,embedding) VALUES($1,$2,$3,$4,$5::vector)',[id,'Documento anterior','test-service','Preservar o conteúdo.',JSON.stringify(Array.from({length:1536},(_,i)=>i===0?1:0))]);
    await client.query(await readFile('lib/schema.sql','utf8'));
    const result=await client.query("SELECT atttypmod FROM pg_attribute WHERE attrelid='runbooks'::regclass AND attname='embedding'");
    assert.equal(result.rows[0].atttypmod,-1);
    const existing=await client.query('SELECT content,vector_dims(embedding) AS dimensions FROM runbooks WHERE id=$1',[id]);
    assert.equal(existing.rows[0].content,'Preservar o conteúdo.');assert.equal(existing.rows[0].dimensions,1536);
    await client.query('UPDATE runbooks SET embedding=$1::vector WHERE id=$2',['[1,0]',id]);
    const updated=await client.query('SELECT vector_dims(embedding) AS dimensions FROM runbooks WHERE id=$1',[id]);
    assert.equal(updated.rows[0].dimensions,2);
  }finally{await client.query('ROLLBACK');client.release();}
});
