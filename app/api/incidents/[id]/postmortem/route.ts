import { findIncident, pool } from '@/lib/db';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const incident=await findIncident(id);
  if(!incident)return Response.json({error:'Incidente não encontrado.'},{status:404});
  const {rows}=await pool.query('SELECT at,title,detail FROM events WHERE incident_id=$1 ORDER BY at',[id]);
  const pending=(incident.diagnosis?.missingInformation||['Concluir investigação.']).filter(text=>incident.status!=='resolved'||!/recupera|recovery|três janelas/i.test(text));
  const text=[
    '# Rascunho de post-mortem: '+incident.title,'',
    '- Incidente: '+incident.id,'- Ambiente: '+incident.environment,'- Estado: '+incident.status,
    '- Início observado: '+incident.createdAt,'- Recuperação verificada: '+(incident.resolvedAt||'pendente'),'',
    '## Diagnóstico','',incident.diagnosis?.cause||'Ainda inconclusivo','',
    'Grau de sustentação: '+(incident.diagnosis?.confidence||'insufficient'),
    'Modo de análise: '+(incident.diagnosis?.mode||'pendente'),'',
    'Provedor: '+(incident.diagnosis?.providerLabel||(incident.diagnosis?.mode==='openai'?'OpenAI':'regras de evidência')),
    'Modelo: '+(incident.diagnosis?.model||'não registrado'),'',
    '## Linha do tempo','',...rows.map(row=>'- '+new Date(row.at).toISOString()+' — '+row.title+': '+row.detail),'',
    '## Evidências','',...incident.evidence.map(e=>'- ['+e.id+'] '+e.kind+' / '+e.service+': '+e.title+' — '+e.detail),'',
    '## Pendências','',...(pending.length?pending:['Revisar o diagnóstico e definir ações preventivas antes de publicar.']).map(s=>'- '+s),'',
    'Este é um rascunho baseado nas observações registradas. Revisar antes de publicar.'
  ].join('\n');
  return new Response(text,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="postmortem-'+id.slice(0,8)+'.md"'}});
}
