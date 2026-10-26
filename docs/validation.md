# Validação da aplicação

Executada em 26 de outubro de 2026 no checkout independente do Sentinela.

| Verificação | Resultado |
| --- | --- |
| Instalação pelo lockfile (`npm ci`) | Aprovada, sem copiar arquivos de ambiente |
| Tipagem (`npm run check`) | Aprovada; gera tipos do Next.js em checkout novo |
| Testes unitários (`npm test`) | 60 aprovados |
| PostgreSQL, LangGraph, MCP, ingestão e ajustes (`npm run test:integration`) | 11 aprovados em banco temporário inicialmente vazio |
| Build de produção (`npm run build`) | Aprovado |
| Fluxo completo (`npm run test:e2e:provider`) | Três cenários aprovados com protocolo Ollama controlado |
| Operação por ambiente (`npm run test:e2e:operations`) | Kubernetes e Azure Functions aprovados com CLIs controladas, worker e API reais |
| Regras e configuração Prometheus do catálogo (`promtool check config`) | Quatro regras válidas |
| Compose de observabilidade do catálogo (`docker compose config --quiet`) | Aprovado |
| Workflow GitHub Actions (`actionlint`) | Aprovado |
| Patch de instrumentação do catálogo (`git apply --check`) | Aplica nos arquivos da revisão de referência |
| Evento de deploy (`npm run report:deployment -- --dry-run`) | Revisado com metadados do projeto complementar |

Os testes completos iniciam web, worker e serviços HTTP reais do laboratório. Exercitam detecção automática, investigação por MCP, revisão idempotente, mitigação, confirmação de recuperação e exportação do post-mortem. A recusa de uma origem externa também foi verificada.

O teste de operação inicia web e worker com executáveis de contrato que simulam Kubernetes e Azure CLI, sem acesso a contas reais. Verifica incidente por runtime, coleta por MCP, proposta automática sem execução, token obrigatório, aprovação duplicada com um único ajuste, início de Function App, reinício de Deployment, três coletas saudáveis e exportação do post-mortem. Os testes de integração também cobrem escala, limites, HPA, política e versão alteradas, validade, cooldown, recusa, execução desabilitada, interrupção e conferência de resultado incerto. A área Operação foi inspecionada no navegador com esses dados de teste.

Os testes de provedores usam respostas controladas para OpenAI, APIs compatíveis, Anthropic, Google e Ollama. O teste completo usa um servidor controlado que simula Ollama e embeddings de três dimensões. Valida o contrato de integração; não mede a qualidade de um modelo real. Diagnóstico e embeddings usam testes de conexão e circuitos independentes.

O banco temporário foi criado e removido pelo processo de validação, sem alterar o histórico da aplicação em uso. A verificação em banco vazio revelou uma dependência indevida do teste em um runbook semeado pelo worker. O teste agora insere seu próprio documento e reaplica o SQL de migração para verificar preservação de conteúdo e suporte a dimensões diferentes.

## Limites da validação

Não houve chamada a provedor comercial nem download de modelo nesta preparação do repositório. A inferência real dos adaptadores depende das credenciais e dos modelos disponíveis na instalação.

O patch do catálogo e as regras foram verificados separadamente, com base na revisão `8163f6fc5750bb3282b93ccb421d677a70e23d8e` do `issue-to-pr-ai`. O catálogo externo não foi recompilado, implantado ou monitorado ao vivo nesta validação. Logs e traces externos, Alertmanager e exportação para um collector OpenTelemetry real também não foram exercitados.

A aplicação continua sendo uma referência local de operador único. Autenticação individual, isolamento entre organizações e descoberta de topologia externa não estão implementados. Os conectores de ajuste externo foram verificados com provedores controlados; nenhum cluster Kubernetes ou recurso Azure real foi alterado.
