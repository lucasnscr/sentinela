import {repository} from '../../contracts/sdlc-v1.mjs';
import type {SdlcSettings} from './types';
export function sdlcSettings(env:Record<string,string|undefined>=process.env):SdlcSettings {
  const enabled=env.SDLC_ENABLED==='true';
  const repo=env.SDLC_REPOSITORY||'';
  const environment=env.SDLC_ENVIRONMENT||'local';
  const services=(env.SDLC_SERVICES||'').split(',').map(value=>value.trim()).filter(Boolean);
  const githubTokenEnv=env.SDLC_GITHUB_TOKEN_ENV||'SENTINELA_GITHUB_TOKEN';
  const verifyTimeoutMs=Number(env.SDLC_VERIFY_TIMEOUT_MS||300000);
  if(enabled){
    repository(repo);
    if(env.MONITORED_ENVIRONMENT&&env.MONITORED_ENVIRONMENT!==environment)throw new Error('MONITORED_ENVIRONMENT deve corresponder a SDLC_ENVIRONMENT.');
    if(!/^[A-Za-z0-9_.-]{1,64}$/.test(environment)||!services.length||services.some(value=>!/^[A-Za-z0-9_.-]{1,64}$/.test(value)))throw new Error('Configure serviço e ambiente SDLC explícitos.');
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(githubTokenEnv)||!Number.isInteger(verifyTimeoutMs)||verifyTimeoutMs<10000||verifyTimeoutMs>3600000)throw new Error('Configuração SDLC inválida.');
  }
  return {enabled,repository:repo,environment,services,githubTokenEnv,verifyTimeoutMs};
}
