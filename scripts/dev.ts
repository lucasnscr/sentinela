import { spawn } from 'node:child_process';
if (process.argv.includes('--rules')) process.env.AI_MODE = 'rules';
const configuredPort=Number(process.env.PORT||4320);
const port=Number.isInteger(configuredPort)&&configuredPort>=1024&&configuredPort<=65535?configuredPort:4320;
const children = [
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['--import', 'tsx', 'worker/index.ts'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(signal: NodeJS.Signals = 'SIGTERM') {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill(signal);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop());
for (const child of children) child.on('exit', code => { if (!stopping) { stop(); process.exitCode = code || 0; } });
