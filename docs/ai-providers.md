# Provedores e modelos de IA

O monitoramento e o grafo de investigação não dependem de um fornecedor de modelos. A aplicação utiliza dois contratos separados: ModelProvider para geração estruturada e EmbeddingProvider para vetorização. Os adaptadores HTTP ficam em lib/ai/providers.ts. A validação de evidências e a revisão de ações permanecem fora dos adaptadores.

## Configuração

As variáveis são lidas no início dos processos. Reinicie a interface e o worker após alterar a configuração. Não é necessário modificar código para trocar entre os adaptadores existentes.

| Função | Variáveis |
| --- | --- |
| Diagnóstico | AI_PROVIDER, AI_MODEL, AI_BASE_URL, AI_API_KEY_ENV, AI_TIMEOUT_MS, AI_RESPONSE_FORMAT |
| Embeddings | EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY_ENV, EMBEDDING_DIMENSIONS |

AI_RESPONSE_FORMAT é uma configuração exclusiva do diagnóstico e não afeta a configuração de embeddings. Valores válidos são: json_schema, json_object ou prompt.

AI_TIMEOUT_MS e EMBEDDING_TIMEOUT_MS devem ser valores inteiros entre 100 e 300000 ms. Valores omitidos usam 30000 ms para diagnóstico e 20000 ms para embeddings. Valores inválidos resultam em erro de configuração, em vez de substituição silenciosa dos valores.

AI_API_KEY e EMBEDDING_API_KEY também podem ser fornecidas pelo ambiente do servidor. AI_API_KEY_ENV e EMBEDDING_API_KEY_ENV permitem indicar o nome de uma variável de credencial já provisionada. As chaves nunca são enviadas no snapshot da interface.

| Adaptador | Diagnóstico | Embeddings | Endpoint padrão | Credencial padrão |
| --- | --- | --- | --- | --- |
| none | Regras de evidência | Busca lexical | Nenhum | Nenhuma |
| openai | Responses API | API de embeddings | https://api.openai.com/v1 | OPENAI_API_KEY |
| openai-compatible | Chat Completions | API compatível de embeddings | AI_BASE_URL ou EMBEDDING_BASE_URL obrigatório | AI_API_KEY; embeddings usam credencial própria |
| anthropic | Messages API | Não implementado por este adaptador | https://api.anthropic.com/v1 | ANTHROPIC_API_KEY |
| google | GenerateContent | BatchEmbedContents | https://generativelanguage.googleapis.com/v1beta | GEMINI_API_KEY |
| ollama | API nativa de chat | API nativa de embeddings | http://127.0.0.1:11434 | Opcional |

Para uma configuração nova, escolha explicitamente o provedor e o identificador de um modelo disponível no serviço. A configuração de diagnóstico não habilita implicitamente outro provedor de embeddings.

## Exemplos

Substitua os identificadores pelos modelos que você tem disponíveis. Nenhum modelo é baixado automaticamente.

Diagnóstico local com Ollama e busca lexical:

    AI_PROVIDER=ollama
    AI_MODEL=identificador-do-modelo-local
    EMBEDDING_PROVIDER=none

Diagnóstico Anthropic com embeddings locais:

    AI_PROVIDER=anthropic
    AI_MODEL=identificador-do-modelo-habilitado
    AI_API_KEY_ENV=ANTHROPIC_API_KEY
    EMBEDDING_PROVIDER=ollama
    EMBEDDING_MODEL=identificador-do-modelo-de-embeddings

Servidor compatível, como um endpoint de inferência próprio:

    AI_PROVIDER=openai-compatible
    AI_MODEL=identificador-do-modelo-servido
    AI_BASE_URL=http://127.0.0.1:8000/v1
    AI_RESPONSE_FORMAT=json_schema
    EMBEDDING_PROVIDER=none

Se o servidor compatível não aceitar JSON Schema, selecione json_object ou prompt explicitamente. O schema continua sendo validado com Zod após a resposta. Uma resposta inválida ou truncada não vira diagnóstico válido. A aplicação não repete automaticamente uma chamada em outro formato ou fornecedor.

## Embeddings e migração

EMBEDDING_DIMENSIONS é opcional; quando omitida, o adaptador usa a dimensão retornada pelo modelo. Quando configurada, a dimensão é enviada ao provedor e conferida na resposta. O modelo e o servidor devem suportar a dimensão escolhida.

Cada vetor é identificado pelo adaptador, endpoint, modelo, dimensão configurada e EMBEDDING_REVISION. O banco permite diferentes dimensões, e a busca só compara vetores do mesmo espaço e da mesma dimensão. Dois modelos com 768 dimensões não são considerados compatíveis apenas por terem o mesmo tamanho.

Ao trocar o modelo de embeddings, os runbooks são reindexados em lotes. Enquanto isso, continuam pesquisáveis por texto. Vetores legados sem procedência permanecem preservados, mas não são usados na busca semântica até a reindexação. A migração do antigo vector(1536) não remove documentos ou incidentes.

Trocar apenas o modelo de diagnóstico não exige reindexar os runbooks. Rotacionar uma credencial também não altera o espaço vetorial.

## Disponibilidade e testes

Os circuitos de falha são separados por função, adaptador, endpoint, modelo e credencial. Uma falha em embeddings não bloqueia o diagnóstico. Uma falha na OpenAI não bloqueia Anthropic, Gemini, Ollama ou um servidor compatível.

Conexões apresenta um cartão de diagnóstico e outro de embeddings. Cada botão Testar conexão executa uma chamada curta somente para aquela função e libera somente seu circuito quando o teste passa. O teste de embeddings também inicia a indexação pendente.

    npm run test:ai
    npm run test:ai -- --embedding

Esses dois comandos usam o provedor configurado e fazem chamadas reais. Os testes unitários dos adaptadores usam respostas controladas, sem inferência paga. Credenciais e acesso aos modelos dos serviços externos precisam ser validados no ambiente de destino.

O comando npm run test:e2e:provider executa o grafo completo com um servidor local que simula o protocolo Ollama, incluindo os três cenários e embeddings de três dimensões, em banco temporário. Isso valida o contrato e a independência do núcleo; não certifica a qualidade de inferência de um modelo nem o acesso a contas externas.

Sem configuração, com AI_PROVIDER=none ou com AI_MODE=rules, o investigador usa regras de evidência. Embeddings desativados ou indisponíveis mantêm a busca lexical. Os incidentes registram o modo efetivamente usado; diagnósticos produzidos por modelos também registram o provedor e o modelo, sem relabelar o histórico ao trocar a configuração.

## Compatibilidade e extensão

A instalação anterior, configurada somente com OPENAI_API_KEY, continua funcionando com os aliases OPENAI_MODEL e OPENAI_EMBEDDING_MODEL e os padrões anteriores. Essa compatibilidade não sobrescreve uma seleção explícita em AI_PROVIDER ou EMBEDDING_PROVIDER. A chave local existente não precisa ser regravada.

Os contratos e configurações ficam em lib/ai/types.ts e lib/ai/configuration.ts. Para adicionar um protocolo, implemente o adaptador e registre seus metadados nesses módulos. Não é necessário alterar o grafo LangGraph, os contratos MCP ou o fluxo de aprovação.

## Referências

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Anthropic Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Gemini GenerateContent: https://ai.google.dev/api/generate-content
- Gemini embeddings: https://ai.google.dev/api/embeddings
- Ollama chat: https://docs.ollama.com/api/chat
- Ollama embeddings: https://docs.ollama.com/api/embed
