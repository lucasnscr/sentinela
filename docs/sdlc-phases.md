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
