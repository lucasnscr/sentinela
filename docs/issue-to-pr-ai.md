# Integração com issue-to-pr-ai

O [issue-to-pr-ai](https://github.com/lucasnscr/issue-to-pr-ai) conduz a mudança: issue, critérios, implementação, testes reais, revisão e decisão do mantenedor. O Sentinela acompanha a operação da aplicação entregue, detecta degradação e reúne evidências para orientar a próxima mudança.

O exemplo usa `apps/catalog-api`, laboratório Java/Spring/PostgreSQL do projeto. Na revisão de referência (`8163f6fc5750bb3282b93ccb421d677a70e23d8e`), o catálogo expõe health/info, mas ainda não inclui o registry nem o endpoint Prometheus. Os arquivos abaixo preparam essa integração; este repositório não altera automaticamente o catálogo nem cria issues ou PRs nele.

## Fluxo entre os projetos

| Etapa | Responsável | Evidência transferida |
| --- | --- | --- |
| Definir e implementar mudança | issue-to-pr-ai e mantenedor | Issue, critérios, testes, PR e commit |
| Fazer o deploy | Pipeline ou operador | Evento `change` com commit, ambiente e referências |
| Observar a aplicação | Worker do Sentinela | Métricas normalizadas e eventos operacionais |
| Investigar degradação | Grafo LangGraph e ferramentas MCP | Hipóteses, evidências, confiança e recomendação |
| Decidir uma correção | Operador e mantenedor | Post-mortem e critérios para uma nova issue |

O deploy próximo de uma falha é uma pista. O diagnóstico deve combinar essa alteração com logs, traces ou métricas compatíveis. A versão atual não implementa criação automática de issue, acesso ao código GitHub ou execução de correções na aplicação externa.

## Preparar o catálogo

Mantenha os dois checkouts separados, por exemplo `Documents/issue-to-pr-ai` e `Documents/sentinela`. No checkout de `issue-to-pr-ai`, revise e aplique o exemplo:

```sh
git apply --check ../sentinela/examples/issue-to-pr-ai/catalog-observability.patch
git apply ../sentinela/examples/issue-to-pr-ai/catalog-observability.patch
docker compose up --build -d
curl --fail http://127.0.0.1:8080/actuator/prometheus
```

O patch adiciona `micrometer-registry-prometheus`, expõe o endpoint e habilita histogramas de requisições com a label `service=catalog-api`. O patch foi preparado sobre a revisão acima; mudanças posteriores podem exigir adaptação. Faça os testes do catálogo e revise a mudança antes de incorporá-la ao seu fluxo normal.

Esse exemplo é local. O endpoint de métricas deve ficar em uma rede de observabilidade protegida ao adaptar a implantação.

## Iniciar o Prometheus

No checkout do Sentinela:

```sh
docker compose -f examples/issue-to-pr-ai/compose.yaml up -d
```

O serviço usa `http://127.0.0.1:9091`, separado do perfil de observabilidade do laboratório. Ele coleta o catálogo em `host.docker.internal:8080` e avalia as recording rules a cada cinco segundos. No Linux, o Compose configura `host-gateway`.

| Série do Sentinela | Origem no catálogo |
| --- | --- |
| `sentinela_service_requests_per_minute` | Taxa do contador HTTP multiplicada por 60 |
| `sentinela_service_error_ratio` | Respostas HTTP 5xx divididas pelo total |
| `sentinela_service_latency_p95_ms` | Quantil 0,95 do histograma HTTP, convertido para ms |
| `sentinela_service_saturation_ratio` | Conexões Hikari ativas divididas pelo máximo; opcional |

As consultas excluem requisições ao Actuator para não confundir o scrape com tráfego de usuários. A janela é de um minuto; mantenha tráfego de teste e aguarde o preenchimento da janela:

```sh
while true; do
  curl --fail --silent --output /dev/null 'http://127.0.0.1:8080/api/products?page=0&size=20'
  sleep 2
done
```

O detector exige pelo menos três requisições estimadas por amostra; esse exemplo produz aproximadamente 30 por minuto. Erros precisam aparecer em duas amostras consecutivas. Recuperação exige três amostras saudáveis com tráfego. Ausência de dados não comprova saúde e ainda não gera um incidente próprio de perda de telemetria.

## Configurar o Sentinela

Copie `.env.example` para `.env.local` e ajuste:

```dotenv
LAB_ENABLED=false
PROMETHEUS_URL=http://127.0.0.1:9091
MONITORED_SERVICES=catalog-api
AI_PROVIDER=none
EMBEDDING_PROVIDER=none
```

Configure também `TELEMETRY_INGEST_TOKEN` com um segredo aleatório local de pelo menos 16 caracteres. Guarde-o fora do Git. O cliente de deploy usa o mesmo valor com o nome `SENTINELA_INGEST_TOKEN`. Reinicie web e worker para aplicar o ambiente.

```sh
npm ci
npm run db:up
npm run db:migrate
npm run dev
```

Diagnóstico e embeddings são independentes e aceitam os [provedores configuráveis](ai-providers.md). O fluxo funciona com análise por regras sem chave comercial. Para uma investigação com mais contexto, envie logs e traces pelo contrato de `POST /api/telemetry` descrito no README. Prometheus e eventos de deploy, sozinhos, podem resultar em diagnóstico inconclusivo.

A topologia de dependências do laboratório é específica de checkout/payments/inventory; o catálogo externo não ganha descoberta automática de dependências. Mitigações externas são consultivas.

## Registrar o deploy

Depois que o deploy concluir, execute no checkout do Sentinela, com o token disponível no ambiente do processo:

```sh
export SENTINELA_URL=http://127.0.0.1:4320
export SERVICE_NAME=catalog-api
export SOURCE_REPOSITORY=lucasnscr/issue-to-pr-ai
export SOURCE_COMMIT="$(git -C ../issue-to-pr-ai rev-parse HEAD)"
export DEPLOYMENT_ENVIRONMENT=local
export APPLICATION_URL=http://127.0.0.1:8080
# Opcionais: use os números reais da mudança, se disponíveis.
# export SOURCE_ISSUE_NUMBER=12
# export SOURCE_PR_NUMBER=15
# export DEPLOYMENT_ID=identificador-unico-desta-execucao

npm run report:deployment -- --dry-run
npm run report:deployment
```

`--dry-run` mostra o evento sem enviar a requisição e sem incluir o token. O cliente recusa URLs com credenciais e exige HTTPS para destinos fora de loopback. O exemplo usa a interface local; um runner hospedado não consegue acessar o loopback do seu computador.

| Variável | Uso |
| --- | --- |
| `SENTINELA_URL` | Origem da API, sem caminho, query ou credenciais |
| `SENTINELA_INGEST_TOKEN` | Mesmo segredo configurado como `TELEMETRY_INGEST_TOKEN` no servidor |
| `SERVICE_NAME` | Serviço presente em `MONITORED_SERVICES` |
| `SOURCE_REPOSITORY`, `SOURCE_COMMIT` | Origem da aplicação; aceitam fallback `GITHUB_REPOSITORY` e `GITHUB_SHA` |
| `DEPLOYMENT_ENVIRONMENT` | Ambiente monitorado; padrão `local` |
| `SOURCE_ISSUE_NUMBER`, `SOURCE_PR_NUMBER` | Referências opcionais à mudança |
| `DEPLOYMENT_ID` | Distingue redeploys do mesmo commit; fallback `GITHUB_RUN_ID` |
| `DEPLOYMENT_VERSION`, `APPLICATION_URL` | Metadados opcionais; URL sem segredos |

Reenvios do mesmo deploy usam o mesmo ID. Para registrar um novo deploy do mesmo commit, informe outro `DEPLOYMENT_ID`. O evento é evidência de alteração, não confirmação de que a aplicação está saudável. Cada instância/banco do Sentinela deve monitorar um ambiente: a seleção atual das métricas agrupa por serviço, sem isolamento entre ambientes.

## Devolver evidências ao fluxo de entrega

Exporte o post-mortem do incidente pela interface ou por `GET /api/incidents/:id/postmortem`. Use-o para redigir uma issue no projeto da aplicação com:

- sintoma, impacto e intervalo da falha;
- evidências e hipótese de causa, distinguindo o que foi confirmado;
- commit, issue e PR do deploy correlacionado, quando disponíveis;
- correção proposta, critério de aceitação e teste de regressão;
- condição de recuperação que o Sentinela deverá observar após o próximo deploy.

O mantenedor revisa essa issue e continua pelo método do `issue-to-pr-ai`. A decisão de merge e o deploy permanecem no fluxo de entrega.
