# Piloto integrado com GitHub e Qwen reais

Este teste optativo cria uma issue pública no issue-to-pr-ai. Exige os dois repositórios, Docker, PostgreSQL/pgvector temporário, GitHub CLI autenticada e o provider efêmero preparado. Não execute com banco ou aplicações de produção.

```sh
export DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:PORTA/BANCO_DE_TESTE
export ISSUE_TO_PR_AI_DIR=/caminho/issue-to-pr-ai
export PILOT_BASE_SHA=SHA_REVISADO_DE_40_CARACTERES
node --import tsx scripts/sdlc-real-pilot.ts --enable-real-github
```

A base precisa ser uma versão anterior à correção nosniff. O teste prepara um catálogo Java com PostgreSQL em containers próprios, sem modificar o código da base. Um ingresso sintético devolve 503 quando a resposta categories não tem X-Content-Type-Options: nosniff. Um adaptador no protocolo Prometheus calcula erro, latência, tráfego e horário a partir de probes HTTP reais; saturação é fixada em zero. Isso não valida um servidor Prometheus ou capacidade de infraestrutura.

O worker detecta a falha, investiga por regras e publica uma proposta revisada como issue real, sem ai:ready. O mantenedor revisa os critérios, adiciona a label e comenta /oc. O provider gera o patch em VM descartável; o GitHub valida e publica a PR draft. O piloto exige proveniência do workflow, manifesto, hash, modelo e uso completos antes de registrar sucesso do modelo.

Após CI verde, o callback local sincroniza a PR. O teste aguarda revisão e merge do mantenedor; não faz merge, não aprova PR nem habilita flags. Depois constrói o SHA integrado, implanta a imagem por Docker e envia callbacks reais à API local. A recuperação exige três novas amostras, negócio/dados e cinco segundos de estabilidade. Se falhar, o adaptador de entrega tenta o rollback e verifica a saúde separadamente; a versão antiga continua incompatível com a política sintética e pode exigir escalonamento.

O publisher confiável do Sentinela recebe a sessão gh somente em memória. A credencial não é escrita, exibida ou enviada ao modelo/candidato. O broker usa loopback; não instala túnel nem expõe callbacks públicos. Os limites da credencial existente não são reduzidos pelo programa: produção exige identidade de serviço de menor privilégio.

Os relatórios ficam em test-results e não são versionados. Há prazo de uma hora por espera de PR/merge. A execução normal encerra processos próprios, containers, rede, imagens e banco temporário. Uma interrupção abrupta do processo pode deixar o laboratório ativo. O checkpoint real-pilot-pending.json guarda somente identidades, portas e diretório público de teste; não guarda credenciais.

Para retomar o mesmo caso após interrupção abrupta, mantenha o checkpoint e os recursos próprios e acrescente --resume ao comando. O piloto reabre o mesmo banco e portas, confere os recursos, não publica outra issue e verifica novamente workflow, artefato e árvore final do código. Uma atualização revisada da base é aceita somente se a árvore final continuar sendo o patch congelado aplicado à nova base. As credenciais locais são recriadas em memória. Falha na retomada preserva os containers e o banco para conferência; sucesso remove os recursos temporários.

Execute também npm run test:e2e:sdlc. Essa suíte preserva cenários negativos e aprendizado revisado, mas controla GitHub e a resposta do agente. O relatório distingue as duas trilhas.
