# AI SDLC com autonomia supervisionada: da issue à recuperação verificada

Como conectei agentes de implementação e operação em um ciclo rastreável, testei suas falhas e defini os limites da automação.

Um agente abre uma pull request. A CI passa. A mudança é integrada. Alguns minutos depois, a aplicação começa a devolver HTTP 503.

Para o fluxo de desenvolvimento, o trabalho pode parecer encerrado. Para quem usa a aplicação, o problema está começando. Foi essa distância entre entregar código e recuperar um serviço que procurei reduzir ao conectar dois projetos: [issue-to-pr-ai](https://github.com/lucasnscr/issue-to-pr-ai) e [Sentinela](https://github.com/lucasnscr/sentinela).

O primeiro organiza o trabalho de agentes a partir de uma issue: contexto, autorização, implementação, validação, revisão e PR. O segundo observa a aplicação, investiga incidentes e acompanha o efeito das ações operacionais. A integração conserva a identidade da mudança entre os dois lados e exige evidência após a entrega.

O resultado é uma referência executável de autonomia supervisionada. A detecção é ativa, a execução tem limites e as decisões de implementação, merge e entrega permanecem com o mantenedor. Esse é o nível de autonomia demonstrado neste projeto.

## Três referências para olhar além da geração de código

O [AI-native SDLC playbook da Anthropic](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) propõe conectar planejamento, design, construção, testes, entrega e manutenção por artefatos que a etapa seguinte consegue consumir. Usei essa ideia para examinar as passagens entre incidente, issue, PR e deploy.

O [Agent Development Lifecycle da LangChain](https://www.langchain.com/blog/the-agent-development-lifecycle) trata de construir, testar, implantar e monitorar os próprios agentes, alimentando novas avaliações com o que se aprende. Essa perspectiva acrescenta uma pergunta ao teste do produto: o agente respeitou contexto, ferramentas e política?

A [discussão da Endor Labs sobre AI-native SDLC](https://www.endorlabs.com/learn/what-is-the-ai-native-sdlc) chama atenção para o software produzido e para as ações realizadas pelos agentes. Isso ajuda a avaliar permissões, execução e dependências separadamente da qualidade aparente do código.

As três leituras serviram como critérios para a implementação e para a auditoria descrita a seguir. Elas também ajudam a reconhecer o que ainda precisa evoluir.

## Dois projetos, um histórico de correção

No issue-to-pr-ai, a aplicação de referência é um catálogo Java com Spring Boot e PostgreSQL. O método em volta dela inclui critérios de aceite, instruções versionadas, seleção de skills, agentes governados e validação independente. Uma issue só inicia implementação depois dos gates de colaborador autorizado, estado aberto e label de autorização.

O Sentinela usa Next.js e TypeScript na aplicação, PostgreSQL no estado persistido, LangGraph na investigação e MCP nas ferramentas de coleta. O diagnóstico suporta diferentes provedores e modelos; há também um modo por regras. Detecção, política e verificação operacional têm caminhos determinísticos.

Uma conclusão do diagnóstico é uma hipótese sustentada por evidências. A confirmação da recuperação depende de observações da aplicação. Essa distinção orienta a integração inteira.

O caminho implementado é:

Incidente → proposta revisada → issue autorizada → implementação e PR → CI → decisão de merge e entrega → verificação operacional → correção confirmada ou rollback.

Há papéis diferentes em cada passagem. O monitor reúne os sinais; o operador seleciona o que pode sair do ambiente e revisa a proposta; o agente implementa dentro do escopo; os validadores executam os testes; o mantenedor decide a liberação; o Sentinela observa o resultado.

## A identidade precisa sobreviver ao deploy

O contrato compartilhado, `sentinela-sdlc/v1`, vincula caso, incidente, repositório, serviço, ambiente, hash da proposta, issue, PR, SHA, digest do artefato e identificador da entrega.

Esses campos têm consequências práticas. Revisar o texto muda o hash da proposta e invalida uma autorização antiga. Repetir o mesmo evento preserva a operação. Reutilizar seu identificador com outro conteúdo é recusado. Uma resposta sobre outro deploy não libera a mudança atual.

O SHA do head da PR e o commit integrado são registrados separadamente. Um merge pode produzir outro SHA; a entrega confere que o commit implantado contém a correção. O digest conserva a identidade do artefato entregue.

As credenciais também seguem os papéis. O token do operador autoriza comandos operacionais; a credencial do worker publica issues; o segredo de callback pertence ao pipeline confiável. O agente de implementação não recebe poderes de produção por causa de um texto de incidente.

A issue publicada pelo Sentinela chega sem `ai:ready` e sem comando que inicia um agente. O mantenedor faz essa decisão no fluxo normal do repositório.

## A auditoria encontrou falhas que uma CI verde não mostrava

Uma segunda revisão da integração encontrou situações capazes de comprometer a conclusão do ciclo. Transformei os casos em regressões antes de corrigir o código.

A primeira falha estava no relógio. O coletor atribuía a hora da consulta aos valores devolvidos pelo Prometheus. Consultar novamente uma série antiga podia fazê-la parecer recente. A correção preserva a hora do scrape em uma recording rule, condicionada ao sucesso da coleta. As regras e o coletor também passaram a conservar a dimensão de ambiente.

Essa escolha usa a função [`timestamp()` do Prometheus](https://prometheus.io/docs/prometheus/latest/querying/functions/#timestamp). A [documentação sobre staleness](https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness) ajuda a entender por que repetir uma consulta não comprova uma observação nova.

Também corrigi a aceitação de dados futuros, a manutenção indevida da sequência saudável quando faltavam dados e a possibilidade de uma terceira amostra vencer um prazo já expirado. A verificação passou a exigir três observações saudáveis, distintas, do ambiente esperado, posteriores à conclusão do deploy e recebidas dentro do prazo. Dados ausentes ou inválidos interrompem a sequência.

Outra falha era de sequência: o merge podia acontecer antes da chegada do callback da CI. Nesse caso, a entrega ficava sem vínculo com a PR. O publisher autorizado agora reconcilia esse vínculo antes de iniciar.

Por fim, tratei a perda de uma resposta de conclusão. Se o pipeline decide reverter e confirma o rollback da mesma entrega, o Sentinela revoga eventual estado de correção verificada. O histórico passa a refletir a reversão efetivamente informada.

## Como exercitei os dois lados

O teste integrado cria recursos temporários, introduz uma regressão HTTP 503 no catálogo e gera tráfego. PostgreSQL, Java, Prometheus, worker e MCP executam de verdade.

O Sentinela detecta o incidente. O teste prepara uma proposta revisada e publica uma única issue em uma API GitHub controlada. Os gates recusam implementação antes da autorização simulada. Depois, o wrapper governado recebe uma resposta controlada de agente.

Um teste de regressão falha contra o código defeituoso. Após a correção, Maven executa a validação completa com PostgreSQL. O fluxo constrói uma imagem, substitui o container e aguarda a confirmação independente da recuperação. O SHA integrado é diferente do head da PR.

O teste inclui duas situações adicionais: uma entrega defeituosa exige rollback; respostas saudáveis congeladas do Prometheus não conseguem confirmar uma nova entrega. Também exercita a recuperação do callback perdido antes do merge.

Os limites desse experimento são explícitos: API do GitHub, resposta do agente, decisão de merge e congelamento das respostas de telemetria são controlados. A aplicação, seus bancos, as métricas, o wrapper, os testes e a substituição dos containers são reais. Essa execução não mede a capacidade de um modelo comercial nem certifica um ambiente de produção.

O comando reproduzível, no checkout do Sentinela, é `ISSUE_TO_PR_AI_DIR=/caminho/issue-to-pr-ai npm run test:e2e:sdlc`. A CI fixa o commit do projeto par e guarda um relatório agregado da execução.

## O significado de autonomia aqui

O piloto de entrega Kubernetes usa imagem por digest, job protegido e precondições de identidade, versão e imagem esperada. Um alvo alterado concorrentemente interrompe a operação. O rollback busca restaurar a imagem anterior dentro desses mesmos limites.

No teste conjunto, a troca de artefatos usa Docker local. O adaptador Kubernetes tem testes de contrato; sua adoção em um cluster exige validar identidade, rede, registry e políticas. Azure Functions possui observação e ajustes testados com respostas controladas; a entrega exercitada neste laboratório usa Docker.

Um hook nos dois repositórios também limita arquivos mantidos a 5.000 tokens estimados, calculados por bytes divididos por quatro. Ele examina apenas o conteúdo staged, exclui lockfiles e codegen e orienta a divisão por responsabilidade. Esse é um controle de manutenção dentro de um conjunto maior de controles de execução.

Ainda há evolução a fazer: transformar incidentes reais em datasets de avaliação revisados, ampliar os casos por modelo e ferramenta, definir metas de qualidade, completar os controles de supply chain e validar cada destino operacional. O benchmark existente do revisor tem alcance limitado.

A próxima decisão de adoção é escolher um serviço e um ambiente, definir sinais de recuperação e ensaiar a falha e a reversão. Os resultados desse ambiente devem orientar qualquer aumento de autonomia. No projeto apresentado aqui, cada passagem do ciclo deixa um artefato ou um evento que permite conferir o que foi autorizado, executado e observado.

As correções da auditoria inicial foram integradas pelas PRs [Sentinela #4](https://github.com/lucasnscr/sentinela/pull/4) e [issue-to-pr-ai #54](https://github.com/lucasnscr/issue-to-pr-ai/pull/54). Os resultados de cada ampliação posterior estão nos changelogs dos dois repositórios.

*Nota de acesso: os dois repositórios são públicos. A auditoria inicial foi realizada em 26 de outubro de 2026; a ampliação com inferência local descrita abaixo foi validada em 29 de outubro de 2026.*

## O que mudou com OpenCode, Qwen e Ollama

A implementação deixou de depender de um único provedor. O engine usa uma política explícita de modelos e o primeiro modelo local avaliado foi qwen3-coder:30b, com OpenCode 1.19.3 e contexto efetivo de 64 mil tokens. Diagnóstico operacional e embeddings continuam com configurações independentes. O monitoramento pode usar regras enquanto a implementação ocupa o modelo local.

O GitHub autoriza a issue antes de liberar uma VM descartável. O modelo edita sem comandos e sem token de publicação; o patch e o uso são congelados antes da execução do candidato. Outro runner faz a regressão, e um publisher revalida autorização, base e hash antes de abrir uma PR draft. No Sentinela, a publicação local preserva a restrição existente de Actions. O agente não aprova nem integra sua própria PR.

No piloto real, o Sentinela detectou uma falha sintética de ingresso e publicou a [issue #85](https://github.com/lucasnscr/issue-to-pr-ai/issues/85). Após revisão, o Qwen gerou a correção que chegou à [PR #87](https://github.com/lucasnscr/issue-to-pr-ai/pull/87): 47 segundos, 18 etapas e 196.677 unidades de política. CI e revisão precederam o merge. O laboratório implantou o SHA integrado e confirmou seis amostras saudáveis, dados de referência corretos e 5.005 ms de estabilidade.

Também houve entrega no próprio Sentinela pela [PR #23](https://github.com/lucasnscr/sentinela/pull/23). A execução do modelo terminou em 179 segundos, com 20 etapas e 285.436 unidades de política. A revisão encontrou testes duplicados e uma verificação de identidade ausente; um commit separado do mantenedor corrigiu testes/documentação. O código de produção permaneceu o patch Qwen. Esse registro importa: CI verde e uma resposta concluída do modelo não substituem revisão.

As tentativas que falharam ficaram bloqueadas. Um HTTP 502 do Maven Central interrompeu a primeira validação Java; o compilador rejeitou um teste TypeScript com acesso possivelmente nulo. Cancelamento e reinício de VM também foram ensaiados. O reinício revelou um problema na ordem de descarte, tratado em uma correção própria do engine. Nenhuma dessas tentativas foi apresentada como entrega bem-sucedida.

A trilha com modelo/GitHub reais é diferente da suíte determinística, que controla GitHub e a resposta do agente para repetir falhas de CI, eventos antigos, PR encerrada, rollback, novas tentativas e aprendizado. No piloto operacional real, o ingresso e o adaptador de métricas são controlados; Java, PostgreSQL, GitHub, modelo, CI, deploy Docker e verificação são reais. Isso comprova a referência nesse laboratório e não certifica escala ou conformidade de produção.

O [guia interativo exportável](https://github.com/lucasnscr/issue-to-pr-ai/tree/main/docs/product) e os changelogs permitem consultar responsáveis, condições de avanço, falhas, ambientes e evidências sem confundir essas trilhas.
