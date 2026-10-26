# Limite dos arquivos no commit

O hook local verifica somente arquivos adicionados, modificados ou renomeados no índice do Git. Usa o blob staged, mesmo quando o arquivo de trabalho tem outro conteúdo. O limite é de 20.000 bytes: tokens estimados = bytes / 4, com máximo de 5.000 tokens por arquivo. Exatamente 20.000 bytes são permitidos.

Instale em cada checkout:

```sh
node scripts/install-git-hooks.mjs
```

A instalação configura somente `core.hooksPath` deste repositório. Se outro caminho de hooks já estiver configurado, o instalador pede integração com o hook existente e não o substitui.

Lockfiles conhecidos, nomes/diretórios de codegen e arquivos marcados com `linguist-generated=true` ou `generated=true` em uma `.gitattributes` staged ficam fora do limite. Git não identifica de forma confiável qual ferramenta escreveu um arquivo: todos os demais arquivos mantidos são verificados, independentemente do autor do commit.

Para declarar saída de um gerador:

```gitattributes
path/to/codegen/** linguist-generated=true
```

Não marque código mantido como gerado para contornar o limite. Quando o hook bloquear um arquivo, extraia componentes, serviços, schemas, estilos ou suites de teste por responsabilidade; mantenha um ponto de entrada pequeno com imports. Divida documentação por assunto e conecte as páginas por um índice. Rode os checks relevantes, execute `git add` nos arquivos divididos e tente o commit novamente.
