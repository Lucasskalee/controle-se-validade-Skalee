# Skalee Validades — Design System & Diretrizes de Interface (DESIGN.md)

Este documento estabelece o Design System oficial do **Controle de Validades | Skalee**, integrando as melhores práticas do repositório [awesome-design-md (VoltAgent)](https://github.com/VoltAgent/awesome-design-md) — com foco nos princípios de precisão, densidade de informação e acabamento premium observados em **Linear**, **Vercel** e **Raycast**, preservando a identidade visual da **Skalee**.

---

## 1. Filosofia de Design e Identidade Visual

O Skalee é uma plataforma de alta performance operacional para supermercados e redes de varejo. Ele permite cadastrar validades, monitorar produtos críticos e mitigar perdas com agilidade máxima em corredores de loja e no escritório administrativo.

### Pilares Fundamentais:
1. **Dark-First com Alta Clareza:** Fundos profundos e tecnológicos (obsidiana e azul-marinho escuro) proporcionam conforto visual contínuo, economia de bateria em telas OLED e destaque imediato para datas de vencimento críticas.
2. **Precisão e Acabamento Metálico:** Bordas de 1px com iluminação sutil (estilo Raycast/Linear), cantos arredondados calculados e ausência de decorações supérfluas ou sombras borradas pesadas.
3. **Tipografia Tabular Operacional:** Números, contagens e datas de validade são sempre exibidos com `font-variant-numeric: tabular-nums`, evitando desalinhamentos durante atualizações e contagens dinâmicas.
4. **Performance Extrema:** Proibição de animações contínuas de gradiente ou giros infinitos (`conic-gradient` rotativo contínuo) que drenam ciclos de GPU e bateria em smartphones e coletores móveis. As transições são pontuais, táteis e ágeis (150ms–200ms ease-out).
5. **Preservação Lógica e Segurança:** A interface é uma camada visual sobre o motor Local-First e Supabase. Toda a lógica de contagens, cálculo de datas, permissões de auditoria, filtros combináveis e integridade de dados é inviolável.

---

## 2. Tokens de Design (Design Tokens)

### 2.1. Cores e Superfícies

A paleta de cores se divide entre o tema escuro principal (dark-first) e o tema claro de suporte operacional.

#### Tema Escuro (Principal / Padrão)
```css
html[data-theme="dark"] {
  /* Superfícies em Camadas */
  --sk-bg-base: #070b12;         /* Fundo da aplicação (profundidade zero) */
  --sk-bg-surface: #0b1220;      /* Superfície de cartões, headers e painéis */
  --sk-bg-surface-elevated: #101827; /* Modais, menus flutuantes, popovers */
  --sk-bg-surface-hover: #162238;    /* Estado hover/ativo sutil de listas e botões */
  
  /* Bordas e Divisores de Precisão */
  --sk-border-subtle: rgba(148, 163, 184, 0.12); /* Bordas normais de 1px */
  --sk-border-medium: rgba(148, 163, 184, 0.22); /* Divisores e campos de formulário */
  --sk-border-highlight: rgba(0, 217, 255, 0.38); /* Borda de foco / elemento ativo */

  /* Textos e Ícones */
  --sk-text-primary: #f8fafc;    /* Títulos e números em destaque */
  --sk-text-secondary: #cbd5e1;  /* Rótulos e textos descritivos */
  --sk-text-muted: #94a3b8;      /* Textos auxiliares e timestamps */
  --sk-text-disabled: #475569;   /* Estados desabilitados */

  /* Identidade Proprietária Skalee */
  --sk-accent-blue: #0077ff;     /* Azul elétrico (ações principais e foco) */
  --sk-accent-blue-hover: #1d4ed8;
  --sk-accent-cyan: #00d9ff;     /* Ciano tecnológico (detalhes e glow de foco) */
  --sk-accent-metallic: #94a3b8; /* Cinza metálico acetinado */

  /* Status Semânticos de Validade */
  --sk-status-danger: #ef4444;   /* Vencidos / Vence hoje */
  --sk-status-danger-bg: rgba(239, 68, 68, 0.12);
  --sk-status-warning: #f59e0b;  /* Próximos 7 dias */
  --sk-status-warning-bg: rgba(245, 158, 11, 0.12);
  --sk-status-offer: #3b82f6;    /* Em oferta */
  --sk-status-offer-bg: rgba(59, 130, 246, 0.12);
  --sk-status-safe: #10b981;     /* Validade segura */
  --sk-status-safe-bg: rgba(16, 185, 129, 0.12);
}
```

#### Tema Claro (Operacional)
```css
html[data-theme="light"] {
  --sk-bg-base: #f1f5f9;
  --sk-bg-surface: #ffffff;
  --sk-bg-surface-elevated: #ffffff;
  --sk-bg-surface-hover: #e2e8f0;
  
  --sk-border-subtle: #cbd5e1;
  --sk-border-medium: #94a3b8;
  --sk-border-highlight: #2563eb;

  --sk-text-primary: #0f172a;
  --sk-text-secondary: #334155;
  --sk-text-muted: #64748b;
  --sk-text-disabled: #94a3b8;

  --sk-accent-blue: #1d4ed8;
  --sk-accent-blue-hover: #1e40af;
  --sk-accent-cyan: #0284c7;
  --sk-accent-metallic: #64748b;

  --sk-status-danger: #b91c1c;
  --sk-status-danger-bg: #fef2f2;
  --sk-status-warning: #b45309;
  --sk-status-warning-bg: #fffbeb;
  --sk-status-offer: #1d4ed8;
  --sk-status-offer-bg: #eff6ff;
  --sk-status-safe: #15803d;
  --sk-status-safe-bg: #f0fdf4;
}
```

### 2.2. Camada de Compatibilidade (Tokens `--sk-*` e Variáveis Legadas)

Para garantir estabilidade máxima sem quebra de CSS legado durante a transição, o motor de estilos em `theme-layout.css` implementa uma **camada de compatibilidade bidirecional**. As variáveis legadas atuam como pontes e apelidos diretos para os tokens oficiais:

| Token Oficial (`--sk-*`) | Variável Legada Equivalente | Finalidade no Sistema |
| :--- | :--- | :--- |
| `--sk-bg-base` | `--bg`, `--sk-bg` | Fundo principal da aplicação |
| `--sk-bg-surface` | `--card`, `--sk-surface` | Superfície de cartões, painéis e itens de catálogo |
| `--sk-bg-surface-hover` | `--sk-surface-hover` | Estado interativo/hover em listas e linhas |
| `--sk-border-subtle` | `--line` | Divisores e bordas finas de 1px |
| `--sk-text-primary` | `--text`, `--sk-text` | Texto de alta ênfase e números de KPI |
| `--sk-text-muted` | `--muted`, `--sk-muted` | Rótulos, timestamps e legendas |
| `--sk-accent-blue` | `--blue`, `--sk-primary`, `--primary` | Ações principais, botão ativo e foco |
| `--sk-accent-blue-hover` | `--violet-hover` | Estado hover de botões primários |
| `--sk-accent-cyan` | `--sk-cyan` | Destaques tecnológicos e brilho de foco |
| `--sk-status-offer` | `--blue` (contexto de oferta) | Badges de produtos em oferta |
| `--sk-status-danger` | `--red`, `--sk-danger` | Vencidos e produtos com vencimento hoje |
| `--sk-status-warning` | `--orange`, `--sk-warning` | Validades críticas (próximos 7 dias) |
| `--sk-status-safe` | `--green`, `--sk-success` | Validades seguras |

> [!NOTE]
> Módulos especializados conservam variáveis com prefixos de escopo específicos: `--admin-*` (Central Administrativa), `--kpi-*` (Indicadores táticos mobile) e `--notification-tone` (Central de Notificações). Novas interfaces devem utilizar estritamente o prefixo `--sk-*`.

---

## 3. Tipografia e Escala de Espaçamento

### 3.1. Família Tipográfica
A tipografia utiliza a pilha de fontes do sistema com suporte avançado a números tabulares:
`font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`

### 3.2. Escala Tipográfica
- **Números de Dashboard (KPIs):** `28px` a `32px`, peso `800`, `font-variant-numeric: tabular-nums`.
- **Títulos de Seção / Cabeçalho:** `18px` a `20px`, peso `750`, `letter-spacing: -0.02em`.
- **Subtítulos e Nomes de Produtos:** `14px` a `15px`, peso `700`, entrelinha `1.35`.
- **Corpo / Dados de Formulário:** `13px` a `14px`, peso `500` a `600`.
- **Badges, Etiquetas e Metadados:** `11px` a `12px`, peso `750`, `letter-spacing: 0.01em`.

### 3.3. Raios de Borda (Corner Radius)
- Elementos inline / badges / pílulas: `999px` (full pill).
- Campos de busca, botões e inputs: `10px` a `12px`.
- Cartões de KPI e painéis secundários: `14px` a `16px`.
- Cards de produtos e modais de diálogo: `16px` a `18px`.

---

## 4. Componentes do Sistema

### 4.1. Cabeçalho (App Header)
O cabeçalho unifica a identidade visual, o estado de sincronização em tempo real e as ações rápidas:
- **Logo e Marca:** Símbolo metálico Skalee em alta definição (`skalee-symbol-transparent.png`), acompanhado do título "Controle de Validades | Skalee" e subtítulo orientativo.
- **Indicador de Sincronização (Sync Badge):** Pílula compacta de precisão com ponto de status pulsante sutil (`is-synced`: verde esmeralda, `is-syncing`: azul elétrico com pulso suave, `is-offline`: âmbar, `is-error`: vermelho).
- **Ações Rápidas:** Acesso à Central Administrativa (quando autorizado) e botão circular de perfil/notificações com badge numérico em vermelho vivo.

### 4.2. Arquitetura de Navegação (Desktop e Mobile)

O sistema opera com duas camadas complementares e coesas de navegação, adaptadas à ergonomia do operador:

#### A. Navegação Desktop / Telas Médias e Grandes (> 767px)
Mantém a barra de navegação superior (`nav.main-nav`) com 5 destinos diretos:
1. **Produtos:** Catálogo completo e gerenciamento de validades.
2. **Registrar:** Fluxo rápido de entrada e conferência de lote.
3. **Auditoria:** Painel analítico protegido por RLS e contexto de permissão.
4. **Relatórios:** Exportação e conciliação de validades.
5. **Configurações:** Ajustes locais, seletor de tema e dados da loja.

#### B. Navegação Mobile / Android (<= 767px e App Capacitor)
Em smartphones e coletores móveis, o sistema ativa o shell móvel dedicado (`android-ui.js` e `.android-bottom-nav`) com 5 destinos ergonômicos desenhados para operação tátil com uma das mãos:
1. **Início (`data-android-page="home"`):** Visão geral operacional, status de sincronização e indicadores rápidos de risco.
2. **Produtos (`data-android-page="products"`):** Catálogo de itens com filtros combináveis (`expired_today`, oferta, quantidade, loja e fornecedor).
3. **Cadastrar (`data-android-page="register"` / `.android-nav-item-center`):** Botão central de ação primária destacado com ícone tátil em círculo/pílula elevada, permitindo fluxo veloz de conferência e salvamento de rascunhos. Fica bloqueado automaticamente para perfil de apenas consulta (`viewer`).
4. **Relatórios (`data-android-page="reports"`):** Acesso a resumos e impressões de validades diretamente pelo operador.
5. **Perfil (`data-android-page="profile"`):** Central do operador contendo identificação, seleção de loja ativa, tema do sistema e acesso à **Auditoria Mensal de Validades** (contextualizada e protegida via `get_audit_access_context` do Supabase; se o usuário não possuir loja liberada, o atalho exibe mensagem informativa sem quebrar o fluxo).

> [!IMPORTANT]
> **Preservação Estrutural:** Não alterar o fluxo do botão central nem suprimir o controle de acesso de Auditoria no Perfil. A visibilidade de botões é dinâmica, mas a autorização real é sempre garantida por RLS e RPCs no banco de dados.

### 4.3. Dashboard e Indicadores (KPIs)
Os indicadores operacionais sintetizam o estoque de risco em tempo real:
- **5 Indicadores no Desktop:** `Produtos ativos`, `Unidades`, `Vence hoje`, `Até 7 dias`, `Em oferta`.
- **3 Indicadores Interativos no Mobile:** `Vencidos / Hoje`, `Próximos 7 dias`, `Em oferta`.
- **Interação:** Ao clicar em um indicador, a página de produtos é ativada instantaneamente com o filtro correspondente (`expired_today`, `7`, `offer`), preservando a busca por texto, filtro de loja e fornecedores selecionados.

### 4.4. Filtros Combináveis e Busca
- **Barra de Busca com Layout:** Campo de texto livre com botão `×` de limpeza instantânea, seletor de loja ativa e seletor de fornecedor com suporte a múltiplos códigos numéricos.
- **Seletor de Colunas (Grid Layout):** 1, 2, 3 ou 4 colunas com persistência local da preferência do operador.
- **Chips Multisseleção:** Substituição do violeta legado por acabamento **azul elétrico e cinza metálico**. O chip ativo recebe fundo azul com brilho sutil e contraste nítido, mantendo toda a lógica de combinação de grupos (`expiry`, `offer`, `quantity`).

### 4.5. Cards de Produtos
- **Estrutura:** Layout flexível com foto centralizada e proporcional (sem distorção de aspect-ratio), descrição em destaque, código interno, código de barras e lote.
- **Eliminação de Lag:** Remoção completa da animação rotativa infinita de gradiente. Substituição por micro-borda metálica de 1px (`--sk-border-subtle`), com elevação rápida no hover (`translateY(-2px)`) e borda destacada em azul elétrico.
- **Badges Semânticos:** Indicador de dias restantes com cor condicional imediata (vermelho: <= 0 dias; âmbar: 1 a 7 dias; amarelo: 8 a 15 dias; azul: em oferta).

---

## 5. Responsividade e Especificações por Dispositivo

| Dispositivo / Viewport | Comportamento de Layout | Ajuste de Navegação | Safe Areas e Espaçamento |
| :--- | :--- | :--- | :--- |
| **Smartphones (< 620px)** | Grid de produtos em 1 ou 2 colunas; KPIs em 2 colunas ou empilhados verticalmente (até 380px); cabeçalho compacto com loja ativa e sync pill. | Bottom Navigation fixa de 5 destinos com botão central destacado (`.android-nav-item-center`). | Reserva de área segura inferior `padding-bottom: env(safe-area-inset-bottom, 84px)` para não cobrir ações. |
| **Tablets e Telas Médias (620px – 767px)** | Grid em 2 ou 3 colunas; busca e filtros com scroll horizontal suave. | Bottom Navigation mobile ativa com abas proporcionais. | Margem inferior preservada para a barra de toque. |
| **Tablets Grandes e Desktop (> 767px)** | Container centralizado em até 1180px; 5 KPIs operacionais; grid em até 4 colunas. | Barra superior `nav.main-nav` clássica sem recarregar o shell. | Sem necessidade de safe area inferior móvel. |

---

## 6. Acessibilidade (A11y) e Desempenho

- **Contraste Mínimo:** Todos os textos sobre fundo atendem à razão de contraste WCAG AA (mínimo de 4.5:1 para texto normal e 3:1 para números grandes).
- **Foco Visível:** Todos os controles interativos possuem `:focus-visible` com anel de foco em azul elétrico (`2px solid var(--sk-accent-blue)`, offset `2px`).
- **Áreas de Toque:** Elementos táteis em telas sensíveis possuem área útil mínima de `44 × 44 px`.
- **Prevenção de layout shift:** Imagens de produtos utilizam contêineres com proporção protegida para evitar saltos visuais durante o carregamento de fotos.
- **Modo Performance:** Usuários em dispositivos com hardware modesto ativam automaticamente a classe `.performance-mode`, desativando qualquer blur pesado ou transição complexa.

---

## 7. Verificação e Testes

Após qualquer alteração de código visual, executar obrigatoriamente:
```bash
npm run verify:ui-tokens
npm run typecheck
npm run test:mobile
npm run test:android
```
Nenhuma alteração de interface deve comprometer as regras de negócio em [auth.js](auth.js), [local-store.ts](src/local-store.ts) ou nos scripts de auditoria e sincronização.
npm run test:android
```
Nenhuma alteração de interface deve comprometer as regras de negócio em [auth.js](auth.js), [local-store.ts](src/local-store.ts) ou nos scripts de auditoria e sincronização.
