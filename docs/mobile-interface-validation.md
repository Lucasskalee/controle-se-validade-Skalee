# Interface mobile — validação local

## Alterações

- Navegação: Início, Produtos, Cadastrar, Relatórios e Perfil.
- Relatórios usa o carregamento existente e continua disponível ao usuário comum.
- Auditoria fica no Perfil, conforme `get_audit_access_context`; alterações de permissão atualizam o atalho e fecham uma tela que perdeu acesso. Alterar a visibilidade de um botão não libera a navegação.
- Cadastrar permanece bloqueado para o perfil de consulta (`viewer`).
- Indicadores com cores semânticas, números maiores, foco visível e disposição vertical até 380 px.
- Os atalhos alteram apenas o grupo correspondente do filtro. Oferta, quantidade, busca, loja e fornecedores continuam combináveis.
- `expired_today` seleciona vencidos e produtos de hoje nas consultas online, na seleção offline e na renderização. Os demais filtros conservam seus limites anteriores.
- Nenhuma função de contagem ou cálculo de validade foi alterada.
- O shell existente foi reutilizado no Android e no site/PWA até 767 px. Em telas web maiores, a navegação original retorna sem recarregar. O service worker e a instalação do PWA permanecem ativos no navegador.
- A margem inferior inclui a área segura e o espaço do botão central. O container web pode encolher no tablet mesmo com o estilo global do mascote.

## Arquivos

| Arquivo | Finalidade |
| --- | --- |
| `android-ui.js` | Navegação compartilhada, atalhos e estados de permissão |
| `android-ui.css` | Cartões, layout responsivo, foco e espaçamento inferior |
| `audit-access.js` | Notificação de atualização do contexto de Auditoria |
| `index.html` | Chip Vencidos / Hoje e seleção dos produtos correspondentes |
| `auth.js` | Filtro equivalente nas consultas Supabase e offline |
| `sw.js` | Próxima versão do cache para uma publicação futura |
| `package.json` | Comando `test:mobile` |
| `tools/test_mobile_navigation.cjs` | Regressão de filtros, navegação, acesso e responsividade |
| `tools/verify_android_ui.cjs` | Atualização da navegação esperada, regressão Android e desktop |
| `supabase/tests/mobile_access_readonly.sql` | Verificação de RLS e RPCs sem gravar dados |

## Evidências

- `npm run typecheck` e `npm run build:web`: aprovados.
- `npm run test:android`: rascunhos, câmera, persistência segura e assets aprovados.
- `npm run test:android:browser`: recuperação após recarga, filas offline, telas, notificações e isolamento por usuário/loja aprovados.
- `npm run test:mobile`: 36 combinações equivalentes de filtros online/offline; limites de datas; multisseleção de fornecedores; navegação; carregamento de Relatórios; acesso/revogação de Auditoria; bloqueio de cadastro para viewer; preservação do service worker web; layouts de 320 a 1440 px em temas claro e escuro.
- `node tools/test_product_detail.cjs`, `node tools/test_product_gallery.cjs` e `node tools/test_audit_sale_report.cjs`: aprovados.
- Capturas locais em `.tmp/mobile-review/`: Android e web mobile em 360 e 390 px, claro e escuro.

No projeto Supabase vinculado, a inspeção confirmou RLS em `validity_products`, `audit_user_location_assignments`, `validity_audits`, `validity_audit_items` e `validity_audit_lifecycle_events`. As políticas de Auditoria verificam administrador ou conta habilitada com autorização para a loja. As RPCs públicas consultadas não permitem execução pelo papel `anon`; suas implementações privadas verificam autenticação e escopo por loja.

O teste SQL foi executado em uma transação **READ ONLY**, com identidades existentes somente dentro da sessão: usuário comum sem acesso às tabelas/RPCs de Auditoria; administrador com acesso; anônimo bloqueado; leitura de produtos restrita pelo escopo existente. Não foram aplicadas migrações nem alterações nos dados/permissões.

## Limites e publicação

Os testes de navegador usam Chrome com emulação de viewport/user-agent e respostas simuladas de autenticação/dados. A validação de RLS/RPCs foi feita separadamente no banco real. Não foi realizada validação em Safari/WebKit nem em aparelhos físicos.

Não houve commit, push ou deploy desta atualização. O APK e a Release publicados anteriormente continuam na versão anterior; será preciso gerar um novo APK após a validação da interface.
