import {z} from 'zod';
import {digest} from '../../contracts/learning-v1.mjs';
const identifier=z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const assertion=z.object({pointer:z.string().max(200).regex(/^\/(?:[A-Za-z0-9_-]|~[01])+(?:\/(?:[A-Za-z0-9_-]|~[01])+)*$/),op:z.enum(['equals','min']),value:z.union([z.string().max(256),z.number().finite(),z.boolean()])}).strict().refine(a=>a.op!=='min'||typeof a.value==='number');
const probe=z.object({id:identifier,kind:z.enum(['business','data']),url:z.string().max(1000).refine(value=>{try{const u=new URL(value);return !u.username&&!u.password&&!u.hash&&![...u.searchParams.keys()].some(key=>/^(?:code|token|key|api[_-]?key|access[_-]?token|sig|signature|password|secret)$/i.test(key))&&(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname));}catch{return false;}}),status:z.number().int().min(200).max(299).default(200),headerName:z.enum(['authorization','x-api-key','x-functions-key']).default('authorization'),headerEnv:z.string().regex(/^SENTINELA_PROBE_[A-Z0-9_]{1,100}$/).optional(),assertions:z.array(assertion).max(8).default([])}).strict().refine(p=>p.kind!=='data'||p.assertions.length>0);
const probes=z.array(probe).max(3).refine(items=>new Set(items.map(p=>p.id)).size===items.length);
const schema=z.object({version:identifier,minimumSamples:z.number().int().min(3).max(100).default(3),stabilityMs:z.number().int().min(0).max(540000).default(0),maxSampleGapMs:z.number().int().min(1000).max(20000).default(20000),probes:probes.default([]),rollbackProbes:probes.optional()}).strict();
export type RecoveryProbe=z.infer<typeof probe>;
export type RecoveryPolicy=z.infer<typeof schema>&{rollbackProbes:RecoveryProbe[]};
export type RecoveryCheck={id:string;kind:'business'|'data';passed:boolean;reason:'ok'|'status'|'assertion'|'payload'|'unavailable'|'credentials';at:string};
export function parsePolicy(input:unknown):RecoveryPolicy{const p=schema.parse(input);return {...p,rollbackProbes:p.rollbackProbes??p.probes};}
export const technicalPolicy=()=>parsePolicy({version:'technical-v1'});
export const policyHash=(policy:RecoveryPolicy)=>digest(policy);
export function policyFor(service:string,environment:string,env:Record<string,string|undefined>=process.env):RecoveryPolicy{
 const raw=env.SDLC_RECOVERY_POLICIES_JSON;if(!raw)return technicalPolicy();if(Buffer.byteLength(raw)>64000)throw new Error('Políticas excedem o limite.');
 const scopes=z.array(z.object({service:identifier,environment:identifier,policy:schema}).strict()).max(100).parse(JSON.parse(raw));
 const seen=new Set();for(const scope of scopes){const key=scope.service+':'+scope.environment;if(seen.has(key))throw new Error('Política duplicada para serviço/ambiente.');seen.add(key);}
 const selected=scopes.find(p=>p.service===service&&p.environment===environment);return selected?parsePolicy(selected.policy):technicalPolicy();
}
export function policySnapshot(service:string,environment:string,timeoutMs:number){const policy=policyFor(service,environment);if(policy.stabilityMs>=timeoutMs)throw new Error('Janela estável deve caber no prazo de verificação.');return {recoveryPolicy:policy,recoveryPolicyHash:policyHash(policy)};}
