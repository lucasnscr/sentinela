import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {caseMarker,extractCase,validateEvent,protocol} from '../contracts/sdlc-v1.mjs';
import {renderProposal,redactProposal} from '../lib/sdlc/proposal';
test('contrato exige IDs e artefatos imutáveis e rejeita marcadores ambíguos',()=>{
  const id=randomUUID(),hash='a'.repeat(64),marker=caseMarker(id,hash);assert.equal(extractCase(marker)?.caseId,id);assert.throws(()=>extractCase(marker+marker),/Ambiguous/);
  const event={protocol,type:'deployment.started',id:'deploy:1',at:new Date().toISOString(),caseId:id,proposalHash:hash,repository:'example/catalog',service:'catalog',environment:'test',issueNumber:1,pullRequestNumber:2,commitSha:'b'.repeat(40),deploymentId:'d1',artifactDigest:'sha256:'+'c'.repeat(64)};
  validateEvent(event);assert.throws(()=>validateEvent({...event,commitSha:'abcdef0'}),/Full commit/);assert.throws(()=>validateEvent({...event,artifactDigest:'latest'}),/digest/);assert.throws(()=>validateEvent({...event,protocol:'other'}),/Unsupported/);
});
test('proposta revisada tem hash estável e remove formatos conhecidos de credenciais',()=>{
  const input={id:randomUUID(),incidentId:randomUUID(),repository:'example/catalog',service:'catalog',environment:'test',kind:'application' as const,summary:'Bearer private-token https://user:password@example.invalid/path?key=secret',acceptanceCriteria:['Restaurar HTTP 200.'],evidence:[]};
  const first=renderProposal(input);assert.equal(first.proposalHash,renderProposal(input).proposalHash);assert.notEqual(first.proposalHash,renderProposal({...input,summary:'Outra descrição revisada.'}).proposalHash);
  assert.equal(first.proposalBody.includes('private-token'),false);assert.equal(first.proposalBody.includes('password'),false);assert.equal(first.proposalBody.includes('?key='),false);
  assert.equal(redactProposal('sk-proj-'+'x'.repeat(40)).includes('x'.repeat(40)),false);
});
test('token do operador não autoriza eventos do pipeline',async()=>{
  const {POST}=await import('../app/api/sdlc/events/route');const previous=process.env.SDLC_CALLBACK_TOKEN;process.env.SDLC_CALLBACK_TOKEN='pipeline-contract-only';
  try{const response=await POST(new Request('http://127.0.0.1/api/sdlc/events',{method:'POST',headers:{authorization:'Bearer operator-contract-only'},body:'{}'}));assert.equal(response.status,401);}
  finally{if(previous===undefined)delete process.env.SDLC_CALLBACK_TOKEN;else process.env.SDLC_CALLBACK_TOKEN=previous;}
});
