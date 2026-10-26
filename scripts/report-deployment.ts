import { deploymentEvent, reportDeployment } from '../lib/integrations/deployment';

try {
  const event = deploymentEvent(process.env);
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ events: [event] }, null, 2));
  } else {
    await reportDeployment(process.env, event);
    console.log(`Deploy registrado: ${event.service} ${event.data.commitSha.slice(0, 7)} (${event.id}).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao registrar o deploy.');
  process.exitCode = 1;
}
