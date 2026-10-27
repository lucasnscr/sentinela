# Evolução do ciclo em cinco fases

Cada fase passa por revisão de diff, testes de contrato/PostgreSQL, teste conjunto e CI antes de merge. O usuário autorizou os merges destas entregas depois da validação; os gates e permissões dos agentes da aplicação continuam preservados. Produção permanece desabilitada por padrão.

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| 1 | Saúde independente após rollback | Reversão saudável confirmada; falha/ausência escalada; mutação não repetida |
| 2 | Tentativas sucessivas | Outra PR para o mesmo incidente, com histórico, limite e nova revisão |
| 3 | Resultados do desenvolvimento | CI/implementação falha, PR encerrada, cancelamento e abandono reconciliados |
| 4 | Aprendizado revisado | Runbook, caso de avaliação e teste de regressão executável, versionados e aprovados |
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

Fase 3 concluída: PRs Sentinela #10 e issue-to-pr-ai #60, 31 cenários PostgreSQL e teste conjunto aprovado na CI 40429300620.

## Fase 4

O painel de um caso `verified` permite preparar aprendizado: responsável declarado, causa revisada, IDs de evidências do caso, fixture sintética, expectativa de diagnóstico e runbook. Cada versão tem hash de conteúdo/proveniência. Aprovação exige token de operação, versão e hash corrente; editar conteúdo aprovado cria outra versão. O revisor é uma declaração autorizada pelo token, sem equivalência a identidade SSO. O runbook aprovado entra no catálogo lexical, preservando o tratamento de conteúdo como evidência não confiável para instruções.

A exportação exige callback token e correção ainda verificada. Não inclui logs brutos ou segredos de configuração; o operador revisa os campos sintéticos e a redação aplica remoção de padrões comuns de credenciais. A cópia exportada é um registro histórico; antes de novo uso consulte a versão e o estado atuais. O hash verifica integridade, sem substituir autenticação da origem.

No par, `scripts/sentinela/learning.mjs` busca o export e gera teste HTTP Java/Testcontainers, fixture JSON, caso de avaliação, runbook e manifesto com hashes. O perfil inicial é `catalog-java-v1`; outros serviços exigem um perfil implementado e validado. Código Java vem de template confiável; apenas dados estruturados são interpolados como recurso JSON. Destinos derivam de UUID/versão; conflitos e symlinks são recusados. Reenvio idêntico não sobrescreve conteúdo.

A rubrica `cause-action-evidence/v1` mede ação, termos revisados da causa e citações de evidências em uma resposta estruturada, independente de provedor. É um teste determinístico de expectativas, não prova geral de qualidade semântica ou causalidade. O teste conjunto exige que o novo teste Java falhe com HTTP 503 na fonte defeituosa e passe na corrigida, usando PostgreSQL real. A geração automatiza a autoria dos artefatos; commit, CI e revisão de sua PR continuam governados.

Após aprovação, o worker encaminha uma issue própria `sentinela-learning/v1`, sem `ai:ready` nem execução do implementador. No par, `SENTINELA_LEARNING_ENABLED=true` habilita o workflow de aprendizado: controle busca export aprovado, job sem callback gera e valida Maven, publisher regenera os mesmos arquivos e abre PR draft com CI explícita. O padrão permanece desabilitado. Envio incerto só permite conferência; falha anterior ao envio permite consulta/publicação novamente. Nenhum desses caminhos concede merge.

Fase 4 concluída: PRs Sentinela #12 e issue-to-pr-ai #62, 33 cenários PostgreSQL, 195 testes de scripts/hook do par, Maven, aprovação pela interface em base sintética e teste conjunto na CI 40432426189. O teste gerado reproduziu HTTP 503 e passou após a correção.

## Fase 5

`SDLC_RECOVERY_POLICIES_JSON` define critérios administrativos por serviço e ambiente. Sem configuração, a política `technical-v1` preserva três amostras técnicas. O [exemplo do catálogo](../examples/issue-to-pr-ai/recovery-policy.json) acrescenta uma operação de negócio GET, assertions de dados e janela estável. Use somente dados de referência sintéticos. O prazo total `SDLC_VERIFY_TIMEOUT_MS` admite de 10 segundos a 10 minutos; a janela estável deve ser menor que esse prazo. O publisher espera até 11 minutos por fase, dentro de um job de 30 minutos.

A proposta contém versão, hash e critérios explícitos; o caso guarda o snapshot completo. Alterações de política bloqueiam início do deploy ou revogam a verificação em curso. Proposta ainda não publicada pode ser preparada/revisada novamente. Com PR já vinculada, encerre-a e prepare outra tentativa; o histórico não é reescrito. `rollbackProbes` permite critérios diferentes para a versão anterior; quando omitido, reutiliza os probes do deploy.

Probes aceitam somente GET em destinos administrativos HTTPS ou HTTP loopback, sem credenciais na URL ou redirects. Cada probe tem limite de dois segundos e 128 KiB; são até três por fase. `headerEnv` só aceita nomes `SENTINELA_PROBE_*`, com `headerName` authorization (Bearer), x-api-key ou x-functions-key. Valores de cabeçalhos, corpos e dados observados não são persistidos: a auditoria registra IDs, resultado, razão, tempo e hash. Assertions usam JSON Pointer e comparação `equals` ou mínimo numérico; a aplicação expõe operações/invariantes de leitura apropriadas.

Só amostras Prometheus novas, posteriores à fase, do mesmo serviço/ambiente e frescas contam. Duplicatas não avançam quantidade nem duração. Falha técnica, dado errado, ausência ou lacuna além de `maxSampleGapMs` reinicia a sequência; o prazo prevalece sobre amostras tardias. A janela usa o tempo das observações distintas, não o tempo de espera. Consultas HTTP ocorrem fora de locks PostgreSQL; antes de aplicar, a fase e a identidade do deploy são conferidas novamente. Incidentes com caso ativo não são encerrados enquanto a recuperação ainda exige verificação/intervenção.

O teste conjunto injeta SKU incorreto com HTTP 200 e telemetria saudável. O Sentinela deve recusar a recuperação, aceitar os dados corrigidos e aguardar a janela estável. Os cenários anteriores de rollback, tentativas, CI, encerramento e aprendizado continuam obrigatórios. Esses probes verificam invariantes observáveis; alterações de dados/migrações continuam seguindo a correção versionada e seus gates.
