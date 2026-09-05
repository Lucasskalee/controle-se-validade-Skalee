/**
 * SKALITO TOUR STEPS CONFIGURATION
 * Etapas completas do tour guiado pelo mascote oficial Skalito.
 */

export const SKALITO_TOUR_VERSION = 2;

export const SKALITO_TOUR_STORAGE = {
  completed: "skalee_tour_concluido",
  version: "skalee_tour_version",
  dismissedPrompt: "skalee_tour_prompt_dismissed"
};

export const skalitoTourSteps = [
  // =========================================================================
  // 1. DASHBOARD
  // =========================================================================
  {
    id: "dashboard-overview",
    page: "products",
    target: "#products",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "sparkle",
    look: "left",
    message: "Esse é o Dashboard. É daqui que você consegue enxergar rapidamente onde precisa prestar atenção."
  },
  {
    id: "dashboard-indicators",
    page: "products",
    target: ".stats",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "point",
    look: "left",
    message: "Esses indicadores resumem tudo: total de produtos ativos, unidades, itens que vencem hoje, próximos dias e ofertas."
  },
  {
    id: "dashboard-expiring-today",
    page: "products",
    target: "#sToday",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "alert",
    event: "blink",
    look: "right",
    message: "Aqui fica o que vence hoje. Essa parte merece prioridade máxima na conferência da loja!"
  },
  {
    id: "dashboard-seven-days",
    page: "products",
    target: "#s7",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "talking",
    event: "point",
    look: "right",
    message: "Viu esse grupo aqui? São produtos que estão chegando perto da validade nos próximos 7 dias."
  },
  {
    id: "dashboard-filters",
    page: "products",
    target: "#chips",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "thinking",
    look: "left",
    message: "Com esses botões de atalho, você filtra com um clique por urgência, ofertas ou lotes com quantidade alta."
  },
  {
    id: "dashboard-products",
    page: "products",
    target: "#grid",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    look: "left",
    message: "Aqui na grade ficam todos os produtos cadastrados com foto, loja, dias restantes e ações rápidas."
  },
  {
    id: "dashboard-expired-note",
    page: "products",
    target: "#grid",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "alert",
    look: "left",
    message: "Itens vencidos exigem ação imediata. Quando saem da lista ativa, você acompanha o histórico pelos relatórios."
  },

  // =========================================================================
  // 2. RELATÓRIOS
  // =========================================================================
  {
    id: "report-purpose",
    page: "report",
    target: "#report",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "sparkle",
    look: "left",
    message: "Agora estamos em Relatórios. Aqui você gera listas limpas para copiar no WhatsApp, imprimir ou exportar."
  },
  {
    id: "report-filters",
    page: "report",
    target: ".report-controls",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "talking",
    event: "point",
    look: "right",
    message: "Você pode filtrar por loja específica, período de atualização ou focar só nos itens cadastrados hoje."
  },
  {
    id: "report-reading",
    page: "report",
    target: "#reportText",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "thinking",
    look: "left",
    message: "Leia cada item pelo nome, F7, quantidade e validade. Quando houver departamento na base, ele ajuda na análise gerencial."
  },
  {
    id: "report-layout",
    page: "report",
    target: "#layoutPicker",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "thinking",
    look: "right",
    message: "Esses botões mudam a quantidade de colunas na visualização, ótimo para revisar em telas maiores ou imprimir."
  },
  {
    id: "report-selection",
    page: "report",
    target: ".report-selection-actions",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    look: "left",
    message: "Você tem controle total: selecione todos os itens ou marque apenas os produtos que deseja enviar no fechamento."
  },
  {
    id: "report-export",
    page: "report",
    target: ".report-primary-actions",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "happy",
    event: "wings",
    look: "right",
    message: "Com um clique, copie o texto formatado para a área de transferência ou gere o PDF oficial."
  },

  // =========================================================================
  // 3. CADASTRO DE PRODUTOS
  // =========================================================================
  {
    id: "register-start",
    page: "register",
    target: "#register .form",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "sparkle",
    look: "left",
    message: "Agora vou te mostrar como cadastrar um produto. Essa parte precisa ser rápida porque ninguém merece preencher vinte campos para cadastrar um iogurte."
  },
  {
    id: "register-barcode",
    page: "register",
    target: "#barcode",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "point",
    look: "left",
    before: "fillDemoBarcode",
    message: "Comece pelo código de barras: você pode digitar ou usar um leitor conectado."
  },
  {
    id: "register-scan",
    page: "register",
    target: "#scanCamera",
    mascotPosition: "bottom-left",
    speechPosition: "right",
    mascotAnimation: "thinking",
    look: "right",
    message: "Se estiver no celular ou com webcam, o botão 'Ler câmera' abre o scanner visual com foco automático."
  },
  {
    id: "register-found",
    page: "register",
    target: "#found",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    look: "left",
    before: "showDemoFound",
    message: "O catálogo busca automaticamente o nome, código interno F7 e detalhes do produto para você não perder tempo digitando."
  },
  {
    id: "register-store",
    page: "register",
    target: "#store",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "point",
    look: "left",
    message: "Selecione a loja ou setor onde o produto está localizado. Isso mantém os relatórios sempre organizados."
  },
  {
    id: "register-qty-expiry",
    page: "register",
    target: "#qty",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    look: "left",
    before: "fillDemoDetails",
    message: "Informe a quantidade de unidades do lote e a data de vencimento impressa na embalagem."
  },
  {
    id: "register-photo",
    page: "register",
    target: "#photo",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "thinking",
    look: "left",
    message: "A foto é opcional mas ajuda muito a equipe na conferência visual do produto nas gôndolas."
  },
  {
    id: "register-save",
    page: "register",
    target: "#save",
    mascotPosition: "top-right",
    speechPosition: "left",
    mascotAnimation: "alert",
    look: "left",
    message: "No uso normal, o botão 'Salvar produto' grava no sistema. Aqui no tour é só demonstração, nada foi salvo no banco!",
    after: "clearDemoRegister"
  },

  // =========================================================================
  // 4. CONFIGURAÇÕES
  // =========================================================================
  {
    id: "settings-entry",
    page: "settings",
    target: "#personalPanel",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "sparkle",
    look: "right",
    message: "Aqui em Configurações você personaliza sua experiência e acessa informações da sua conta."
  },
  {
    id: "settings-theme",
    page: "settings",
    target: ".personal-theme",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    event: "point",
    look: "right",
    message: "Alterne entre o tema Claro e o tema Escuro conforme sua preferência, sem alterar os dados do sistema."
  },
  {
    id: "settings-notifications",
    page: "settings",
    target: "#personalNotificationsButton",
    mascotPosition: "bottom-right",
    speechPosition: "left",
    mascotAnimation: "talking",
    look: "right",
    message: "Ative notificações para receber alertas automáticos direto no navegador quando produtos estiverem perto de vencer."
  },

  // =========================================================================
  // 5. CONCLUSÃO
  // =========================================================================
  {
    id: "tour-finish",
    page: "products",
    target: ".main-nav",
    mascotPosition: "center",
    speechPosition: "top",
    mascotAnimation: "happy",
    event: "celebrate",
    look: "center",
    message: "Pronto. Agora você já conhece o básico do Controle de Validade!"
  }
];
