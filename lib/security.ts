import { timingSafeEqual } from 'node:crypto';
export function checkMutation(request:Request) {
  const origin=request.headers.get('origin');
  const allowed=(process.env.APP_ORIGINS||'http://127.0.0.1:4320,http://localhost:4320').split(',').map(s=>s.trim());
  const host=request.headers.get('host')||new URL(request.url).host;
  if(!origin||!allowed.includes(origin)||new URL(origin).host!==host)throw new Error('Solicitação de outra origem recusada.');
  const type=request.headers.get('content-type')||'';
  if(!type.includes('application/json'))throw new Error('Envie application/json.');
}
export function verifyToken(actual:string|null,expected:string|undefined) {
  if(!expected||!actual)return false;
  const a=Buffer.from(actual),b=Buffer.from('Bearer '+expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function safeError(error:unknown) {
  const message=error instanceof Error?error.message:'Falha inesperada';
  return message.replace(/sk-[A-Za-z0-9_-]+/g,'[credencial removida]').replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[banco configurado]').slice(0,400);
}
