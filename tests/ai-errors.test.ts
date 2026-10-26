import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyAiFailure} from '../lib/ai-errors';
test('429 sem créditos bloqueia novas tentativas até revisão manual',()=>assert.equal(classifyAiFailure(new Error('429 You have no credits remaining.')),'quota'));
test('limite temporário de requisições é diferente de falta de créditos',()=>assert.equal(classifyAiFailure(new Error('429 rate_limit_exceeded requests per minute')),'rate_limit'));
test('falha de transporte não implica chave inválida',()=>assert.equal(classifyAiFailure(new Error('Connection timeout')),'transport'));
