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

## Fase 5 — infraestrutura GitHub em validação

- Consumidor do workflow compartilhado fixado em 42f22ec8e8c0e6f51f82ddb189e5203b35a5d94c, também usado pelo entrypoint local.
- Autorização hospedada, geração em runner efêmero, patch congelado e regressão hospedada antes da publicação.
- Publicação local após validação, preservando a restrição existente de Actions. Credencial gh permanece no host e não entra no modelo ou no código candidato.
- CI aceita disparo manual. O recibo de publicação exige PR e patch correspondentes, evitando sucesso falso quando o publisher estiver offline.
- Flags permanecem desabilitadas até integração da infraestrutura. Pilotos reais e descarte precisam passar antes de declarar a fase concluída.
