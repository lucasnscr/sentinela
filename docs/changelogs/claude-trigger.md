# Gatilho Claude Code no Sentinela

## 29 de outubro de 2026

- Adicionado @claude em issue aberta com ai:ready e solicitante humano com escrita. AI_ENABLED e CLAUDE_ENABLED habilitam o caminho; LOCAL_AI_ENABLED continua controlando /oc.
- Workflow fino fixa engine/modelo revisados e usa ANTHROPIC_API_KEY somente na geração. Diagnóstico e embeddings permanecem independentes.
- Aplicado o perfil sentinela-typescript, com instruções do alvo e edição sem shell. Patch e consumo são congelados antes dos testes independentes.
- Preservada a restrição de Actions para criação/aprovação de PR. O publisher local reconhece Claude e publica sem usar VM ou Ollama; o agente não recebe sua credencial.
- Acrescentada regressão da seleção de workflows, flags, segredo explícito e vínculo de SHA do engine.

Guia: [implementação por agentes](../implementation-local.md). Esta tarefa possui autorização explícita do mantenedor para merge após revisão e regressões aprovadas; o produto continua entregando PR draft.

Validação local aprovada: check TypeScript, 84 testes unitários/hook, 40 testes de integração PostgreSQL/pgvector, build, três cenários E2E de provedores e operação Kubernetes/Azure Functions. O ciclo SDLC integrado passou sete estágios, incluindo segunda tentativa, resultados de desenvolvimento, recuperação após rollback e aprendizado revisado. As respostas dos agentes e os provedores operacionais dos E2Es são controlados; isso não comprova uma nova inferência Anthropic nem acesso a clusters de produção.

Engine revisado: d9eb1c46ef805343bd756ea445f7065b82877964 (issue-to-pr-ai #93). A versão imutável do engine é registrada em config/implementation.json e config/sdlc-peer.json; ambos os callers devem referenciar esse mesmo commit revisado.
