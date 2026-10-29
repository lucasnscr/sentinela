# Integração de desenvolvimento com OpenCode e Ollama

## Fase 4 — infraestrutura local validada em 29/10/2026

- Entrypoint local com engine compartilhado por commit imutável e destino restrito ao Sentinela.
- Configuração OpenCode para uso interativo; fluxo controlado utiliza ambiente próprio sem herdar configurações pessoais.
- Perfil TypeScript e relatórios externos ao candidato, implementados no engine.
- Testes de configuração do entrypoint rejeitam branch mutável, outro repositório e outro perfil.
- Regressão da infraestrutura: 79 testes unitários, 40 PostgreSQL/pgvector, check e build aprovados. E2E de provider (três cenários) e operações Kubernetes/Azure Functions aprovados com serviços controlados.
- O primeiro piloto Qwen compilou e passou nos testes unitários, mas a regressão encontrou uma fixture SDLC dependente de 1 ms. A fixture foi corrigida nesta implementação, fora do patch do piloto Qwen para persistir a data antiga diretamente no banco, mantendo as asserções e sem alterar comportamento de produção.
- Piloto será repetido sobre a base corrigida; automação GitHub permanece desabilitada. Esta PR prepara o perfil/entrypoint e a base determinística.
