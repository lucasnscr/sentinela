export type AiFailureCategory='quota'|'authentication'|'access'|'rate_limit'|'transport'|'configuration'|'invalid_output';
export function classifyAiFailure(error:unknown):AiFailureCategory {
  if(error&&typeof error==='object'&&'category' in error&&['quota','authentication','access','rate_limit','transport','configuration','invalid_output'].includes(String(error.category)))return error.category as AiFailureCategory;
  const message=(error instanceof Error?error.message:String(error)).toLowerCase();
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  if(/insufficient_quota|no credits|run out of credits|no balance|credit balance|billing quota|current quota/.test(message+' '+code))return 'quota';
  if(/401|invalid_api_key|api_key_invalid|unauthenticated|missing.*api.key/.test(message+' '+code))return 'authentication';
  if(/403|model_not_found|permission/.test(message+' '+code))return 'access';
  if(/429|rate_limit|requests per|tokens per/.test(message+' '+code))return 'rate_limit';
  return 'transport';
}
