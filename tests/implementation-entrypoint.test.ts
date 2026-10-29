import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateImplementationConfig} from '../scripts/implement-issue';
test('engine de implementação exige perfil, repositório e commit imutável revisados',()=>{
  const config={version:1,repository:'lucasnscr/sentinela',profile:'sentinela-typescript',engineRepository:'lucasnscr/issue-to-pr-ai',engineSha:'a'.repeat(40)};
  assert.equal(validateImplementationConfig(config).engineSha,config.engineSha);
  for(const override of [{engineSha:'main'},{engineRepository:'other/engine'},{repository:'other/target'},{profile:'catalog-java'},{version:2}])assert.throws(()=>validateImplementationConfig({...config,...override}));
});
