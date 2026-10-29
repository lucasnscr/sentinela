# Integração de desenvolvimento com OpenCode e Ollama

## Fase 4 — infraestrutura local validada em 29/10/2026

- Entrypoint local com engine compartilhado por commit imutável e destino restrito ao Sentinela.
- Configuração OpenCode para uso interativo; fluxo controlado utiliza ambiente próprio sem herdar configurações pessoais.
- Perfil TypeScript e relatórios externos ao candidato, implementados no engine.
- Testes de configuração do entrypoint rejeitam branch mutável, outro repositório e outro perfil.
- Regressão da infraestrutura: 79 testes unitários, 40 PostgreSQL/pgvector, check e build aprovados. E2E de provider (três cenários) e operações Kubernetes/Azure Functions aprovados com serviços controlados.
- O primeiro piloto Qwen compilou e passou nos testes unitários, mas a regressão encontrou uma fixture SDLC dependente de 1 ms. A fixture foi corrigida nesta implementação, fora do patch do piloto Qwen para persistir a data antiga diretamente no banco, mantendo as asserções e sem alterar comportamento de produção.
- Piloto repetido com Qwen real em #18 e integrado após regressão: 80 testes unitários, 40 PostgreSQL/pgvector, check, build e E2E de provider/operações. Dez etapas e 101.726 unidades de política. O código e os testes foram produzidos pelo Qwen; houve somente ajuste editorial de uma tabela Markdown pelo mantenedor.
- Aceitação independente de 18 verificações passou no candidato e falhou na base anterior. CI conjunta dos repositórios também passou. O novo comportamento rejeita timeouts explícitos inválidos, preservando os valores padrão quando ausentes.

## Fase 5 — consumidor GitHub validado em 29/10/2026

- Consumidor do workflow compartilhado fixado em 42f22ec8e8c0e6f51f82ddb189e5203b35a5d94c, também usado pelo entrypoint local.
- Autorização hospedada, geração em runner efêmero, patch congelado e regressão hospedada antes da publicação.
- Publicação local após validação, preservando a restrição existente de Actions. Credencial gh permanece no host e não entra no modelo ou no código candidato.
- CI aceita disparo manual. O recibo de publicação exige PR e patch correspondentes, evitando sucesso falso quando o publisher estiver offline.
- Infraestrutura #20 integrada após CI normal e conjunta. AI_ENABLED e LOCAL_AI_ENABLED ativados explicitamente, preservando a restrição de Actions sobre criação/aprovação de PRs.
- Piloto real #21 → PR #23: [run 40932140979](https://github.com/lucasnscr/sentinela/actions/runs/40932140979), tentativa 3. Qwen real, 179 segundos, 20 etapas, 285.436 unidades de política; artefato congelado, validação hospedada e recibo do publisher local passaram. VM e registro do runner foram removidos.
- Tentativa 1 cancelada deliberadamente durante geração: sem PR e com descarte confirmado. Tentativa 2 bloqueada por strictNullChecks em um teste gerado; sem publicação. O erro foi devolvido aos critérios, sem desabilitar o compilador.
- Revisão de #23 encontrou testes duplicados e a comparação de identidade ausente. Commit de revisão d9ad036 acrescentou identity/embeddingSpace e restaurou documentação de AI_MODE. Essa intervenção em testes/documentação foi feita pelo mantenedor/Codex; o código de produção permaneceu o patch Qwen 81fe135. CI final normal e conjunta aprovadas antes do merge.
- Engine, caller e peer SDLC agora usam 55b1b6cd2aaefa6ddb94ba8144f803f37f053664. A correção compartilhada de descarte após reinício é revisada na [PR do engine #90](https://github.com/lucasnscr/issue-to-pr-ai/pull/90); seu changelog registra o teste negativo e a reconciliação remota.

## Fase 6 — ciclo operacional validado em laboratório em 29/10/2026

- Novo piloto optativo com GitHub e Qwen reais, sem expor callbacks públicos. Exige --enable-real-github antes de iniciar banco/Docker/publicação; não faz merge nem adiciona ai:ready.
- Sentinela detectou HTTP 503 do ingresso sintético e publicou [issue #85](https://github.com/lucasnscr/issue-to-pr-ai/issues/85) sem autorização automática. Após revisão, o workflow Qwen abriu [PR #87](https://github.com/lucasnscr/issue-to-pr-ai/pull/87), passou na CI e foi integrado por decisão do mantenedor.
- SHA implantado: 6b6e1e9b5285a9939149d91942c4479c60ac2789; digest Docker sha256:25e28fe7b873ccb6b03cd93335b7a455ce26d3c3d92171d1a8c3b9acba4842f1. Recuperação verificada com 6 amostras novas, probes de negócio/dados e 5.005 ms de estabilidade.
- Proveniência: run 40931294568, tentativa 2, Qwen em 47 segundos/18 etapas/196.677 unidades de política. Primeira execução bloqueada por HTTP 502 do Maven Central. Uma fixture antiga do gate falhava em reruns; correção isolada no engine #88 teve reprodução vermelha/verde, sem mudar a aplicação Qwen.
- O laboratório foi interrompido durante a pausa da sessão e retomado com o mesmo caso/issue do PostgreSQL. O checkpoint não guarda credenciais. A árvore final foi conferida como o patch congelado aplicado à base atualizada; nenhuma mudança de aplicação adicional foi introduzida pelo mantenedor.
- Escopo real: GitHub, modelo, CI, revisão/merge, Java HTTP, PostgreSQL, troca Docker, callbacks e probes. Controlado: política sintética de ingresso e adaptador do protocolo Prometheus calculado por probes HTTP, com saturação fixada em zero. Diagnóstico por regras. Não valida produção, Kubernetes ou Azure reais.
- Regressão final: check e 83 testes unitários; 40 integrações PostgreSQL/pgvector; build; suíte conjunta SDLC aprovada contra os dois checkouts. A suíte conjunta usa GitHub/agente controlados e cobre CI falha/retoma, PR encerrada, tentativas sucessivas, métricas congeladas, dados errados, rollback saudável/degradado e aprendizado revisado com teste vermelho/verde.
- Documentação do piloto em real-local-ai-pilot.md; guia interativo e exportação portátil mantidos no engine. Relatórios brutos ficam fora do Git em test-results.
