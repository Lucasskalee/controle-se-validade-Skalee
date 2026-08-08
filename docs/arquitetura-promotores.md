# Arquitetura do Módulo de Promotores

## Objetivo

Adicionar ao Controle de Validades uma operação de promotores capaz de atender várias empresas, marcas e locais sem misturar dados entre clientes.

Este documento registra as regras de negócio discutidas. Ele não representa uma implementação concluída.

## Organização da plataforma

A Skalee administra a plataforma. Cada cliente deve operar em um ambiente logicamente isolado, sem acesso aos dados de outras empresas.

As entidades possuem funções diferentes:

- **Empresa proprietária:** indústria ou fornecedora responsável pelos produtos.
- **Marca:** identidade comercial pertencente a uma empresa proprietária.
- **Produto:** item comercial vinculado a uma marca.
- **Agência de promotores:** prestadora ou empresa de merchandising que fornece os promotores.
- **Promotor:** profissional que representa uma ou mais marcas nos locais atribuídos.
- **Rede varejista:** empresa que agrupa os pontos de venda.
- **Local/loja:** unidade física onde a visita e as atividades são realizadas.

## Hierarquia conceitual

```text
Skalee
├── Empresas proprietárias
│   └── Marcas
│       └── Produtos
├── Agências de promotores
│   └── Promotores
└── Redes varejistas
    └── Locais / lojas
```

Essas hierarquias não devem prender um promotor a uma única marca ou empresa. Os vínculos operacionais serão feitos por atribuições.

## Atribuição operacional

Uma atribuição define o trabalho permitido para um promotor e pode relacionar:

- Promotor.
- Agência empregadora ou prestadora.
- Empresa proprietária atendida.
- Uma ou mais marcas.
- Produtos ou portfólio atendido.
- Uma ou mais redes varejistas.
- Um ou mais locais/lojas.
- Supervisor responsável.
- Situação ativa ou inativa.

Exemplo:

```text
Promotor: João
Agência: Razarth Serviços
Empresa proprietária: Unilever
Marcas: Dove e Rexona
Locais: Loja 01 e Loja 03
Supervisor: Maria
Situação: Ativa
```

## Perfis de acesso

### Administrador Skalee

- Acessa todas as empresas e operações autorizadas da plataforma.
- Cadastra, atualiza, ativa e inativa usuários.
- Define empresas, agências, marcas, lojas, supervisores e perfis.
- Consulta o histórico administrativo.

### Gestor da empresa

- Consulta a operação da própria empresa.
- Acompanha as marcas, lojas, promotores e relatórios permitidos.
- Não administra acessos de outras empresas.

### Supervisor

- Acompanha somente promotores, marcas e locais atribuídos.
- Consulta visitas, pendências e relatórios do seu escopo.

### Promotor

- Registra informações apenas nos locais e marcas atribuídos.
- Consulta seu portfólio e sua rota operacional.
- Não altera suas próprias permissões.

### Visualizador

- Consulta informações e relatórios autorizados.
- Não cadastra, atualiza ou exclui dados operacionais.

## Administração de usuários

Somente o Administrador Skalee pode criar ou editar usuários.

No cadastro e na edição, o administrador pode definir:

- Nome e e-mail.
- Perfil de acesso.
- Empresa proprietária, agência ou rede associada.
- Marcas atendidas.
- Locais/lojas permitidos.
- Supervisor responsável.
- Situação ativa ou inativa.
- Redefinição ou recuperação de senha.

Usuários comuns não podem alterar empresa, perfil, marcas, lojas, rotas, supervisor, permissões ou situação da conta.

## Isolamento e segurança

- Empresas clientes não podem visualizar dados umas das outras.
- Toda entidade operacional deve possuir identificação da empresa responsável.
- O acesso deve ser validado no Supabase por políticas RLS, não apenas pela interface.
- Dados de autorização devem ficar em estruturas administrativas seguras, nunca em metadados editáveis pelo próprio usuário.
- Ações administrativas devem gerar registros de auditoria.

## Auditoria

O histórico deve registrar, no mínimo:

- Administrador responsável.
- Tipo da ação.
- Usuário ou entidade alterada.
- Valores anteriores e novos quando aplicável.
- Data e horário.

Exemplo:

```text
Administrador: admin@skalee.com
Ação: adicionou Loja 03 ao promotor João
Data: 08/08/2026 às 14:30
```

## Decisões pendentes

Antes da implementação, ainda será necessário definir:

- Quais tipos de empresa poderão contratar a plataforma diretamente.
- Se indústrias e agências usarão o mesmo painel ou painéis diferentes.
- Formato das rotas e periodicidade das visitas.
- Campos obrigatórios do relatório do promotor.
- Política para fotos e evidências.
- Regras de aprovação e encerramento das visitas.
- Indicadores e painéis de acompanhamento.

## Decisões confirmadas em 08/08/2026

- Indústrias, agências e redes varejistas podem contratar a plataforma.
- Haverá um único painel adaptável. Os módulos, produtos e informações exibidos serão filtrados conforme a necessidade e o escopo de cada organização.
- Rotas e periodicidade das visitas serão opcionais na primeira fase.
- A primeira fase funcional será dedicada aos cadastros administrativos.
- Visitas, relatórios, fotos, aprovações e indicadores serão definidos e implementados em fases posteriores.
- Somente o Administrador Skalee poderá criar usuários e alterar perfis, vínculos ou permissões.

## Estrutura implementada no Supabase

Em 08/08/2026 foi criada a fundação multiempresa com as seguintes tabelas:

- `organizations`: indústrias, agências e redes varejistas.
- `brands`: marcas e sua organização proprietária.
- `catalog_products`: catálogo de produtos vinculado às marcas.
- `retail_locations`: lojas e pontos de venda das redes varejistas.
- `user_profiles`: dados complementares e situação dos usuários.
- `organization_memberships`: vínculos dos usuários com organizações e seus papéis.
- `promoter_profiles`: dados operacionais dos promotores e supervisores.
- `promoter_brand_assignments`: marcas permitidas por promotor.
- `promoter_product_assignments`: produtos permitidos por promotor.
- `promoter_location_assignments`: locais permitidos por promotor.
- `admin_audit_log`: histórico das alterações administrativas.

Todas as tabelas possuem RLS ativo. A leitura é limitada pelo escopo do usuário e a manutenção dos cadastros é reservada ao Administrador Skalee. Também foram criados índices, validações, atualização automática de datas e gatilhos de auditoria.

A Skalee não foi cadastrada como empresa cliente: ela permanece como operadora da plataforma. A conta principal `skalee.razarth@gmail.com` foi ativada como `platform_admin` e recebeu o perfil Administrador Skalee.
