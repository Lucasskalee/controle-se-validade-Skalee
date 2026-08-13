# Plano de classes de usuarios e fornecedores

## Objetivo

Preparar o Controle de Validades para trabalhar com usuarios que podem ter uma ou mais classes operacionais, sem prender a regra apenas ao cadastro de marcas.

O primeiro uso sera para promotores. No futuro, a mesma base deve permitir novas classes, como comprador, supervisor ou outras funcoes.

## Classes de usuario

Um usuario pode continuar sendo um usuario normal, mas tambem pode receber classes adicionais.

Classes previstas:

- `promotor`: usuario que atua observando e registrando produtos dos fornecedores vinculados a ele.
- `comprador`: classe futura para regras de compra, negociacao ou acompanhamento de fornecedores.

O mesmo usuario pode ter mais de uma classe ao mesmo tempo. Exemplo: um usuario pode ser `promotor` e `comprador`.

## Fornecedores

Os fornecedores devem ser cadastrados com:

- codigo do fornecedor
- nome do fornecedor
- situacao ativa ou inativa

Exemplo:

| Codigo | Fornecedor |
| --- | --- |
| 3 | JBS S.A |
| 36 | MOCOCA S/A PRODUTOS ALIMENTOS |
| 50 | ZAELI ALIMENTOS SUL LTDA |

O codigo do fornecedor deve ser a chave principal para filtro operacional, porque ele vem do relatorio do mercado e tende a ser mais confiavel do que o nome da marca.

## Produtos

Cada produto importado do relatorio de fornecedor deve guardar:

- codigo interno do produto
- codigo de barras, quando existir
- descricao do produto
- codigo do fornecedor
- nome do fornecedor

Marca pode continuar existindo como informacao visual ou complementar, mas o filtro do promotor deve usar o codigo do fornecedor.

## Promotores

Para um usuario atuar como promotor, o administrador deve:

1. Cadastrar ou selecionar o usuario.
2. Marcar a classe `promotor` nesse usuario.
3. Vincular um ou mais codigos de fornecedor ao usuario.

O usuario nao deve virar promotor automaticamente apenas por ter fornecedor vinculado. A classe `promotor` e o vinculo com fornecedor sao configuracoes separadas.

## Regra de acesso do promotor

Quando o usuario tiver classe `promotor`, o app deve filtrar os produtos pelo codigo do fornecedor.

Regra:

```text
produto.codigo_fornecedor deve estar nos fornecedores vinculados ao usuario promotor
```

Se o promotor tiver fornecedores `3`, `36` e `50`, ele deve ver, buscar e registrar somente produtos desses fornecedores.

Usuarios sem a classe `promotor` nao devem ser bloqueados por essa regra. Eles continuam seguindo as regras normais do sistema, como permissao por loja ou perfil administrativo.

## Tela de usuarios

No card de cada usuario, o sistema deve mostrar:

- situacao do usuario: `ATIVO` ou `INATIVO`
- classes do usuario: por exemplo `PROMOTOR`, `COMPRADOR`
- codigos de fornecedor vinculados, quando houver

Exemplo visual:

```text
usuario@empresa.com
ATIVO  PROMOTOR  FORN: 3, 36, 50
```

## Edicao de promotor

Na edicao do usuario com classe `promotor`, deve existir uma area de fornecedores atendidos.

O administrador deve conseguir:

- buscar fornecedor por codigo ou nome
- selecionar varios fornecedores
- salvar os vinculos
- ver no card do usuario quais fornecedores estao vinculados

## Direcao tecnica

Tabelas sugeridas:

- `user_classes`: classes disponiveis no sistema.
- `user_class_assignments`: vinculo entre usuario e classe.
- `suppliers`: cadastro de fornecedores.
- `user_supplier_assignments`: vinculo entre usuario e fornecedor.
- `catalog_products.supplier_code`: codigo do fornecedor no produto.

Essa estrutura evita depender apenas de marcas e deixa o sistema preparado para comprador e outras classes futuras.
