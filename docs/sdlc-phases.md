# Evolução do ciclo em cinco fases

Cada fase passa por revisão de diff, testes de contrato/PostgreSQL, teste conjunto e CI antes de merge. O usuário autorizou os merges destas entregas depois da validação; os gates e permissões dos agentes da aplicação continuam preservados. Produção permanece desabilitada por padrão.

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| 1 | Saúde independente após rollback | Reversão saudável confirmada; falha/ausência escalada; mutação não repetida |
| 2 | Tentativas sucessivas | Outra PR para o mesmo incidente, com histórico, limite e nova revisão |
| 3 | Resultados do desenvolvimento | CI/implementação falha, PR encerrada, cancelamento e abandono reconciliados |
| 4 | Aprendizado revisado | Runbook, caso de avaliação e referência verificável ao teste de regressão, versionados e aprovados |
| 5 | Resultado de negócio | Critérios por serviço, assertions de dados e janela estável, ligados à política revisada |

## Fase 1

O evento `deployment.rolled_back` inicia `rollback_verifying`. Só três observações Prometheus novas, saudáveis e do ambiente esperado produzem `rolled_back`. O caso permanece sem correção permanente verificada. Timeout produz `rollback_failed`, criticidade elevada e evento de escalonamento para intervenção. A falha do próprio comando de reversão é informada por `deployment.rollback_failed`.

O publisher aguarda esse resultado sem repetir a reversão. Registros antigos que só possuíam confirmação do pipeline aparecem como `rollback_unverified`; não recebem certificação retroativa de saúde.

Testes novos reproduziram as falhas antes da implementação. O teste conjunto inclui rollback saudável e reversão que preserva o HTTP 503. Os resultados e PRs de cada fase são registrados após conclusão dos checks.

Fase 1 concluída: PRs Sentinela #6 e issue-to-pr-ai #56 incorporadas após revisão, 24 testes PostgreSQL, 181 testes de scripts do par e teste conjunto aprovado na CI 40424791904.

## Fase 2

Uma tentativa terminal permite preparar outra proposta com `previousCaseId`, incidente e critérios revisados. A nova tentativa recebe identidade, hash, issue e PR próprias. O padrão de `SDLC_MAX_ATTEMPTS` é três, com limite configurável entre um e vinte. A criação é serializada por incidente; uma solicitação concorrente reutiliza o mesmo rascunho. Pais obsoletos, tentativas ativas e excesso de limite são recusados.

Eventos novos de um caso substituído não alteram o estado. Um recibo antigo só retorna histórico. Antes de executar o deploy, o publisher exige confirmação de início novo, ativo e no estado `deploying`; recibos repetidos ou de tentativa anterior não autorizam mutação.

Fase 2 concluída: PRs Sentinela #8 e issue-to-pr-ai #58 incorporadas após 27 testes PostgreSQL, 185 testes de scripts do par e teste conjunto na CI 40426944132.

## Fase 3

O notificador executa somente código da branch padrão, sem checkout de candidato ou artefatos, e sincroniza `ci.failed`, `ci.cancelled`, `implementation.failed`, `implementation.cancelled` e `pull_request.closed`. Interrupções pré-PR exigem metadados de uma execução autorizada do implementador. IDs de execução e tentativa impedem que CI antiga substitua resultado mais recente; SHA, repositório, issue, proposta e PR continuam vinculados.

Cancelamento local exige token de operação, hash revisado e motivo. Com PR vinculada, o encerramento ocorre no GitHub. `SDLC_INACTIVITY_TIMEOUT_MS` marca tentativas sem atividade como `abandoned` e escala uma vez; PR abandonada deve ser encerrada antes de outra correção. CI reprovada pode retomar na mesma PR. Nenhuma dessas transições concede merge, label ou execução de agente.

`SDLC_DEPLOYMENT_TIMEOUT_MS` marca entrega sem confirmação como `deployment_uncertain`. Outra mutação permanece bloqueada. Somente recibo autenticado com o mesmo SHA, digest e deploymentId reconcilia conclusão ou rollback; o operador deve conferir o provedor. O watchdog não executa deploy ou rollback por conta própria.
