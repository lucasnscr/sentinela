import type { KubernetesTarget, OperationPlan, RuntimeObservation, RuntimeIssue } from '../../lib/operations/types';
import { commandJson, type CommandRunner } from './command';
import { version } from './adapter';

function args(target: KubernetesTarget) {
  return ['--context', target.context, '--namespace', target.namespace, '--request-timeout=10s'];
}
function text(value: unknown, limit = 250) { return typeof value === 'string' ? value.slice(0, limit) : ''; }
function selector(deployment: any) {
  const labels = Object.entries(deployment.spec?.selector?.matchLabels || {}).map(([key, value]) => `${key}=${value}`);
  for (const item of deployment.spec?.selector?.matchExpressions || []) {
    if (item.operator === 'In') labels.push(`${item.key} in (${item.values.join(',')})`);
    else if (item.operator === 'NotIn') labels.push(`${item.key} notin (${item.values.join(',')})`);
    else if (item.operator === 'Exists') labels.push(item.key);
    else if (item.operator === 'DoesNotExist') labels.push('!' + item.key);
    else throw new Error('Seletor de Deployment não suportado.');
  }
  if (!labels.length) throw new Error('Deployment sem seletor explícito.');
  return labels.join(',');
}
export async function observeKubernetes(target: KubernetesTarget, run: CommandRunner): Promise<RuntimeObservation> {
  const deployment = commandJson(await run('kubectl', [...args(target), 'get', 'deployment/' + target.deployment, '-o', 'json']));
  if (deployment.kind !== 'Deployment' || deployment.metadata?.name !== target.deployment || deployment.metadata?.namespace !== target.namespace || !deployment.metadata?.uid || !deployment.metadata?.resourceVersion) throw new Error('O cluster não confirmou o Deployment configurado.');
  const select = selector(deployment);
  const [rs, pods, autoscalers, events] = await Promise.all([
    run('kubectl', [...args(target), 'get', 'replicasets', '--selector', select, '-o', 'json']),
    run('kubectl', [...args(target), 'get', 'pods', '--selector', select, '-o', 'json']),
    run('kubectl', [...args(target), 'get', 'hpa', '-o', 'json']),
    run('kubectl', [...args(target), 'get', 'events', '--field-selector', 'type=Warning', '-o', 'json']),
  ]);
  const ownedSets = new Set(commandJson(rs).items.filter((item: any) => item.metadata?.ownerReferences?.some((owner: any) => owner.uid === deployment.metadata.uid && owner.controller === true)).map((item: any) => item.metadata.uid));
  const ownedPods = commandJson(pods).items.filter((pod: any) => pod.metadata?.ownerReferences?.some((owner: any) => ownedSets.has(owner.uid) && owner.controller === true) && !pod.metadata?.deletionTimestamp);
  const objectUids = new Set([deployment.metadata.uid, ...ownedSets, ...ownedPods.map((pod: any) => pod.metadata.uid)]);
  const warnings = commandJson(events).items.filter((item: any) => objectUids.has(item.involvedObject?.uid)).slice(-8).map((item: any) => ({ reason: text(item.reason), at: text(item.lastTimestamp || item.eventTime), count: item.count || 1 }));
  const hpa = commandJson(autoscalers).items.some((item: any) => item.spec?.scaleTargetRef?.kind === 'Deployment' && item.spec.scaleTargetRef.name === target.deployment);
  const desired = deployment.spec?.replicas ?? 1;
  const ready = deployment.status?.readyReplicas || 0;
  const available = deployment.status?.availableReplicas || 0;
  const updated = deployment.status?.updatedReplicas || 0;
  const generation = deployment.metadata.generation || 0;
  const observedGeneration = deployment.status?.observedGeneration || 0;
  const issues: RuntimeIssue[] = [];
  for (const pod of ownedPods) {
    const containers = [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])];
    for (const container of containers) {
      const waiting = container.state?.waiting?.reason;
      const terminated = container.state?.terminated?.reason;
      if (waiting && ['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError', 'RunContainerError'].includes(waiting)) issues.push({ code: waiting, message: `${text(pod.metadata.name)} / ${text(container.name)}: ${waiting}` });
      if ((terminated === 'OOMKilled' || container.lastState?.terminated?.reason === 'OOMKilled') && !container.ready) issues.push({ code: 'OOMKilled', message: `${text(pod.metadata.name)}: container encerrado por limite de memória.` });
    }
    if (pod.status?.conditions?.some((condition: any) => condition.type === 'PodScheduled' && condition.status === 'False' && condition.reason === 'Unschedulable')) issues.push({ code: 'Unschedulable', message: `${text(pod.metadata.name)}: não foi possível agendar o pod.` });
  }
  const conditions = (deployment.status?.conditions || []).map((item: any) => ({ type: text(item.type), status: text(item.status), reason: text(item.reason) }));
  if (conditions.some((item: any) => item.type === 'Progressing' && item.status === 'False')) issues.push({ code: 'RolloutFailed', message: 'O rollout não progrediu dentro do prazo.' });
  if (conditions.some((item: any) => item.type === 'ReplicaFailure' && item.status === 'True')) issues.push({ code: 'ReplicaFailure', message: 'O controlador não conseguiu criar réplicas.' });
  let phase: RuntimeObservation['phase'] = 'healthy';
  if (deployment.spec?.paused) phase = 'unknown';
  else if (desired === 0) phase = 'inactive';
  else if (issues.length || available < desired || ready < desired) phase = 'degraded';
  else if (observedGeneration < generation || updated !== desired || (deployment.status?.replicas || 0) !== desired) phase = 'transitioning';
  if (phase === 'healthy' && ownedPods.length < desired) phase = 'transitioning';
  if (phase === 'degraded' && !issues.length) issues.push({ code: 'UnavailableReplicas', message: `${available}/${desired} réplicas disponíveis.` });
  return {
    targetId: target.id, runtime: target.runtime, service: target.service,
    scope: `${target.context}/${target.namespace}/${target.deployment}`, at: new Date().toISOString(), phase,
    version: version({ uid: deployment.metadata.uid, generation, replicas: desired, paused: !!deployment.spec?.paused }),
    summary: phase === 'healthy' ? `${ready}/${desired} réplicas prontas; rollout atualizado.` : phase === 'inactive' ? 'Deployment intencionalmente com zero réplicas.' : phase === 'transitioning' ? 'Rollout em andamento.' : issues[0]?.message || 'Deployment pausado; saúde não confirmada.',
    issues, allowedActions: target.actions,
    details: { uid: deployment.metadata.uid, resourceVersion: deployment.metadata.resourceVersion, generation, observedGeneration,
      desired, ready, available, updated, hpa, paused: !!deployment.spec?.paused, pods: ownedPods.length,
      conditions, warnings, restartMarker: deployment.spec?.template?.metadata?.annotations?.['sentinela.dev/operation-id'] || null },
  };
}
export async function executeKubernetes(target: KubernetesTarget, plan: OperationPlan, current: RuntimeObservation, run: CommandRunner) {
  // Atomic preconditions prevent applying a reviewed change to a replaced or
  // concurrently edited Deployment. Restart uses a deterministic annotation.
  const patch: object[] = [
    { op: 'test', path: '/metadata/uid', value: current.details.uid },
    { op: 'test', path: '/metadata/resourceVersion', value: current.details.resourceVersion },
  ];
  if (plan.action === 'scale') patch.push({ op: 'add', path: '/spec/replicas', value: plan.replicas });
  else if (plan.action === 'restart') {
    // Adding the annotations map by merge patch would discard other managers'
    // values. Read only that map and preserve every existing annotation.
    const live = commandJson(await run('kubectl', [...args(target), 'get', 'deployment/' + target.deployment, '-o', 'json']));
    if (live.metadata?.resourceVersion !== current.details.resourceVersion) throw new Error('Deployment mudou antes do ajuste. Gere outro plano.');
    patch.push({ op: 'add', path: '/spec/template/metadata/annotations', value: { ...(live.spec?.template?.metadata?.annotations || {}), 'sentinela.dev/operation-id': plan.id } });
  } else throw new Error('Ação Kubernetes inválida.');
  await run('kubectl', [...args(target), 'patch', 'deployment/' + target.deployment, '--type=json', '--patch', JSON.stringify(patch), '-o', 'name']);
}
