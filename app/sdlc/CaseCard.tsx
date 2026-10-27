'use client';
import {useState} from 'react';
import type {RemediationCase} from '@/lib/sdlc/types';
import {retryableStates,stateNames} from '@/lib/sdlc/status';
import styles from './sdlc.module.css';
type Props={item:RemediationCase;token:string;pending:boolean;reviewed:boolean;latest:boolean;maxAttempts:number;onReview:(value:boolean)=>void;onCommand:(body:unknown)=>Promise<void>;onRetry:(item:RemediationCase)=>void};
export function CaseCard({item,token,pending,reviewed,latest,maxAttempts,onReview,onCommand,onRetry}:Props){
  const [reason,setReason]=useState('');
  return <section><div className={styles.title}><h2>{item.service} · {item.environment}</h2><strong className={item.state==='verified'?styles.success:styles.warning}>{stateNames[item.state]}</strong></div>
    <p>Destino: {item.repository} · Tentativa {item.attempt||1}/{maxAttempts}</p><p className={styles.mono}>Caso {item.id} · incidente {item.incidentId}</p>
    {item.previousCaseId&&<p className={styles.mono}>Tentativa anterior: {item.previousCaseId}</p>}
    {item.issueUrl&&<p><a href={item.issueUrl} target="_blank" rel="noreferrer">Issue #{item.issueNumber}</a>{item.pullRequestNumber&&<> · <a href={'https://github.com/'+item.repository+'/pull/'+item.pullRequestNumber} target="_blank" rel="noreferrer">PR #{item.pullRequestNumber}</a></>}</p>}
    {item.state==='proposed'&&<><pre>{item.proposalBody}</pre><label className={styles.review}><input type="checkbox" checked={reviewed} onChange={e=>onReview(e.target.checked)}/>Revisei o conteúdo e autorizo publicar esta issue no repositório indicado.</label><button disabled={pending||token.length<24||!reviewed} onClick={()=>void onCommand({kind:'sdlc_publish',requestId:crypto.randomUUID(),caseId:item.id,proposalHash:item.proposalHash})}>Publicar issue revisada</button></>}
    {item.state==='publish_uncertain'&&<button disabled={pending||token.length<24} onClick={()=>void onCommand({kind:'sdlc_reconcile',requestId:crypto.randomUUID(),caseId:item.id})}>Conferir publicação no GitHub</button>}
    {item.commitSha&&<dl><dt>Commit</dt><dd>{item.commitSha}</dd><dt>Artefato</dt><dd>{item.artifactDigest}</dd><dt>Deploy</dt><dd>{item.deploymentId}</dd><dt>Amostras saudáveis após o deploy</dt><dd>{item.healthySamples}/3</dd>{item.rollbackStartedAt&&<><dt>Amostras saudáveis após rollback</dt><dd>{item.rollbackSamples||0}/3</dd></>}</dl>}
    {item.result&&<p>{item.result}</p>}
    {(item.state==='ci_failed'||item.state==='abandoned'&&item.pullRequestNumber&&!item.developmentClosedAt)&&<p>Confira a execução no GitHub. Encerre a PR antes de iniciar outra tentativa.</p>}
    {latest&&retryableStates.includes(item.state)&&!(item.state==='abandoned'&&item.pullRequestNumber&&!item.developmentClosedAt)&&<><p>Uma nova tentativa preserva este histórico e exige outra revisão.</p><button disabled={pending||token.length<24||(item.attempt||1)>=maxAttempts} onClick={()=>onRetry(item)}>Preparar nova tentativa</button>{(item.attempt||1)>=maxAttempts&&<p>Limite atingido. Encaminhe ao mantenedor para revisão da política.</p>}</>}
    {latest&&!item.pullRequestNumber&&['proposed','issue_open','implementation_failed'].includes(item.state)&&<><label>Motivo do cancelamento<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button disabled={pending||token.length<24||reason.trim().length<5} onClick={()=>void onCommand({kind:'sdlc_cancel',requestId:crypto.randomUUID(),caseId:item.id,proposalHash:item.proposalHash,reason})}>Cancelar tentativa revisada</button></>}
  </section>;
}
