# Implementar issues do Sentinela com modelo local

O diagnóstico operacional e o agente que altera código têm configurações separadas. AI_PROVIDER=ollama habilita diagnóstico; não inicia uma implementação. O fluxo de desenvolvimento usa OpenCode, Qwen e um engine do issue-to-pr-ai fixado por commit em config/implementation.json.

Requisitos: Node 24, Git/GitHub CLI autenticada com permissão de escrita e uma VM Lima dedicada sentinela-ai-pilot, sem montagem do home ou encaminhamento de SSH agent. Prepare o laboratório conforme o [runbook do engine](https://github.com/lucasnscr/issue-to-pr-ai/blob/main/docs/runbooks/local-issue-delivery.md). O Ollama fica no Mac; a inferência é alcançada pelo proxy de loopback da VM. Não é um endpoint público.

1. Escreva critérios de aceite claros na issue aberta.
2. Um mantenedor adiciona ai:ready.
3. Execute:

```sh
npm run implement:issue -- --issue=NUMERO
```

O entrypoint baixa o engine público pelo SHA revisado, verifica o checkout e invoca seu controlador. O controlador revalida issue, base e permissão, usa o perfil sentinela-typescript e publica uma PR draft somente após validação. O modelo não recebe token de publicação nem acesso ao home do host.

O perfil permite app, lib, worker, testes e documentação Markdown. Bloqueia lib/db.ts, contratos, dependências, workflows e configurações de agente. Uma tarefa de migration/infraestrutura exige perfil e escopo revisados separadamente; o perfil inicial não autoriza editar o esquema SQL legado.

Antes do modelo, as dependências da base são instaladas sem scripts para disponibilizar os guias Next.js locais. O modelo deve ler AGENTS.md e a documentação aplicável em node_modules/next/dist/docs. Ele edita sem comandos. Depois, um validador separado executa check, unidade, PostgreSQL/pgvector temporário, build e E2E de providers/operações. Alterações SDLC também precisam do teste conjunto dos repositórios.

Relatórios do modelo ficam fora do checkout candidato e o resumo final é copiado para test-results, que não é versionado. Nenhuma chave do diagnóstico é carregada do .env.local para o processo de implementação. Configurar o OpenCode interativo no host não equivale ao isolamento deste fluxo.

Falha ou revogação de autorização interrompe a entrega. Publicação, revisão, merge, deploy e verificação de recuperação continuam sendo etapas distintas.

## Entrega pelo GitHub

O workflow AI implementation usa o mesmo SHA revisado do engine. Um comentário /oc em issue aberta com ai:ready é aceito somente de colaborador com escrita, com AI_ENABLED e LOCAL_AI_ENABLED habilitados. O provider local deve estar online, conforme o [runbook de runners descartáveis](https://github.com/lucasnscr/issue-to-pr-ai/blob/main/docs/runbooks/github-local-runner.md).

A geração acontece em VM Linux descartável sem home montado. O patch é congelado antes da validação em runner hospedado. O Sentinela mantém a restrição existente que impede Actions de criar/aprovar PRs: após os testes, um publisher local confere a identidade do workflow e publica com a sessão gh do operador, sem executar o candidato no host. Um recibo hospedado exige a PR correspondente; falha de publicação não é classificada como conclusão.

O diagnóstico operacional continua independente. Não configure o endpoint de diagnóstico para o gateway efêmero da implementação. A fila inicial aceita uma inferência de implementação por vez. Esta infraestrutura permanece desativada até o merge e a execução dos pilotos GitHub; consulte o changelog para evidências reais.
