# Validação da aplicação

Executada em 26 de outubro de 2026 no checkout independente do Sentinela.

| Verificação | Resultado |
| --- | --- |
| Instalação pelo lockfile (`npm ci`) | Aprovada, sem copiar arquivos de ambiente |
| Tipagem (`npm run check`) | Aprovada; gera tipos do Next.js em checkout novo |
| Testes unitários e hook (`npm test`) | 74 aprovados |
| PostgreSQL, LangGraph, MCP, ingestão, ajustes e SDLC (`npm run test:integration`) | 21 aprovados em banco temporário inicialmente vazio |
| Build de produção (`npm run build`) | Aprovado |
| Fluxo completo (`npm run test:e2e:provider`) | Três cenários aprovados com protocolo Ollama controlado |
| Operação por ambiente (`npm run test:e2e:operations`) | Kubernetes e Azure Functions aprovados com CLIs controladas, worker e API reais |
| Ciclo entre os dois repositórios (`npm run test:e2e:sdlc`) | Correção verificada e entrega defeituosa com rollback aprovadas |
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

O teste SDLC executou os dois contratos idênticos com o checkout `047206f9ffd3c20caf8f0e8e277e0affcc47349a` de issue-to-pr-ai. Catálogo Java, PostgreSQL, Prometheus, HTTP, worker, MCP, wrapper governado, teste de regressão vermelho/verde e troca de containers foram reais. GitHub, resposta do agente e aprovação de merge foram controlados. A interface mostrou um caso com três amostras saudáveis e outro revertido sem marcar correção verificada. O [guia do ciclo](sdlc-integration.md) documenta configuração e execução reproduzível.

O hook foi instalado nos dois checkouts e também recusou um commit real de teste. As verificações cobrem exatamente 20.000 bytes, excesso de um byte, UTF-8, divergência entre índice e working tree, lockfiles, codegen e atributos gerados ainda não staged. Nenhum arquivo alterado desta entrega excede o limite.

Não houve chamada a provedor comercial nem download de modelo nesta preparação do repositório. A inferência real dos adaptadores depende das credenciais e dos modelos disponíveis na instalação.

O patch do catálogo e as regras foram verificados separadamente, com base na revisão `8163f6fc5750bb3282b93ccb421d677a70e23d8e` do `issue-to-pr-ai`. O catálogo externo não foi recompilado, implantado ou monitorado ao vivo nesta validação. Logs e traces externos, Alertmanager e exportação para um collector OpenTelemetry real também não foram exercitados.

A aplicação continua sendo uma referência local de operador único. Autenticação individual, isolamento entre organizações e descoberta de topologia externa não estão implementados. Os conectores de ajuste externo foram verificados com provedores controlados; nenhum cluster Kubernetes ou recurso Azure real foi alterado.

A [auditoria posterior](sdlc-audit.md) acrescenta regressões de frescor, ambiente, prazo, reconciliação pós-merge e respostas saudáveis congeladas. Consulte o relatório agregado da CI para os commits desta revisão.
