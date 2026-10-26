import dotenv from 'dotenv';
import { parseProviderSettings } from './ai/configuration';
dotenv.config({ path: '.env.local', quiet: true });

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://sentinela:sentinela_local@127.0.0.1:56471/sentinela',
  diagnosis: parseProviderSettings(process.env, 'diagnosis'),
  embedding: parseProviderSettings(process.env, 'embedding'),
  aiMode: process.env.AI_MODE === 'rules' ? 'rules' : 'model',
  interval: integer(process.env.MONITOR_INTERVAL_MS, 4000, 1000, 60000),
  labEnabled: process.env.LAB_ENABLED !== 'false',
  labPort: integer(process.env.LAB_BASE_PORT, 4421, 1024, 65000),
  prometheusUrl: process.env.PROMETHEUS_URL || '',
  monitoredEnvironment: process.env.MONITORED_ENVIRONMENT || process.env.SDLC_ENVIRONMENT || '',
  services: (process.env.MONITORED_SERVICES || 'checkout,payments,inventory').split(',').map(s => s.trim()).filter(s => /^[a-zA-Z0-9_.-]{1,64}$/.test(s)),
};
