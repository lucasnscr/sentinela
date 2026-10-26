import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { deploymentEvent, reportDeployment } from '../lib/integrations/deployment';

const env = {
  SOURCE_REPOSITORY: 'lucasnscr/issue-to-pr-ai',
  SOURCE_COMMIT: 'abcdef0123456789abcdef0123456789abcdef01',
  SERVICE_NAME: 'catalog-api', DEPLOYMENT_ENVIRONMENT: 'local',
  SOURCE_ISSUE_NUMBER: '12', SOURCE_PR_NUMBER: '15',
};

test('deploy preserva origem e idempotência e distingue uma nova execução', () => {
  const first = deploymentEvent(env, '2026-10-26T12:00:00.000Z');
  const retry = deploymentEvent(env, '2026-10-26T12:00:01.000Z');
  assert.equal(first.id, retry.id);
  assert.notEqual(first.id, deploymentEvent({ ...env, DEPLOYMENT_ID: 'second' }).id);
  assert.equal(first.data.issueNumber, 12);
  assert.equal(first.data.pullRequestNumber, 15);
  assert.match(first.detail, /issue #12, PR #15/);
  assert.equal(first.kind, 'change');
  assert.equal(first.service, 'catalog-api');
  const github = deploymentEvent({ SERVICE_NAME: 'catalog-api', GITHUB_REPOSITORY: env.SOURCE_REPOSITORY, GITHUB_SHA: env.SOURCE_COMMIT });
  assert.equal(github.data.commitSha, env.SOURCE_COMMIT);
});

test('metadados inválidos ou URLs com segredos são recusados sem ecoar o valor', () => {
  assert.throws(() => deploymentEvent({ ...env, SOURCE_COMMIT: 'not-a-commit' }), /commit/);
  assert.throws(() => deploymentEvent({ ...env, SOURCE_PR_NUMBER: '-1' }), /pullRequestNumber/);
  assert.throws(() => deploymentEvent({ ...env, APPLICATION_URL: 'https://app.example/?token=private' }), /deve omitir/);
  assert.throws(() => deploymentEvent({ ...env, APPLICATION_URL: 'https://user:private@app.example/' }), /deve omitir/);
});

test('o envio autentica, usa o contrato de ingestão e não persiste a credencial no evento', async () => {
  const event = deploymentEvent(env);
  const token = 'test-only-not-a-real-secret';
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/api/telemetry');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.authorization, 'Bearer ' + token);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      assert.equal(body.includes(token), false);
      assert.deepEqual(JSON.parse(body), { events: [JSON.parse(JSON.stringify(event))] });
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: 1 }));
    } catch {
      response.writeHead(500); response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    await reportDeployment({ SENTINELA_URL: `http://127.0.0.1:${address.port}`, SENTINELA_INGEST_TOKEN: token }, event);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('o token não é enviado em HTTP remoto nem em URLs com credenciais', async () => {
  const event = deploymentEvent(env);
  for (const url of ['http://remote.example', 'https://user:secret@remote.example', 'https://remote.example/?token=secret']) {
    await assert.rejects(reportDeployment({ SENTINELA_URL: url, SENTINELA_INGEST_TOKEN: 'test-only-not-a-real-secret' }, event), /SENTINELA_URL/);
  }
});
