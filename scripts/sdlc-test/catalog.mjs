import {cp,mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {run,waitFor} from './process.mjs';
export const fault='        if (Boolean.getBoolean("sentinela.contract.failure")) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE); // sentinela-contract-fault\n';
export async function catalogFixture(peer,suffix){
  const directory=await mkdtemp(path.join(tmpdir(),'sentinela-sdlc-catalog-')),checkout=path.join(directory,'source');
  const excluded=new Set(['.git','target','.venv','node_modules','artifacts']);
  await cp(peer,checkout,{recursive:true,filter:source=>{const name=path.basename(source);return !excluded.has(name)&&!name.startsWith('.env')&&!/\.(pem|key|log)$/.test(name);}});
  const git=args=>run('git',args,{cwd:checkout,quiet:true});await git(['init','-b','contract-test']);await git(['config','user.name','contract-test']);await git(['config','user.email','test@example.invalid']);
  const controller=path.join(checkout,'apps/catalog-api/src/main/java/dev/continuousai/catalog/product/ProductController.java');
  const baseline=await readFile(controller,'utf8');const anchor='        String categoryValue = category.orElse(null);';assert.ok(baseline.includes(anchor));
  await writeFile(controller,baseline.replace(anchor,fault+anchor));await git(['add','.']);await git(['commit','-m','test: injected catalog regression']);
  const badSha=(await git(['rev-parse','HEAD'])).output;await run('node',['scripts/install-git-hooks.mjs'],{cwd:checkout,quiet:true});
  const network='sentinela-sdlc-'+suffix,db=network+'-db',api=network+'-api',prom=network+'-prom';
  const badImage='sentinela-sdlc-bad:'+suffix,fixedImage='sentinela-sdlc-fixed:'+suffix;
  const docker=(args,options={})=>run('docker',args,{quiet:true,...options});let active='';let load;
  async function cleanup(){if(load)clearInterval(load);for(const name of [api,prom,db])await docker(['rm','-f',name],{allowFailure:true});await docker(['network','rm',network],{allowFailure:true});await docker(['image','rm',badImage,fixedImage],{allowFailure:true});await rm(directory,{recursive:true,force:true});}
  try{
  await docker(['network','create',network]);
  await docker(['run','-d','--name',db,'--network',network,'-e','POSTGRES_DB=catalog','-e','POSTGRES_USER=catalog','-e','POSTGRES_PASSWORD=catalog','postgres:17-alpine']);
  await waitFor('catalog PostgreSQL',async()=>(await docker(['exec',db,'pg_isready','-U','catalog','-d','catalog'],{allowFailure:true})).code===0);
  await run('docker',['build','-t',badImage,checkout],{quiet:true});
  async function deploy(image){
    if(active)await docker(['rm','-f',api]);
    await docker(['run','-d','--name',api,'--network',network,'--network-alias','catalog-under-test','-p','127.0.0.1::8080',
      '-e','DATABASE_URL=jdbc:postgresql://'+db+':5432/catalog','-e','DATABASE_USER=catalog','-e','DATABASE_PASSWORD=catalog','-e','JAVA_TOOL_OPTIONS=-Dsentinela.contract.failure=true',image]);active=image;
    const binding=JSON.parse((await docker(['inspect',api])).output)[0].NetworkSettings.Ports['8080/tcp'][0].HostPort;
    const url='http://127.0.0.1:'+binding;
    await waitFor('catalog HTTP',async()=>{const response=await fetch(url+'/actuator/health/readiness',{signal:AbortSignal.timeout(2000)});return response.ok;});return url;
  }
  let base=await deploy(badImage);
  load=setInterval(()=>{void fetch(base+'/api/products?page=0&size=20',{signal:AbortSignal.timeout(2000)}).then(response=>response.body?.cancel()).catch(()=>{});},250);
  const promConfig=path.join(directory,'prom');await mkdir(promConfig,{mode:0o755});
  const rules=(await readFile(new URL('../../examples/issue-to-pr-ai/recording-rules.yml',import.meta.url),'utf8')).replaceAll('[1m]','[10s]');
  await writeFile(path.join(promConfig,'rules.yml'),rules);
  await writeFile(path.join(promConfig,'prometheus.yml'),'global:\n  scrape_interval: 1s\n  evaluation_interval: 1s\nrule_files: [/etc/prometheus/rules.yml]\nscrape_configs:\n  - job_name: catalog\n    metrics_path: /actuator/prometheus\n    static_configs:\n      - targets: [catalog-under-test:8080]\n');
  await docker(['run','-d','--name',prom,'--network',network,'-p','127.0.0.1::9090','-v',promConfig+':/etc/prometheus:ro','prom/prometheus:v3.5.0']);
  const promPort=JSON.parse((await docker(['inspect',prom])).output)[0].NetworkSettings.Ports['9090/tcp'][0].HostPort;
  const digest=async image=>{const id=(await docker(['image','inspect',image,'--format','{{.Id}}'])).output;assert.match(id,/^sha256:[a-f0-9]{64}$/);return id;};
  return {checkout,directory,badSha,badImage,fixedImage,prometheusUrl:'http://127.0.0.1:'+promPort,
    async failed(){assert.equal((await fetch(base+'/api/products')).status,503);},
    async implement(issue){
      const test=await readFile(new URL('./recovery-test.java.txt',import.meta.url),'utf8');await writeFile(path.join(checkout,'apps/catalog-api/src/test/java/dev/continuousai/catalog/product/SentinelaRecoveryIT.java'),test);
      const red=await run('./mvnw',['-B','-ntp','verify','-Dit.test=SentinelaRecoveryIT','-DfailIfNoTests=false'],{cwd:checkout,allowFailure:true,quiet:true});assert.notEqual(red.code,0,'Regression test must fail on the bad source.');const failureReport=await readFile(path.join(checkout,'apps/catalog-api/target/failsafe-reports/TEST-dev.continuousai.catalog.product.SentinelaRecoveryIT.xml'),'utf8');assert.match(failureReport,/<failure/);assert.match(failureReport,/503/);
      const task=path.join(directory,'issue.md');await writeFile(task,issue.body);
      const {runClaudeImplementation}=await import(pathToFileURL(path.join(checkout,'scripts/run-implementation.mjs')).href);
      await runClaudeImplementation({env:{MODEL:'anthropic/claude-sonnet-4-6',TASK_FILE:task,ANTHROPIC_API_KEY:'contract-only-not-a-real-key'},usageFile:path.join(directory,'usage.json'),summaryFile:path.join(directory,'summary.md'),
        run:async()=>{await writeFile(controller,(await readFile(controller,'utf8')).replace(fault,''));return {status:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Correção controlada da regressão e teste PostgreSQL preservado.',total_cost_usd:0,num_turns:1,usage:{input_tokens:1,output_tokens:1}})};}});
      const {validateChanges}=await import(pathToFileURL(path.join(checkout,'scripts/validate-agent-changes.mjs')).href);validateChanges(checkout,badSha);
      await run('./mvnw',['-B','-ntp','verify'],{cwd:checkout,quiet:true});
      await git(['add','apps/catalog-api/src']);await git(['commit','-m','fix: remove injected regression after independent PostgreSQL validation']);
      const sha=(await git(['rev-parse','HEAD'])).output;
      await run('docker',['build','-t',fixedImage,checkout],{quiet:true});return {sha,digest:await digest(fixedImage)};
    },
    digest,
    async use(image){base=await deploy(image);},
    cleanup,
  };
  }catch(error){await cleanup();throw error;}
}
