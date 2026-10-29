import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('Claude e Ollama mantêm gatilhos, flags e identidade de engine consistentes',()=>{
  const config=JSON.parse(read('config/implementation.json'));
  const claude=read('.github/workflows/claude-implementation.yml');
  const ollama=read('.github/workflows/ollama-implementation.yml');
  for(const [workflow,reusable] of [[claude,'claude-reusable.yml'],[ollama,'ollama-reusable.yml']]){
    assert.ok(workflow.includes(reusable+'@'+config.engineSha));
    assert.ok(workflow.includes('engine_sha: '+config.engineSha));
    assert.ok(workflow.includes('publish_mode: local'));
    assert.ok(workflow.includes("vars.AI_ENABLED == 'true'"));
    assert.ok(workflow.includes("github.event.comment.user.type == 'User'"));
    assert.ok(workflow.includes("run-name: 'AI implementation • issue #"));
    assert.ok(!workflow.includes('secrets: inherit'));
    assert.ok(!workflow.includes('run:'));
  }
  assert.ok(claude.includes("vars.CLAUDE_ENABLED == 'true'"));
  assert.ok(!claude.includes('LOCAL_AI_ENABLED'));
  assert.ok(claude.includes('anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}'));
  assert.ok(claude.includes("vars.CLAUDE_MODEL || 'anthropic/claude-sonnet-4-6'"));
  assert.ok(ollama.includes("vars.LOCAL_AI_ENABLED == 'true'"));
  assert.ok(!ollama.includes('ANTHROPIC_API_KEY'));
});
