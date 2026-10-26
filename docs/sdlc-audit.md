# Auditoria do ciclo entre Sentinela e issue-to-pr-ai

Data: 26 de outubro de 2026. Escopo: integração incorporada pelas PRs Sentinela #2 e issue-to-pr-ai #52, auditada novamente na issue Sentinela #3 e issue-to-pr-ai #53. Os dois projetos se integram por contrato versionado e formam um ciclo de correção com autonomia supervisionada. A auditoria encontrou defeitos; portanto, o resultado anterior de CI não sustentava uma afirmação de funcionamento perfeito.

## Defeitos reproduzidos e corrigidos

| Risco | Comportamento encontrado | Correção e evidência |
| --- | --- | --- |
| Recuperação falsa | O coletor atribuía a hora da consulta a valores antigos | Recording rule de hora do scrape, condicionada a `up == 1`; repetição preserva o mesmo instante |
| Mistura de ambientes | Séries eram agrupadas somente por serviço | Label `environment` no catálogo, regras por serviço/ambiente e seleção explícita no coletor |
| Instante futuro | A diferença negativa de relógio passava no teste de frescor | Recusa de observações futuras e de valores com idade >= 20 segundos |
| Ausência de dados | A sequência saudável sobrevivia a lacunas | Dados ausentes, inválidos, antigos ou de outro ambiente interrompem a sequência |
| Sucesso após prazo | A terceira amostra tinha precedência sobre timeout | Prazo conferido antes da decisão de sucesso |
| Callback perdido | Uma PR integrada antes da notificação ficava sem vínculo | Entrega autorizada reconcilia o head da PR antes de iniciar; deploy conserva o SHA integrado |
| Rollback após verificação | A reversão podia ser recusada se a confirmação anterior se perdesse | Rollback confirmado da mesma identidade revoga `verified`; outra entrega continua recusada |

Seis testes de frescor/prazo e o teste de callback perdido falharam antes das correções e passaram depois. O teste conjunto também cobre telemetria saudável congelada, sem novos scrapes utilizáveis após a conclusão da entrega.

## Cobertura do ciclo

| Etapa | Implementação e validação | Limite |
| --- | --- | --- |
| Planejamento | Incidente, evidências selecionadas, proposta revisada, critérios e issue; especificação assistida no projeto de implementação | Priorização e autorização dependem do mantenedor |
| Design | Contrato SDLC, regras dos agentes, skills e decisões versionadas | Análise arquitetural ampla exige revisão por tarefa |
| Implementação | Gates de colaborador/issue/label, wrapper governado, escopo e orçamento | Resposta do agente controlada no teste conjunto; não mede qualidade universal de modelos |
| Testes/revisão | Maven/PostgreSQL, regressão vermelha/verde, CI, triagem e avaliação versionada do revisor | O benchmark do revisor é limitado e não funciona como certificação automática de release |
| Entrega | PR integrada, imagem por digest, job protegido e adaptador Kubernetes com precondições | Teste conjunto troca containers Docker; cluster/GHCR de produção exigem validação separada |
| Operação | Prometheus, investigação com MCP/LangGraph, verificação pós-deploy, mitigação e rollback | Azure Functions tem observação/ajustes e testes de contrato; não há entrega Azure equivalente neste piloto |
| Aprendizado | Incidentes retornam a issues e correções incluem regressão; há avaliação do revisor | Conversão automática de traces reais em datasets aprovados e metas de qualidade por modelo ainda não está implementada |
| Segurança | Identidades separadas, código de controle confiável, escopos, revisão, limites e hooks | SBOM/atestação, SCA/licenças e segurança do ambiente de produção exigem controles adicionais |

## Evidências reproduzíveis

- Sentinela: 73 testes unitários/hooks e 21 de integração PostgreSQL aprovados, além de tipagem.
- issue-to-pr-ai: 179 testes de scripts/contratos/hooks, dois testes unitários Java, 82 de integração PostgreSQL e `make check` aprovados.
- Teste conjunto: `ISSUE_TO_PR_AI_DIR=/caminho/issue-to-pr-ai npm run test:e2e:sdlc`. O relatório gerado é `test-results/sdlc-integration-report.json`; a CI usa o commit par fixado em `config/sdlc-peer.json`.
- Reais: Java/HTTP, PostgreSQL, Prometheus, worker, MCP, wrapper governado, Maven, regressão e substituição de containers.
- Controlados: API do GitHub, resposta do agente, decisão de merge e proxy que congela respostas do Prometheus. Não houve chamada comercial de IA nem alteração de produção.

Para repetir, siga o [guia de integração](sdlc-integration.md). O relatório de CI deve ser conferido para os commits efetivamente avaliados. O artigo é uma descrição dessa referência e de seus testes, sem promessa de ausência de defeitos.

Correções em revisão: [Sentinela #4](https://github.com/lucasnscr/sentinela/pull/4) e [issue-to-pr-ai #54](https://github.com/lucasnscr/issue-to-pr-ai/pull/54). O teste local ampliado completou as sete etapas, incluindo callback perdido e telemetria saudável congelada.

## Referências e interpretação

O [playbook da Anthropic](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) sugere conectar fases por artefatos e gates; usamos essa lente para mapear entradas, saídas e decisões. O [ADLC da LangChain](https://www.langchain.com/blog/the-agent-development-lifecycle) destaca testar e observar o comportamento dos agentes; isso motivou distinguir testes do catálogo e avaliação do agente. A [análise da Endor Labs](https://www.endorlabs.com/learn/what-is-the-ai-native-sdlc) inclui os riscos das ações dos agentes e do software produzido; por isso limites de ferramentas e supply chain aparecem separadamente na auditoria.

A [documentação de timestamp do Prometheus](https://prometheus.io/docs/prometheus/latest/querying/functions/#timestamp) fundamenta o uso da hora da amostra. A [documentação de staleness](https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness) explica por que consultar novamente uma série não comprova uma observação nova.
