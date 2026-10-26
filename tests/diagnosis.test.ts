import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceDiagnosis,validateDiagnosis} from '../lib/diagnosis';
import {checkMutation,verifyToken} from '../lib/security';
import type {Evidence} from '../lib/domain';
const at=new Date().toISOString();
const evidence:Evidence[]=[
  {id:'log-1',kind:'log',service:'payments',at,title:'POOL_ACQUIRE_TIMEOUT',detail:'pool indisponível',data:{pool_limit:1}},
  {id:'change-1',kind:'change',service:'payments',at,title:'Pool alterado',detail:'20 → 1',data:{after:{pool_limit:1}}},
  {id:'metric-1',kind:'metric',service:'checkout',at,title:'Erros',detail:'HTTP 503',data:{errorRate:.4}}
];
test('combina mecanismo de erro com alteração observada',()=>{const result=evidenceDiagnosis(evidence,'checkout');assert.equal(result.action,'restore_pool');assert.equal(result.actionService,'payments');assert.equal(result.confidence,'probable');});
test('um deploy isolado não comprova causa',()=>assert.equal(evidenceDiagnosis(evidence.filter(e=>e.kind==='change'),'checkout').confidence,'insufficient'));
test('referências inventadas invalidam ação',()=>{const diagnosis=evidenceDiagnosis(evidence,'checkout');diagnosis.hypotheses[0].supportingEvidence.push('inventado');const result=validateDiagnosis(diagnosis,evidence,'checkout');assert.equal(result.action,'observe');assert.equal(result.confidence,'insufficient');});
test('não autoriza uma ação em outro serviço',()=>{const diagnosis=evidenceDiagnosis(evidence,'checkout');diagnosis.actionService='inventory';assert.equal(validateDiagnosis(diagnosis,evidence,'checkout').action,'observe');});
test('origem diferente não consegue alterar o laboratório',()=>assert.throws(()=>checkMutation(new Request('http://localhost:4320/api/commands',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'}}))));
test('webhook exige token configurado e correspondente',()=>{assert.equal(verifyToken(null,undefined),false);assert.equal(verifyToken('Bearer abc','abc'),true);assert.equal(verifyToken('Bearer abcd','abc'),false);});

test('aceita a origem local mesmo quando o framework normaliza a URL interna',()=>assert.doesNotThrow(()=>checkMutation(new Request('http://localhost:4320/api/commands',{method:'POST',headers:{host:'127.0.0.1:4320',origin:'http://127.0.0.1:4320','content-type':'application/json'}}))));

test('runbooks sozinhos não sustentam uma causa provável',()=>{
  const books:Evidence[]=[{id:'book-1',kind:'runbook',service:'payments',at,title:'Manual',detail:'Procedimento',data:{}},{id:'book-2',kind:'runbook',service:'payments',at,title:'Manual 2',detail:'Procedimento',data:{}}];
  const diagnosis=evidenceDiagnosis(evidence,'checkout');
  diagnosis.hypotheses[0].supportingEvidence=['book-1','book-2'];
  assert.equal(validateDiagnosis(diagnosis,books,'checkout').confidence,'insufficient');
});
