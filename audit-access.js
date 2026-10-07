(function () {
  'use strict';

  let context = null;
  let generation = 0;
  let signedIn = false;

  // Workspace state
  let selectedLocationId = null;
  let selectedCompetence = ''; // 'YYYY-MM'
  let currentAudit = null;
  let auditItems = [];
  let currentFilter = 'all'; // 'all' | 'pending' | 'loss' | 'no_loss' | 'found'
  let currentSearch = '';
  let isLoadingAudit = false;
  let isSyncingItems = false;

  // Helpers
  function formatCurrency(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '—';
    return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDate(val) {
    if (!val) return '—';
    const parts = String(val).split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return val;
  }

  function formatDateShort(val) {
    if (!val) return '—';
    const parts = String(val).split('-');
    if (parts.length === 3) {
      const yr = parts[0].slice(-2);
      return `${parts[2]}/${parts[1]}/${yr}`;
    }
    return val;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCompetence(val) {
    if (!val) return '';
    const parts = String(val).split('-');
    if (parts.length < 2) return val;
    const year = parts[0];
    const month = parseInt(parts[1], 10);
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return `${months[month - 1] || month}/${year}`;
  }

  function getCurrentCompetenceMonth() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // Navigation tab
  const nav = document.querySelector('nav.main-nav') || document.querySelector('nav');
  let tab = document.querySelector('nav .tab[data-page="audit"]') || document.getElementById('auditTab');
  if (!tab) {
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.id = 'auditTab';
    tab.dataset.page = 'audit';
    tab.hidden = true;
    tab.innerHTML = `
      <span class="tab-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="m9 14 2 2 4-4"/>
        </svg>
      </span>
      <span class="tab-label">
        <span class="label-desktop">Auditoria</span>
        <span class="label-mobile">Auditoria</span>
      </span>
    `;
    const settingsBtn = document.getElementById('personalSettingsButton');
    if (settingsBtn && settingsBtn.parentElement === nav) {
      nav.insertBefore(tab, settingsBtn);
    } else if (nav) {
      nav.append(tab);
    }
  }

  // Main Audit Section Panel
  let panel = document.getElementById('audit');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'audit';
    panel.className = 'page';
    panel.hidden = true;
    const reportSection = document.getElementById('report') || document.getElementById('products');
    if (reportSection) {
      reportSection.after(panel);
    } else {
      document.body.append(panel);
    }
  }

  panel.innerHTML = `
    <style>
      .audit-wrap { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
      .audit-card { background: var(--card, #fff); border: 1px solid var(--line, #e2e8f0); border-radius: 16px; padding: 22px; box-shadow: 0 4px 18px rgba(0,0,0,0.03); }
      html[data-theme="dark"] .audit-card { background: var(--card, #101827); border-color: rgba(255,255,255,0.08); }
      
      .audit-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
      .audit-title { margin: 0; font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 10px; color: var(--text); }
      .audit-subtitle { margin: 4px 0 0 34px; color: var(--muted, #64748b); font-size: 13px; font-weight: 500; }
      .audit-role-badge { font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; }
      
      .audit-bar { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line, #e2e8f0); }
      html[data-theme="dark"] .audit-bar { border-color: rgba(255,255,255,0.08); }
      .audit-field-group { display: flex; flex-direction: column; gap: 6px; min-width: 220px; flex: 1 1 auto; }
      .audit-field-label { font-size: 11px; font-weight: 800; color: var(--muted, #64748b); text-transform: uppercase; letter-spacing: 0.6px; }
      .audit-select, .audit-input { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line, #cbd5e1); background: var(--card, #fff); color: var(--text, #1e293b); font-size: 14px; font-weight: 600; outline: none; }
      html[data-theme="dark"] .audit-select, html[data-theme="dark"] .audit-input { background: #0c1421; border-color: rgba(255,255,255,0.15); color: #e2e8f0; }
      .audit-select:focus, .audit-input:focus { border-color: var(--blue, #2563eb); }
      
      .audit-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
      @media (max-width: 820px) {
        .audit-kpi-grid { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 480px) {
        .audit-kpi-grid { grid-template-columns: 1fr; }
      }
      .audit-kpi-card { padding: 16px; border-radius: 12px; background: rgba(0,217,255,0.04); border: 1px solid rgba(0,217,255,0.18); display: flex; flex-direction: column; gap: 4px; }
      .audit-kpi-card.warning { background: rgba(234,88,12,0.05); border-color: rgba(234,88,12,0.22); }
      .audit-kpi-card.danger { background: rgba(220,38,38,0.05); border-color: rgba(220,38,38,0.22); }
      .audit-kpi-card.info { background: rgba(59,130,246,0.05); border-color: rgba(59,130,246,0.22); }
      .audit-kpi-card.success { background: rgba(22,163,74,0.05); border-color: rgba(22,163,74,0.22); }
      .audit-kpi-value { font-size: 26px; font-weight: 800; color: var(--text, #0f172a); line-height: 1.1; }
      .audit-kpi-title { font-size: 12px; font-weight: 800; color: var(--muted, #64748b); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
      .audit-kpi-sub { font-size: 11px; color: var(--muted, #64748b); }

      .audit-actions-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
      .audit-toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
      .audit-search-wrap { flex: 1 1 260px; position: relative; }
      .audit-filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .audit-filter-chip { border: 1px solid var(--line, #cbd5e1); background: transparent; color: var(--muted, #64748b); padding: 7px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s ease; }
      .audit-filter-chip:hover { border-color: var(--blue, #2563eb); color: var(--text); }
      .audit-filter-chip.active { background: var(--blue, #2563eb); border-color: var(--blue, #2563eb); color: #fff; }
      html[data-theme="dark"] .audit-filter-chip { border-color: rgba(255,255,255,0.15); }

      .audit-section-heading { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted, #64748b); margin-top: 18px; margin-bottom: 6px; }
      .audit-table-header { display: grid; grid-template-columns: 56px minmax(220px, 2.5fr) 100px 90px 100px 110px 140px; gap: 14px; padding: 10px 16px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted, #64748b); }
      .audit-items-list { display: flex; flex-direction: column; gap: 10px; }
      .audit-item-row { display: grid; grid-template-columns: 56px minmax(220px, 2.5fr) 100px 90px 100px 110px 140px; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--line, #e2e8f0); background: var(--card, #fff); transition: border-color .15s ease, box-shadow .15s ease; }
      html[data-theme="dark"] .audit-item-row { background: var(--card, #101827); border-color: rgba(255,255,255,0.08); }
      .audit-item-row:hover { border-color: var(--blue, #2563eb); box-shadow: 0 4px 12px rgba(0,0,0,0.03); }

      @media (max-width: 900px) {
        .audit-table-header { display: none; }
        .audit-item-row { grid-template-columns: 56px 1fr auto; gap: 12px; align-items: flex-start; }
        .audit-col-desktop { display: none !important; }
        .audit-col-mobile { display: flex !important; }
      }
      @media (min-width: 901px) {
        .audit-col-mobile { display: none !important; }
      }

      .audit-item-thumb { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: rgba(148,163,184,0.12); display: grid; place-items: center; overflow: hidden; border: 1px solid var(--line, #e2e8f0); }
      html[data-theme="dark"] .audit-item-thumb { border-color: rgba(255,255,255,0.1); }
      .audit-item-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .audit-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; line-height: 1.2; }
      .badge-monitored { background: rgba(37,99,235,0.12); color: #2563eb; }
      .badge-found { background: rgba(168,85,247,0.15); color: #9333ea; }
      .badge-pending { background: rgba(234,88,12,0.12); color: #ea580c; }
      .badge-counted { background: rgba(22,163,74,0.14); color: #16a34a; }
      
      .audit-modal-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(7,11,18,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px; opacity: 0; pointer-events: none; transition: opacity .2s ease; }
      .audit-modal-overlay.show { opacity: 1; pointer-events: auto; }
      .audit-modal-panel { background: var(--card, #fff); border: 1px solid var(--line, #e2e8f0); border-radius: 18px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 22px; box-shadow: 0 25px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 14px; position: relative; }
      html[data-theme="dark"] .audit-modal-panel { background: #0c1421; border-color: rgba(255,255,255,0.15); }
      .audit-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .audit-modal-title { margin: 0; font-size: 18px; font-weight: 800; color: var(--text); }
      .audit-modal-close { background: transparent; border: 0; font-size: 22px; cursor: pointer; color: var(--muted); border-radius: 8px; padding: 4px 8px; }
      .audit-modal-close:hover { color: var(--text); background: rgba(148,163,184,0.15); }
      
      .audit-empty-state { text-align: center; padding: 40px 20px; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .audit-empty-state svg { width: 48px; height: 48px; stroke: currentColor; opacity: 0.6; }

      .audit-status-tag { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
      .status-tag-open { background: rgba(0,217,255,0.12); color: var(--sk-cyan, #00d9ff); border: 1px solid rgba(0,217,255,0.25); }
      html[data-theme="light"] .status-tag-open { background: rgba(37,99,235,0.1); color: #2563eb; border-color: rgba(37,99,235,0.25); }
      .status-tag-ready { background: rgba(245,158,11,0.12); color: #d97706; border: 1px solid rgba(245,158,11,0.3); }
      .status-tag-completed { background: rgba(34,197,94,0.12); color: #16a34a; border: 1px solid rgba(34,197,94,0.3); }
    </style>

    <div class="audit-wrap">
      <!-- Top Card: Context and Selectors (Mockup top section) -->
      <div class="audit-card">
        <div class="audit-header">
          <div>
            <h2 class="audit-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px; height:24px; color:var(--sk-cyan, #00d9ff);">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
                <path d="m9 14 2 2 4-4"/>
              </svg>
              Auditoria de Validades
            </h2>
            <p class="audit-subtitle">Controle físico de vencimentos por loja e competência</p>
          </div>
          <span id="auditRoleBadge" class="audit-role-badge"></span>
        </div>
        <p id="auditStatusMsg" role="status" style="display:none;"></p>
        <div id="auditLocationsContainer" style="display:none;"><div id="auditLocationsList" class="user-location-checks"></div></div>

        <div class="audit-bar">
          <div class="audit-field-group">
            <label class="audit-field-label" for="auditStoreSelect">LOJA</label>
            <select id="auditStoreSelect" class="audit-select"></select>
          </div>

          <div class="audit-field-group" style="max-width: 220px;">
            <label class="audit-field-label" for="auditMonthInput">COMPETÊNCIA</label>
            <input type="month" id="auditMonthInput" class="audit-input">
          </div>

          <button type="button" id="auditLoadBtn" class="btn" style="min-height: 42px; padding: 0 22px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
            <span>Abrir</span>
          </button>
        </div>
      </div>

      <!-- Audit Workspace Body (hidden when no audit loaded) -->
      <div id="auditWorkspace" style="display: none; flex-direction: column; gap: 18px;">
        <!-- Header Info & Actions -->
        <div class="audit-card">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
            <div>
              <h3 id="auditStoreTitle" style="margin: 0; font-size: 18px; font-weight: 800; color: var(--text);"></h3>
              <small id="auditCompetenceLabel" style="display: none;"></small>
            </div>
            <div>
              <span id="auditStatusTag" class="audit-status-tag"></span>
            </div>
          </div>

          <!-- Alert for completed audit -->
          <div id="auditCompletedNotice" style="display: none; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.25); font-size: 13px; color: #16a34a; font-weight: 600;">
            ✓ Esta auditoria mensal está finalizada e imutável. Para efetuar ajustes operacionais, solicite a reabertura pelo Administrador.
          </div>

          <!-- KPI Grid (Mockup: Produtos, Vencidas, Impacto, Pendentes) -->
          <div class="audit-kpi-grid">
            <div class="audit-kpi-card">
              <span id="kpiTotalItems" class="audit-kpi-value">0</span>
              <span class="audit-kpi-title">Produtos</span>
              <span class="audit-kpi-sub">Total no mês</span>
            </div>

            <div class="audit-kpi-card warning">
              <span id="kpiLossUnits" class="audit-kpi-value">0 un.</span>
              <span class="audit-kpi-title">Vencidas</span>
              <span id="kpiCountedSub" class="audit-kpi-sub">0 apurados</span>
              <span id="kpiCountedItems" style="display: none;">0</span>
            </div>

            <div class="audit-kpi-card danger">
              <span id="kpiFinancialCost" class="audit-kpi-value">R$ 0,00</span>
              <span class="audit-kpi-title">Impacto</span>
              <span id="kpiSalesLossSub" class="audit-kpi-sub">Venda: R$ 0,00</span>
            </div>

            <div class="audit-kpi-card info">
              <span id="kpiPendingItems" class="audit-kpi-value">0</span>
              <span class="audit-kpi-title">Pendentes</span>
              <span class="audit-kpi-sub">Aguardando contagem</span>
            </div>
          </div>

          <!-- Action Buttons: [ Sincronizar monitorados ]           [ + Produto encontrado ] -->
          <div class="audit-actions-row">
            <div>
              <button type="button" id="auditSyncBtn" class="btn2" style="display: inline-flex; align-items: center; gap: 8px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Sincronizar monitorados</span>
              </button>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button type="button" id="auditAddFoundBtn" class="btn2" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>+ Produto encontrado</span>
              </button>

              <button type="button" id="auditCloseBtn" class="btn" style="display: inline-flex; align-items: center; gap: 6px; background: #16a34a;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span>Finalizar Auditoria</span>
              </button>

              <button type="button" id="auditReopenBtn" class="btn2" style="display: none; align-items: center; gap: 6px; color: #ea580c; border: 1px solid rgba(234,88,12,0.3);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                <span>Reabrir Auditoria (Admin)</span>
              </button>
            </div>
          </div>

          <!-- Search and Quick Filters: 🔎 Buscar produto...   [Todos] [Pendentes] [Apurados] [Sem motivo] -->
          <div class="audit-toolbar-row">
            <div class="audit-search-wrap">
              <input type="text" id="auditSearchInput" class="audit-input" style="width: 100%; padding-left: 36px;" placeholder="Buscar produto...">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted);">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>

            <div class="audit-filter-row">
              <button type="button" class="audit-filter-chip active" data-filter="all">Todos (<span id="countFilterAll">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="pending">Pendentes (<span id="countFilterPending">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="counted">Apurados (<span id="countFilterCounted">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="no_reason">Sem motivo (<span id="countFilterNoReason">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="loss">Com perda (<span id="countFilterLoss">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="monitored">Monitorados (<span id="countFilterMonitored">0</span>)</button>
              <button type="button" class="audit-filter-chip" data-filter="found">Encontrados (<span id="countFilterFound">0</span>)</button>
            </div>
          </div>

          <!-- PRODUTOS AUDITADOS Header -->
          <div class="audit-section-heading">PRODUTOS AUDITADOS</div>
          <div class="audit-table-header">
            <span>Foto</span>
            <span>Produto</span>
            <span>Validade</span>
            <span>Estoque SG</span>
            <span>Apurado</span>
            <span>Impacto</span>
            <span style="text-align: right;">Ação</span>
          </div>
        </div>

        <!-- Items Container -->
        <div id="auditItemsContainer" class="audit-items-list"></div>
      </div>
    </div>

    <!-- Modal 1: Apuração Física -->
    <div id="modalCount" class="audit-modal-overlay">
      <div class="audit-modal-panel">
        <div class="audit-modal-head">
          <h3 class="audit-modal-title">Apuração Física da Validade</h3>
          <button type="button" class="audit-modal-close" data-close-modal="count">&times;</button>
        </div>

        <div id="modalCountProductInfo" style="display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: 10px; background: rgba(148,163,184,0.08);">
          <div id="modalCountThumb" class="audit-item-thumb"></div>
          <div>
            <strong id="modalCountProdName" style="font-size: 15px; display: block; color: var(--text);"></strong>
            <small id="modalCountProdCodes" style="color: var(--muted); display: block; font-size: 12px; margin-top: 2px;"></small>
            <div style="display: flex; gap: 8px; margin-top: 4px; font-size: 12px;">
              <span id="modalCountExpiry" style="font-weight: 700; color: #dc2626;"></span>
              <span id="modalCountStockSnapshot" style="color: var(--muted);"></span>
              <span id="modalCountUnitCost" style="color: var(--muted);"></span>
            </div>
          </div>
        </div>

        <form id="formCountItem" style="display: flex; flex-direction: column; gap: 12px;">
          <input type="hidden" id="countItemId">

          <div>
            <label class="audit-field-label" for="countQuantityInput">Quantidade Vencida Auditada</label>
            <input type="number" id="countQuantityInput" class="audit-input" style="width: 100%;" min="0" step="1" placeholder="Ex: 0 para sem vencidos, 5 para unidades encontradas">
            <small style="color: var(--muted); font-size: 11px; margin-top: 4px; display: block; line-height: 1.3;">
              • <strong>Vazio:</strong> Mantém o produto como <em>Pendente</em> (ainda não apurado fisicamente).<br>
              • <strong>0:</strong> Confirma fisicamente que <strong>não havia unidades vencidas</strong> (sem perda).<br>
              • <strong>> 0:</strong> Quantidade de unidades efetivamente encontradas vencidas.
            </small>
          </div>

          <div>
            <label class="audit-field-label" for="countReasonSelect">Motivo da Ocorrência</label>
            <select id="countReasonSelect" class="audit-select" style="width: 100%;">
              <option value="Sem classificação">Sem classificação</option>
              <option value="Falha no PVPS">Falha no PVPS</option>
              <option value="Excesso de compra">Excesso de compra</option>
              <option value="Baixo giro">Baixo giro</option>
              <option value="Oferta tardia">Oferta tardia</option>
              <option value="Falha de acompanhamento">Falha de acompanhamento</option>
              <option value="Divergência de estoque">Divergência de estoque</option>
              <option value="Produto não cadastrado no Controle de Validades">Produto não cadastrado no Controle de Validades</option>
              <option value="Outro">Outro</option>
            </select>
          </div>

          <div id="countReasonOtherWrap" style="display: none;">
            <label class="audit-field-label" for="countReasonOtherInput">Descreva o Motivo</label>
            <input type="text" id="countReasonOtherInput" class="audit-input" style="width: 100%;" placeholder="Detalhes do motivo">
          </div>

          <div>
            <label class="audit-field-label" for="countActionInput">Ação Tomada</label>
            <input type="text" id="countActionInput" class="audit-input" style="width: 100%;" placeholder="Ex: Descarte imediato, Troca com fornecedor, etc.">
          </div>

          <div>
            <label class="audit-field-label" for="countNotesInput">Observações Complementares</label>
            <textarea id="countNotesInput" class="audit-input" style="width: 100%; min-height: 60px; font-family: inherit;" placeholder="Observações opcionais"></textarea>
          </div>

          <div id="modalCountError" style="display: none; padding: 8px 12px; border-radius: 8px; background: rgba(220,38,38,0.1); color: #dc2626; font-size: 13px;"></div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
            <button type="button" class="btn2" data-close-modal="count">Cancelar</button>
            <button type="submit" id="countSubmitBtn" class="btn">Salvar Apuração</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal 2: Adicionar Produto Encontrado na Auditoria -->
    <div id="modalAddFound" class="audit-modal-overlay">
      <div class="audit-modal-panel">
        <div class="audit-modal-head">
          <h3 class="audit-modal-title">Adicionar Produto Encontrado na Auditoria</h3>
          <button type="button" class="audit-modal-close" data-close-modal="found">&times;</button>
        </div>

        <p style="margin: 0; color: var(--muted); font-size: 13px;">
          Registre produtos vencidos encontrados na área de vendas ou estoque que não estavam monitorados previamente nesta competência.
        </p>

        <!-- Catalog Search Box -->
        <div style="padding: 12px; border-radius: 10px; background: rgba(0,217,255,0.04); border: 1px solid rgba(0,217,255,0.2);">
          <label class="audit-field-label" for="foundCatalogSearchInput">Buscar no Catálogo (Opcional)</label>
          <input type="text" id="foundCatalogSearchInput" class="audit-input" style="width: 100%; margin-top: 4px;" placeholder="Digite o nome, código interno ou código de barras...">
          <div id="foundCatalogResults" style="display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; margin-top: 6px;"></div>
          <div id="foundSelectedCatalogBox" style="display: none; align-items: center; justify-content: space-between; margin-top: 6px; padding: 6px 10px; border-radius: 6px; background: rgba(34,197,94,0.1); color: #16a34a; font-size: 12px; font-weight: 700;">
            <span id="foundSelectedCatalogName"></span>
            <button type="button" id="foundClearCatalogBtn" style="background: none; border: 0; color: #dc2626; cursor: pointer; font-weight: 800;">Limpar</button>
          </div>
        </div>

        <form id="formAddFoundItem" style="display: flex; flex-direction: column; gap: 12px;">
          <input type="hidden" id="foundCatalogId">

          <div>
            <label class="audit-field-label" for="foundProdNameInput">Nome do Produto *</label>
            <input type="text" id="foundProdNameInput" class="audit-input" style="width: 100%;" required placeholder="Nome descritivo do produto">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label class="audit-field-label" for="foundBarcodeInput">Código de Barras (EAN)</label>
              <input type="text" id="foundBarcodeInput" class="audit-input" style="width: 100%;" placeholder="EAN">
            </div>
            <div>
              <label class="audit-field-label" for="foundProductCodeInput">Código Interno</label>
              <input type="text" id="foundProductCodeInput" class="audit-input" style="width: 100%;" placeholder="Código">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label class="audit-field-label" for="foundExpiryDateInput">Data de Validade *</label>
              <input type="date" id="foundExpiryDateInput" class="audit-input" style="width: 100%;" required>
            </div>
            <div>
              <label class="audit-field-label" for="foundQuantityInput">Quantidade Auditada</label>
              <input type="number" id="foundQuantityInput" class="audit-input" style="width: 100%;" min="0" step="1" value="1">
            </div>
          </div>

          <div>
            <label class="audit-field-label" for="foundReasonSelect">Motivo da Ocorrência</label>
            <select id="foundReasonSelect" class="audit-select" style="width: 100%;">
              <option value="Produto não cadastrado no Controle de Validades" selected>Produto não cadastrado no Controle de Validades</option>
              <option value="Falha no PVPS">Falha no PVPS</option>
              <option value="Excesso de compra">Excesso de compra</option>
              <option value="Baixo giro">Baixo giro</option>
              <option value="Oferta tardia">Oferta tardia</option>
              <option value="Falha de acompanhamento">Falha de acompanhamento</option>
              <option value="Divergência de estoque">Divergência de estoque</option>
              <option value="Outro">Outro</option>
              <option value="Sem classificação">Sem classificação</option>
            </select>
          </div>

          <div id="foundReasonOtherWrap" style="display: none;">
            <label class="audit-field-label" for="foundReasonOtherInput">Descreva o Motivo</label>
            <input type="text" id="foundReasonOtherInput" class="audit-input" style="width: 100%;" placeholder="Detalhes do motivo">
          </div>

          <div>
            <label class="audit-field-label" for="foundActionInput">Ação Tomada</label>
            <input type="text" id="foundActionInput" class="audit-input" style="width: 100%;" placeholder="Ex: Descarte imediato, Troca com fornecedor">
          </div>

          <div>
            <label class="audit-field-label" for="foundNotesInput">Observações</label>
            <textarea id="foundNotesInput" class="audit-input" style="width: 100%; min-height: 50px; font-family: inherit;" placeholder="Observações opcionais"></textarea>
          </div>

          <div id="modalFoundError" style="display: none; padding: 8px 12px; border-radius: 8px; background: rgba(220,38,38,0.1); color: #dc2626; font-size: 13px;"></div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
            <button type="button" class="btn2" data-close-modal="found">Cancelar</button>
            <button type="submit" id="foundSubmitBtn" class="btn">Adicionar à Auditoria</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Place panel in DOM if not already present
  if (!panel.parentElement) {
    const reportSection = document.getElementById('report') || document.getElementById('products');
    if (reportSection) {
      reportSection.after(panel);
    } else {
      document.body.append(panel);
    }
  }

  // DOM Elements references
  const roleBadge = panel.querySelector('#auditRoleBadge');
  const storeSelect = panel.querySelector('#auditStoreSelect');
  const monthInput = panel.querySelector('#auditMonthInput');
  const loadBtn = panel.querySelector('#auditLoadBtn');
  const workspace = panel.querySelector('#auditWorkspace');
  const storeTitle = panel.querySelector('#auditStoreTitle');
  const statusTag = panel.querySelector('#auditStatusTag');
  const competenceLabel = panel.querySelector('#auditCompetenceLabel');
  const syncBtn = panel.querySelector('#auditSyncBtn');
  const addFoundBtn = panel.querySelector('#auditAddFoundBtn');
  const closeBtn = panel.querySelector('#auditCloseBtn');
  const reopenBtn = panel.querySelector('#auditReopenBtn');
  const completedNotice = panel.querySelector('#auditCompletedNotice');

  // KPI elements
  const kpiTotal = panel.querySelector('#kpiTotalItems');
  const kpiPending = panel.querySelector('#kpiPendingItems');
  const kpiLossUnits = panel.querySelector('#kpiLossUnits');
  const kpiCounted = panel.querySelector('#kpiCountedItems');
  const kpiCountedSub = panel.querySelector('#kpiCountedSub');
  const kpiFinancial = panel.querySelector('#kpiFinancialCost');
  const kpiSalesLossSub = panel.querySelector('#kpiSalesLossSub');

  // Filter chips & search
  const searchInput = panel.querySelector('#auditSearchInput');
  const itemsContainer = panel.querySelector('#auditItemsContainer');
  const filterChips = panel.querySelectorAll('.audit-filter-chip');
  const countAll = panel.querySelector('#countFilterAll');
  const countPending = panel.querySelector('#countFilterPending');
  const countFilterCounted = panel.querySelector('#countFilterCounted');
  const countFilterNoReason = panel.querySelector('#countFilterNoReason');
  const countLoss = panel.querySelector('#countFilterLoss');
  const countNoLoss = panel.querySelector('#countFilterNoLoss');
  const countMonitored = panel.querySelector('#countFilterMonitored');
  const countFound = panel.querySelector('#countFilterFound');

  // Modal 1 elements
  const modalCount = panel.querySelector('#modalCount');
  const formCount = panel.querySelector('#formCountItem');
  const countItemId = panel.querySelector('#countItemId');
  const countQty = panel.querySelector('#countQuantityInput');
  const countReason = panel.querySelector('#countReasonSelect');
  const countReasonOtherWrap = panel.querySelector('#countReasonOtherWrap');
  const countReasonOther = panel.querySelector('#countReasonOtherInput');
  const countAction = panel.querySelector('#countActionInput');
  const countNotes = panel.querySelector('#countNotesInput');
  const countError = panel.querySelector('#modalCountError');
  const countSubmitBtn = panel.querySelector('#countSubmitBtn');
  const countThumb = panel.querySelector('#modalCountThumb');
  const countProdName = panel.querySelector('#modalCountProdName');
  const countProdCodes = panel.querySelector('#modalCountProdCodes');
  const countExpiry = panel.querySelector('#modalCountExpiry');
  const countStockSnapshot = panel.querySelector('#modalCountStockSnapshot');
  const countUnitCost = panel.querySelector('#modalCountUnitCost');

  // Modal 2 elements
  const modalAddFound = panel.querySelector('#modalAddFound');
  const formAddFound = panel.querySelector('#formAddFoundItem');
  const foundCatalogSearch = panel.querySelector('#foundCatalogSearchInput');
  const foundCatalogResults = panel.querySelector('#foundCatalogResults');
  const foundSelectedBox = panel.querySelector('#foundSelectedCatalogBox');
  const foundSelectedName = panel.querySelector('#foundSelectedCatalogName');
  const foundClearCatalog = panel.querySelector('#foundClearCatalogBtn');
  const foundCatalogId = panel.querySelector('#foundCatalogId');
  const foundProdName = panel.querySelector('#foundProdNameInput');
  const foundBarcode = panel.querySelector('#foundBarcodeInput');
  const foundProductCode = panel.querySelector('#foundProductCodeInput');
  const foundExpiryDate = panel.querySelector('#foundExpiryDateInput');
  const foundQty = panel.querySelector('#foundQuantityInput');
  const foundReason = panel.querySelector('#foundReasonSelect');
  const foundReasonOtherWrap = panel.querySelector('#foundReasonOtherWrap');
  const foundReasonOther = panel.querySelector('#foundReasonOtherInput');
  const foundAction = panel.querySelector('#foundActionInput');
  const foundNotes = panel.querySelector('#foundNotesInput');
  const foundError = panel.querySelector('#modalFoundError');
  const foundSubmitBtn = panel.querySelector('#foundSubmitBtn');

  // Reason conditional inputs
  countReason.addEventListener('change', () => {
    countReasonOtherWrap.style.display = countReason.value === 'Outro' ? 'block' : 'none';
  });

  foundReason.addEventListener('change', () => {
    foundReasonOtherWrap.style.display = foundReason.value === 'Outro' ? 'block' : 'none';
  });

  // Modal close handlers
  panel.querySelectorAll('[data-close-modal="count"]').forEach(btn => {
    btn.addEventListener('click', () => { modalCount.classList.remove('show'); });
  });

  panel.querySelectorAll('[data-close-modal="found"]').forEach(btn => {
    btn.addEventListener('click', () => { modalAddFound.classList.remove('show'); });
  });

  [modalCount, modalAddFound].forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('show');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalCount.classList.remove('show');
      modalAddFound.classList.remove('show');
    }
  });

  // Filters
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter || 'all';
      renderItems();
    });
  });

  searchInput.addEventListener('input', () => {
    currentSearch = String(searchInput.value || '').trim().toLowerCase();
    renderItems();
  });

  // Catalog live search in Add Found Modal
  let searchDebounce = null;
  foundCatalogSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const query = String(foundCatalogSearch.value || '').trim();
    if (!query) {
      foundCatalogResults.replaceChildren();
      return;
    }
    searchDebounce = setTimeout(async () => {
      try {
        if (!window.skaleeDb?.searchCatalogProducts) return;
        const products = await window.skaleeDb.searchCatalogProducts(query);
        foundCatalogResults.replaceChildren(...products.slice(0, 8).map(prod => {
          const item = document.createElement('div');
          item.style.padding = '6px 10px';
          item.style.borderRadius = '6px';
          item.style.background = 'rgba(148,163,184,0.08)';
          item.style.cursor = 'pointer';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.fontSize = '12px';
          item.innerHTML = `
            <div>
              <strong>${prod.name}</strong>
              <small style="display:block; color:var(--muted);">${prod.internal_code ? `Cód: ${prod.internal_code} • ` : ''}${prod.barcode || ''}</small>
            </div>
            <span style="color:var(--blue); font-weight:700;">Selecionar</span>
          `;
          item.addEventListener('click', () => {
            foundCatalogId.value = prod.id;
            foundProdName.value = prod.name;
            foundBarcode.value = prod.barcode || '';
            foundProductCode.value = prod.internal_code || '';
            foundSelectedName.textContent = `Catálogo: ${prod.name} (${prod.internal_code || prod.barcode || 'ID'})`;
            foundSelectedBox.style.display = 'flex';
            foundCatalogResults.replaceChildren();
            foundCatalogSearch.value = '';
          });
          return item;
        }));
      } catch (err) {
        console.error('Erro na busca de catálogo:', err);
      }
    }, 280);
  });

  foundClearCatalog.addEventListener('click', () => {
    foundCatalogId.value = '';
    foundSelectedBox.style.display = 'none';
  });

  // Clear state
  function clear() {
    context = null;
    currentAudit = null;
    auditItems = [];
    workspace.style.display = 'none';
    tab.hidden = true;
    panel.hidden = true;
    storeSelect.replaceChildren();
    roleBadge.textContent = '';
    roleBadge.style.display = 'none';
    const statusMsg = panel.querySelector('#auditStatusMsg');
    const locationsList = panel.querySelector('#auditLocationsList');
    if (statusMsg) statusMsg.textContent = '';
    if (locationsList) locationsList.replaceChildren();
    document.querySelectorAll('[data-audit-editor]').forEach(el => el.remove());
    if (panel.classList.contains('active')) {
      panel.classList.remove('active');
      tab.classList.remove('active');
      tab.removeAttribute('aria-current');
      document.querySelector('[data-page="products"]')?.click();
    }
  }

  // Apply audit access context and populate stores
  function applyAuditContext(result) {
    if (!result || !result.can_access_audit) {
      clear();
      return null;
    }

    context = result;
    signedIn = true;
    tab.hidden = false;
    roleBadge.style.display = 'inline-block';
    if (result.is_admin) {
      roleBadge.textContent = 'Administrador';
      roleBadge.style.background = 'rgba(0,217,255,0.12)';
      roleBadge.style.color = 'var(--sk-cyan, #00d9ff)';
      roleBadge.style.border = '1px solid rgba(0,217,255,0.3)';
    } else {
      roleBadge.textContent = 'Responsável pela Auditoria';
      roleBadge.style.background = 'rgba(34,197,94,0.12)';
      roleBadge.style.color = '#22c55e';
      roleBadge.style.border = '1px solid rgba(34,197,94,0.3)';
    }

    // Active locations:
    // platform_admin receives all active retail locations
    // audit_responsible receives assigned active retail locations
    const allLocations = Array.isArray(result.locations) ? result.locations : [];
    const activeLocations = allLocations.filter(loc => loc.active !== false);

    const statusMsg = panel.querySelector('#auditStatusMsg');
    const locationsList = panel.querySelector('#auditLocationsList');
    if (statusMsg) {
      statusMsg.textContent = result.is_admin
        ? 'Acesso total de Administrador: todas as lojas estão autorizadas.'
        : `Você possui autorização para auditar ${activeLocations.length} loja(s).`;
    }
    if (locationsList) {
      locationsList.replaceChildren(...activeLocations.map(loc => {
        const item = document.createElement('div');
        item.className = 'user-location-check';
        item.textContent = loc.name;
        return item;
      }));
    }

    const currentSelected = storeSelect.value;
    storeSelect.replaceChildren(...activeLocations.map(loc => {
      const opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = loc.name;
      return opt;
    }));

    if (currentSelected && activeLocations.some(l => l.id === currentSelected)) {
      storeSelect.value = currentSelected;
    } else if (activeLocations.length > 0) {
      storeSelect.value = activeLocations[0].id;
    }
    selectedLocationId = storeSelect.value;

    // Default competence month if empty
    if (!monthInput.value) {
      monthInput.value = getCurrentCompetenceMonth();
    }
    selectedCompetence = monthInput.value;

    return result;
  }

  // Refresh authorization (deduplicated against reentrancy)
  let inFlightRefreshPromise = null;

  async function refresh() {
    if (inFlightRefreshPromise) return inFlightRefreshPromise;
    if (!navigator.onLine || !window.skaleeDb?.loadAuditAccessContext) {
      if (!signedIn) clear();
      return null;
    }

    inFlightRefreshPromise = (async () => {
      try {
        const result = await window.skaleeDb.loadAuditAccessContext();
        if (!result) {
          clear();
          return null;
        }
        return applyAuditContext(result);
      } catch (err) {
        console.error('Erro ao carregar contexto de auditoria:', err);
        return null;
      } finally {
        inFlightRefreshPromise = null;
      }
    })();

    return inFlightRefreshPromise;
  }

  // Load audit data with latest-wins semantics
  let activeAuditReqId = 0;

  async function loadAudit(showFeedback = true) {
    if (storeSelect.value) selectedLocationId = storeSelect.value;
    if (monthInput.value) selectedCompetence = monthInput.value;
    if (!selectedLocationId || !selectedCompetence) return;

    const currentReqId = ++activeAuditReqId;
    loadBtn.disabled = true;
    const btnSpan = loadBtn.querySelector('span');
    const originalText = btnSpan ? btnSpan.textContent : 'Abrir';
    if (btnSpan) btnSpan.textContent = 'Abrindo...';

    try {
      const competenceDate = `${selectedCompetence}-01`;
      const audit = await window.skaleeDb.createOrGetMonthlyAudit(selectedLocationId, competenceDate);
      if (currentReqId !== activeAuditReqId) return;

      currentAudit = audit;
      const items = await window.skaleeDb.listAuditItems(audit.id);
      if (currentReqId !== activeAuditReqId) return;

      auditItems = items || [];
      renderAuditWorkspace();
    } catch (err) {
      if (currentReqId === activeAuditReqId) {
        console.error('Erro ao carregar auditoria:', err);
        if (showFeedback) alert(err.message || 'Erro ao carregar auditoria.');
      }
    } finally {
      if (currentReqId === activeAuditReqId) {
        loadBtn.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
      }
    }
  }

  // Render workspace
  function renderAuditWorkspace() {
    if (!currentAudit) {
      workspace.style.display = 'none';
      return;
    }

    workspace.style.display = 'flex';
    const store = (context?.locations || []).find(l => l.id === currentAudit.retail_location_id);
    const storeName = store ? store.name : (storeSelect.selectedOptions[0]?.textContent || 'Loja');
    const compFormatted = formatCompetence(currentAudit.competence_month);

    storeTitle.textContent = `Auditoria • ${storeName} • ${compFormatted}`;
    if (competenceLabel) competenceLabel.textContent = `Competência: ${compFormatted}`;

    // Status tag
    statusTag.className = 'audit-status-tag';
    if (currentAudit.status === 'completed') {
      statusTag.textContent = '● Finalizada';
      statusTag.classList.add('status-tag-completed');
      completedNotice.style.display = 'block';
      closeBtn.style.display = 'none';
      syncBtn.disabled = true;
      addFoundBtn.disabled = true;
      if (context.is_admin) {
        reopenBtn.style.display = 'inline-flex';
      } else {
        reopenBtn.style.display = 'none';
      }
    } else if (currentAudit.status === 'ready_for_review') {
      statusTag.textContent = '● Pronta para Fechamento';
      statusTag.classList.add('status-tag-ready');
      completedNotice.style.display = 'none';
      closeBtn.style.display = 'inline-flex';
      reopenBtn.style.display = 'none';
      syncBtn.disabled = false;
      addFoundBtn.disabled = false;
    } else {
      statusTag.textContent = '● Em andamento';
      statusTag.classList.add('status-tag-open');
      completedNotice.style.display = 'none';
      closeBtn.style.display = 'inline-flex';
      reopenBtn.style.display = 'none';
      syncBtn.disabled = false;
      addFoundBtn.disabled = false;
    }

    updateKPIs();
    renderItems();
  }

  function updateKPIs() {
    const total = auditItems.length;
    let pending = 0;
    let counted = 0;
    let lossCount = 0;
    let noLossCount = 0;
    let foundCount = 0;
    let totalLossUnits = 0;
    let noReasonCount = 0;
    let totalCostImpact = 0;
    let totalSalesLoss = 0;

    auditItems.forEach(item => {
      if (item.source_type === 'audit_found') foundCount++;
      if (item.quantity_audited === null || item.item_status === 'pending') {
        pending++;
      } else {
        counted++;
        const qty = Number(item.quantity_audited || 0);
        if (qty > 0) {
          lossCount++;
          totalLossUnits += qty;

          const reason = String(item.expiry_reason || '').trim();
          const isUnclassified = !reason || reason === 'Sem classificação' || (reason === 'Outro' && !item.expiry_reason_other?.trim());
          if (isUnclassified) {
            noReasonCount++;
          }

          if (item.financial_cost_impact !== null && item.financial_cost_impact !== undefined) {
            totalCostImpact += Number(item.financial_cost_impact);
          }
          if (item.potential_sales_loss !== null && item.potential_sales_loss !== undefined) {
            totalSalesLoss += Number(item.potential_sales_loss);
          }
        } else {
          noLossCount++;
        }
      }
    });

    kpiTotal.textContent = total;
    if (kpiLossUnits) kpiLossUnits.textContent = `${totalLossUnits} un.`;
    if (kpiCounted) kpiCounted.textContent = counted;
    if (kpiCountedSub) kpiCountedSub.textContent = `${lossCount} com perda • ${noLossCount} sem perda`;
    kpiFinancial.textContent = formatCurrency(totalCostImpact);
    if (kpiSalesLossSub) kpiSalesLossSub.textContent = `Venda potencial: ${formatCurrency(totalSalesLoss)}`;
    kpiPending.textContent = pending;

    if (countAll) countAll.textContent = total;
    if (countPending) countPending.textContent = pending;
    if (countFilterCounted) countFilterCounted.textContent = counted;
    if (countFilterNoReason) countFilterNoReason.textContent = noReasonCount;
    if (countLoss) countLoss.textContent = lossCount;
    if (countNoLoss) countNoLoss.textContent = noLossCount;
    if (countMonitored) countMonitored.textContent = total - foundCount;
    if (countFound) countFound.textContent = foundCount;
  }

  function renderItems() {
    itemsContainer.replaceChildren();

    const filtered = auditItems.filter(item => {
      // Filters
      if (currentFilter === 'pending') {
        if (item.quantity_audited !== null && item.item_status !== 'pending') return false;
      } else if (currentFilter === 'counted') {
        if (item.quantity_audited === null || item.item_status === 'pending') return false;
      } else if (currentFilter === 'no_reason') {
        const qty = Number(item.quantity_audited || 0);
        if (qty <= 0) return false;
        const reason = String(item.expiry_reason || '').trim();
        const isUnclassified = !reason || reason === 'Sem classificação' || (reason === 'Outro' && !item.expiry_reason_other?.trim());
        if (!isUnclassified) return false;
      } else if (currentFilter === 'loss') {
        if (!(Number(item.quantity_audited) > 0)) return false;
      } else if (currentFilter === 'no_loss') {
        if (!(Number(item.quantity_audited) === 0)) return false;
      } else if (currentFilter === 'monitored') {
        if (item.source_type === 'audit_found') return false;
      } else if (currentFilter === 'found') {
        if (item.source_type !== 'audit_found') return false;
      }

      // Search query
      if (currentSearch) {
        const name = String(item.product_name || '').toLowerCase();
        const code = String(item.product_code || '').toLowerCase();
        const barcode = String(item.barcode || '').toLowerCase();
        const reason = String(item.expiry_reason || '').toLowerCase();
        if (!name.includes(currentSearch) && !code.includes(currentSearch) && !barcode.includes(currentSearch) && !reason.includes(currentSearch)) {
          return false;
        }
      }
      return true;
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'audit-empty-state';
      empty.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <strong style="font-size: 15px;">Nenhum produto encontrado neste filtro</strong>
        <span style="font-size: 13px;">${auditItems.length === 0 ? 'Clique em "Sincronizar monitorados" para carregar os produtos do mês ou adicione produtos encontrados.' : 'Tente ajustar os filtros ou a busca acima.'}</span>
      `;
      itemsContainer.append(empty);
      return;
    }

    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'audit-item-row';

      const isCounted = item.quantity_audited !== null && item.item_status !== 'pending';
      const qtyAudited = Number(item.quantity_audited);
      const hasLoss = isCounted && qtyAudited > 0;
      const isZeroLoss = isCounted && qtyAudited === 0;

      // Col 1: Foto Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'audit-item-thumb';
      if (item.photo_path && window.skaleeDb?.getProductPhotoUrl) {
        window.skaleeDb.getProductPhotoUrl(item.photo_path).then(url => {
          if (url) {
            thumb.innerHTML = `<img src="${url}" alt="${escapeHtml(item.product_name)}" loading="lazy">`;
          } else {
            thumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
          }
        }).catch(() => {
          thumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        });
      } else {
        thumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      }

      // Col 2: Produto
      const idCol = document.createElement('div');
      idCol.style.display = 'flex';
      idCol.style.flexDirection = 'column';
      idCol.style.gap = '3px';

      const badgesRow = document.createElement('div');
      badgesRow.style.display = 'flex';
      badgesRow.style.gap = '6px';
      badgesRow.style.flexWrap = 'wrap';

      const sourceBadge = document.createElement('span');
      sourceBadge.className = `audit-badge ${item.source_type === 'monitored' ? 'badge-monitored' : 'badge-found'}`;
      sourceBadge.textContent = item.source_type === 'monitored' ? 'Monitorado' : 'Encontrado na Auditoria';

      const statusBadge = document.createElement('span');
      statusBadge.className = `audit-badge ${isCounted ? 'badge-counted' : 'badge-pending'}`;
      statusBadge.textContent = isCounted ? 'Apurado' : 'Pendente';

      badgesRow.append(sourceBadge, statusBadge);

      const nameLabel = document.createElement('strong');
      nameLabel.style.fontSize = '14px';
      nameLabel.style.color = 'var(--text)';
      nameLabel.textContent = item.product_name;

      const codeLabel = document.createElement('small');
      codeLabel.style.color = 'var(--muted)';
      codeLabel.style.fontSize = '12px';
      codeLabel.textContent = `${item.product_code ? `Cód: ${item.product_code} • ` : ''}${item.barcode ? `EAN: ${item.barcode}` : ''}`;

      idCol.append(badgesRow, nameLabel, codeLabel);

      // Motivo line
      if (hasLoss) {
        const reasonText = item.expiry_reason === 'Outro' && item.expiry_reason_other
          ? item.expiry_reason_other
          : (item.expiry_reason || 'Sem classificação');
        const isUnclassified = !item.expiry_reason || item.expiry_reason === 'Sem classificação';
        const reasonDiv = document.createElement('div');
        reasonDiv.style.fontSize = '11px';
        reasonDiv.style.fontWeight = '600';
        reasonDiv.style.marginTop = '2px';
        reasonDiv.style.display = 'flex';
        reasonDiv.style.alignItems = 'center';
        reasonDiv.style.gap = '4px';
        reasonDiv.style.color = isUnclassified ? '#ea580c' : 'var(--muted)';
        reasonDiv.innerHTML = `<span style="color:var(--muted); font-weight:500;">Motivo:</span> <span>${escapeHtml(reasonText)}</span>`;
        idCol.append(reasonDiv);
      } else if (isZeroLoss) {
        const okDiv = document.createElement('div');
        okDiv.style.fontSize = '11px';
        okDiv.style.fontWeight = '600';
        okDiv.style.color = '#16a34a';
        okDiv.style.marginTop = '2px';
        okDiv.textContent = 'Sem unidades vencidas';
        idCol.append(okDiv);
      }

      // Mobile summary container (only visible on <= 900px)
      const mobileSummary = document.createElement('div');
      mobileSummary.className = 'audit-col-mobile';
      mobileSummary.style.display = 'none';
      mobileSummary.style.flexWrap = 'wrap';
      mobileSummary.style.gap = '8px';
      mobileSummary.style.marginTop = '6px';
      mobileSummary.style.fontSize = '12px';
      mobileSummary.style.paddingTop = '6px';
      mobileSummary.style.borderTop = '1px dashed var(--line, #cbd5e1)';
      mobileSummary.innerHTML = `
        <span>Val: <strong style="color: #dc2626;">${formatDateShort(item.expiry_date)}</strong></span>
        <span>SG: <strong>${item.stock_quantity_snapshot !== null && item.stock_quantity_snapshot !== undefined ? `${item.stock_quantity_snapshot}` : '—'}</strong></span>
        <span>Apurado: <strong style="color: ${hasLoss ? '#dc2626' : (isZeroLoss ? '#16a34a' : 'var(--muted)')};">${isCounted ? `${qtyAudited} un.` : 'Pendente'}</strong></span>
        <span>Impacto: <strong style="color: ${Number(item.financial_cost_impact) > 0 ? '#dc2626' : 'var(--muted)'};">${formatCurrency(item.financial_cost_impact)}</strong></span>
      `;
      idCol.append(mobileSummary);

      // Col 3: Validade
      const valCol = document.createElement('div');
      valCol.className = 'audit-col-desktop';
      valCol.style.fontSize = '13px';
      valCol.style.fontWeight = '700';
      valCol.style.color = '#dc2626';
      valCol.textContent = formatDateShort(item.expiry_date);

      // Col 4: Estoque SG
      const sgCol = document.createElement('div');
      sgCol.className = 'audit-col-desktop';
      sgCol.style.fontSize = '13px';
      sgCol.style.fontWeight = '700';
      sgCol.style.color = 'var(--text)';
      sgCol.textContent = item.stock_quantity_snapshot !== null && item.stock_quantity_snapshot !== undefined ? String(item.stock_quantity_snapshot) : '—';

      // Col 5: Apurado
      const countCol = document.createElement('div');
      countCol.className = 'audit-col-desktop';
      countCol.style.fontSize = '13px';
      countCol.style.fontWeight = '700';
      if (!isCounted) {
        countCol.innerHTML = `<span style="color: var(--muted); font-weight: 600;">Pendente</span>`;
      } else if (isZeroLoss) {
        countCol.innerHTML = `<span style="color: #16a34a;">0 un.</span>`;
      } else {
        countCol.innerHTML = `<span style="color: #dc2626; font-weight: 800;">${qtyAudited} un.</span>`;
      }

      // Col 6: Impacto
      const finCol = document.createElement('div');
      finCol.className = 'audit-col-desktop';
      finCol.style.fontSize = '13px';
      finCol.style.fontWeight = '700';
      if (Number(item.financial_cost_impact) > 0) {
        finCol.innerHTML = `<span style="color: #dc2626; font-weight: 800;">${formatCurrency(item.financial_cost_impact)}</span>`;
      } else if (isZeroLoss) {
        finCol.innerHTML = `<span style="color: #16a34a; font-weight: 600;">R$ 0,00</span>`;
      } else {
        finCol.innerHTML = `<span style="color: var(--muted);">—</span>`;
      }

      // Col 7: Ação (Botão)
      const actionCol = document.createElement('div');
      actionCol.style.display = 'flex';
      actionCol.style.justifyContent = 'flex-end';

      const countBtn = document.createElement('button');
      countBtn.type = 'button';
      countBtn.className = isCounted ? 'btn2' : 'btn';
      countBtn.style.minHeight = '36px';
      countBtn.style.padding = '6px 12px';
      countBtn.style.fontSize = '12px';
      countBtn.style.fontWeight = '700';
      countBtn.style.whiteSpace = 'nowrap';
      countBtn.textContent = isCounted ? 'Editar apuração' : 'Apurar';
      if (currentAudit.status === 'completed') {
        countBtn.disabled = true;
        countBtn.title = 'Auditoria finalizada. Reabra para editar.';
      }
      countBtn.addEventListener('click', () => openCountModal(item));
      actionCol.append(countBtn);

      row.append(thumb, idCol, valCol, sgCol, countCol, finCol, actionCol);
      itemsContainer.append(row);
    });
  }

  // Open Count Modal
  function openCountModal(item) {
    countItemId.value = item.id;
    countError.style.display = 'none';
    countError.textContent = '';

    countProdName.textContent = item.product_name;
    countProdCodes.textContent = `${item.product_code ? `Cód: ${item.product_code} • ` : ''}${item.barcode ? `EAN: ${item.barcode}` : ''}`;
    countExpiry.textContent = `Validade: ${formatDate(item.expiry_date)}`;
    countStockSnapshot.textContent = `• SG: ${item.stock_quantity_snapshot !== null && item.stock_quantity_snapshot !== undefined ? `${item.stock_quantity_snapshot} un` : '—'}`;
    countUnitCost.textContent = `• Custo: ${formatCurrency(item.unit_cost_snapshot)}`;

    if (item.photo_path && window.skaleeDb?.getProductPhotoUrl) {
      window.skaleeDb.getProductPhotoUrl(item.photo_path).then(url => {
        countThumb.innerHTML = url ? `<img src="${url}" alt="">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      }).catch(() => {
        countThumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      });
    } else {
      countThumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:24px; height:24px; color:var(--muted);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    }

    countQty.value = item.quantity_audited !== null && item.quantity_audited !== undefined ? item.quantity_audited : '';
    countReason.value = item.expiry_reason || 'Sem classificação';
    countReasonOther.value = item.expiry_reason_other || '';
    countReasonOtherWrap.style.display = countReason.value === 'Outro' ? 'block' : 'none';
    countAction.value = item.action_taken || '';
    countNotes.value = item.notes || '';

    modalCount.classList.add('show');
    countQty.focus();
  }

  // Handle Save Physical Count Form
  formCount.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = countItemId.value;
    if (!itemId) return;

    countError.style.display = 'none';
    countSubmitBtn.disabled = true;
    countSubmitBtn.textContent = 'Salvando...';

    try {
      const rawQty = countQty.value.trim();
      const quantityAudited = rawQty === '' ? null : Number(rawQty);

      const payload = {
        quantityAudited,
        expiryReason: countReason.value,
        expiryReasonOther: countReason.value === 'Outro' ? countReasonOther.value.trim() : null,
        actionTaken: countAction.value.trim() || null,
        notes: countNotes.value.trim() || null
      };

      const updated = await window.skaleeDb.recordAuditItemCount(itemId, payload);
      
      // Update locally
      const idx = auditItems.findIndex(i => i.id === itemId);
      if (idx !== -1) {
        auditItems[idx] = { ...auditItems[idx], ...updated };
      }

      modalCount.classList.remove('show');
      updateKPIs();
      renderItems();
    } catch (err) {
      console.error('Erro ao salvar apuração:', err);
      countError.textContent = err.message || 'Erro ao registrar apuração.';
      countError.style.display = 'block';
    } finally {
      countSubmitBtn.disabled = false;
      countSubmitBtn.textContent = 'Salvar Apuração';
    }
  });

  // Handle Add Found Item Form
  formAddFound.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentAudit) return;

    foundError.style.display = 'none';
    foundSubmitBtn.disabled = true;
    foundSubmitBtn.textContent = 'Adicionando...';

    try {
      const rawQty = foundQty.value.trim();
      const quantityAudited = rawQty === '' ? null : Number(rawQty);

      const payload = {
        expiryDate: foundExpiryDate.value,
        quantityAudited,
        catalogProductId: foundCatalogId.value || null,
        productName: foundProdName.value.trim(),
        barcode: foundBarcode.value.trim() || null,
        productCode: foundProductCode.value.trim() || null,
        expiryReason: foundReason.value,
        expiryReasonOther: foundReason.value === 'Outro' ? foundReasonOther.value.trim() : null,
        actionTaken: foundAction.value.trim() || null,
        notes: foundNotes.value.trim() || null
      };

      const newItem = await window.skaleeDb.addAuditFoundItem(currentAudit.id, payload);
      auditItems.unshift(newItem);

      modalAddFound.classList.remove('show');
      formAddFound.reset();
      foundCatalogId.value = '';
      foundSelectedBox.style.display = 'none';
      foundReasonOtherWrap.style.display = 'none';

      updateKPIs();
      renderItems();
    } catch (err) {
      console.error('Erro ao adicionar produto encontrado:', err);
      foundError.textContent = err.message || 'Erro ao adicionar item.';
      foundError.style.display = 'block';
    } finally {
      foundSubmitBtn.disabled = false;
      foundSubmitBtn.textContent = 'Adicionar à Auditoria';
    }
  });

  // Sync Monitored Items
  syncBtn.addEventListener('click', async () => {
    if (!currentAudit || isSyncingItems) return;
    isSyncingItems = true;
    syncBtn.disabled = true;
    const originalText = syncBtn.querySelector('span').textContent;
    syncBtn.querySelector('span').textContent = 'Sincronizando...';

    try {
      const syncResult = await window.skaleeDb.syncMonitoredAuditItems(currentAudit.id);
      const syncedCount = typeof syncResult === 'object' && syncResult !== null && 'synced_count' in syncResult
        ? syncResult.synced_count
        : syncResult;
      // Reload items to capture newly inserted items
      const items = await window.skaleeDb.listAuditItems(currentAudit.id);
      auditItems = items;
      updateKPIs();
      renderItems();
      alert(`Sincronização concluída! ${syncedCount} novo(s) produto(s) monitorado(s) adicionado(s) à auditoria.`);
    } catch (err) {
      console.error('Erro ao sincronizar monitorados:', err);
      alert(err.message || 'Erro ao sincronizar produtos monitorados.');
    } finally {
      isSyncingItems = false;
      syncBtn.disabled = false;
      syncBtn.querySelector('span').textContent = originalText;
    }
  });

  // Add Found Button handler
  addFoundBtn.addEventListener('click', () => {
    formAddFound.reset();
    foundCatalogId.value = '';
    foundSelectedBox.style.display = 'none';
    foundCatalogResults.replaceChildren();
    foundReasonOtherWrap.style.display = 'none';
    foundError.style.display = 'none';
    modalAddFound.classList.add('show');
    foundProdName.focus();
  });

  // Close Audit
  closeBtn.addEventListener('click', async () => {
    if (!currentAudit) return;
    const pendingCount = auditItems.filter(i => i.quantity_audited === null && i.item_status === 'pending').length;
    let msg = 'Deseja finalizar esta auditoria mensal?';
    if (pendingCount > 0) {
      msg += `\n\nAtenção: Ainda existem ${pendingCount} produto(s) com contagem pendente. Após a finalização, a auditoria torna-se imutável.`;
    }
    if (!confirm(msg)) return;

    closeBtn.disabled = true;
    try {
      const closed = await window.skaleeDb.closeValidityAudit(currentAudit.id);
      currentAudit = closed;
      renderAuditWorkspace();
      alert('Auditoria finalizada com sucesso! Seus dados foram congelados como histórico oficial.');
    } catch (err) {
      console.error('Erro ao finalizar auditoria:', err);
      alert(err.message || 'Erro ao finalizar auditoria.');
    } finally {
      closeBtn.disabled = false;
    }
  });

  // Reopen Audit (Admin only)
  reopenBtn.addEventListener('click', async () => {
    if (!currentAudit) return;
    if (!confirm('Deseja reabrir esta auditoria? A edição de contagens e itens será restaurada para os responsáveis autorizados.')) return;

    reopenBtn.disabled = true;
    try {
      const reopened = await window.skaleeDb.reopenValidityAudit(currentAudit.id);
      currentAudit = reopened;
      renderAuditWorkspace();
      alert('Auditoria reaberta com sucesso! Edições liberadas.');
    } catch (err) {
      console.error('Erro ao reabrir auditoria:', err);
      alert(err.message || 'Erro ao reabrir auditoria.');
    } finally {
      reopenBtn.disabled = false;
    }
  });

  // Selectors event listeners
  storeSelect.addEventListener('change', () => {
    selectedLocationId = storeSelect.value;
    void loadAudit(false);
  });

  monthInput.addEventListener('change', () => {
    selectedCompetence = monthInput.value;
    void loadAudit(false);
  });

  loadBtn.addEventListener('click', () => {
    selectedLocationId = storeSelect.value;
    selectedCompetence = monthInput.value;
    void loadAudit(true);
  });

  // Open Tab
  async function open() {
    let result = context;
    if (!result || !selectedLocationId) {
      result = await refresh();
    }
    if (!result || !result.can_access_audit) {
      if (location.hash === '#audit') {
        history.replaceState(null, '', location.pathname + location.search);
      }
      return;
    }

    if (location.hash !== '#audit') {
      history.replaceState(null, '', '#audit');
    }

    document.querySelectorAll('nav .tab').forEach(el => {
      el.classList.remove('active');
      el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

    panel.hidden = false;
    panel.classList.add('active');
    tab.classList.add('active');
    tab.setAttribute('aria-current', 'page');

    // Auto-load audit
    if (selectedLocationId && selectedCompetence && !currentAudit) {
      void loadAudit(false);
    }
  }

  tab.addEventListener('click', () => { void open(); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#audit') void open();
  });

  // Clear #audit from hash when user clicks on any other nav tab
  document.querySelectorAll('nav .tab:not([data-page="audit"])').forEach(otherTab => {
    otherTab.addEventListener('click', () => {
      if (location.hash === '#audit') {
        history.replaceState(null, '', location.pathname + location.search);
      }
    });
  });

  window.addEventListener('skalee:authenticated', (event) => {
    signedIn = true;
    if (event?.detail?.accessRole === 'platform_admin') {
      tab.hidden = false;
    }
    void (location.hash === '#audit' ? open() : refresh());
  });

  window.addEventListener('skalee:signed-out', () => {
    signedIn = false;
    clear();
  });

  window.addEventListener('online', () => {
    if (signedIn) void refresh();
  });

  window.addEventListener('focus', () => {
    if (signedIn) void refresh();
  });

  window.addEventListener('skalee:permissions-updated', (event) => {
    if (event.detail?.accessRole) {
      signedIn = true;
    }
    if (event.detail?.accessRole === 'platform_admin') {
      tab.hidden = false;
    }
    if (event.detail?.audit) {
      applyAuditContext(event.detail.audit);
    }
    if (signedIn && location.hash === '#audit' && (!currentAudit || panel.hidden)) {
      void open();
    }
  });

  // Admin user assignments editor (Preserved intact from Phase 1)
  function createEditor(user, stores, assignments) {
    const editor = document.createElement('div');
    editor.className = 'user-locations';
    editor.dataset.auditEditor = '';

    const head = document.createElement('div');
    head.className = 'user-locations-head';

    const titleWrapper = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Responsável pela Auditoria';
    const subtitle = document.createElement('small');
    subtitle.style.display = 'block';
    subtitle.style.color = 'var(--muted)';
    subtitle.style.marginTop = '2px';
    subtitle.textContent = 'Selecione as lojas autorizadas para a Auditoria. Nenhuma seleção remove o acesso. O perfil operacional permanece inalterado.';
    titleWrapper.append(title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'user-location-actions';

    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.className = 'btn2';
    selectAll.textContent = 'Selecionar todas';

    const clearSelection = document.createElement('button');
    clearSelection.type = 'button';
    clearSelection.className = 'btn2';
    clearSelection.textContent = 'Limpar seleção';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn2';
    save.textContent = 'Salvar acesso à Auditoria';
    save.disabled = assignments === null || !navigator.onLine;

    actions.append(selectAll, clearSelection, save);
    head.append(titleWrapper, actions);

    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'user-message';
    status.style.margin = '6px 0 0';

    const checks = document.createElement('div');
    checks.className = 'user-location-checks';

    const selected = new Set((assignments || []).filter(a => a.user_id === user.id && a.active).map(a => a.retail_location_id));
    const availableStores = stores.filter(s => s.active !== false || selected.has(s.id));

    if (!availableStores.length) {
      const empty = document.createElement('div');
      empty.className = 'user-location-empty';
      empty.textContent = 'Nenhuma loja ativa cadastrada.';
      checks.append(empty);
      save.disabled = true;
      selectAll.disabled = true;
      clearSelection.disabled = true;
    } else {
      availableStores.forEach(store => {
        const label = document.createElement('label');
        label.className = 'user-location-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = store.id;
        input.checked = selected.has(store.id);
        input.disabled = assignments === null;
        const text = document.createElement('span');
        text.textContent = store.name + (store.active === false ? ' (inativa: desmarque para revogar)' : '');
        label.append(input, text);
        checks.append(label);
      });
    }

    selectAll.addEventListener('click', () => {
      checks.querySelectorAll('input').forEach(input => { input.checked = true; });
    });
    clearSelection.addEventListener('click', () => {
      checks.querySelectorAll('input').forEach(input => { input.checked = false; });
    });

    if (assignments === null) {
      status.textContent = 'Permissões indisponíveis. Recarregue os usuários antes de alterar o acesso.';
      status.className = 'user-message error';
    }

    save.addEventListener('click', async () => {
      save.disabled = true;
      selectAll.disabled = true;
      clearSelection.disabled = true;
      checks.querySelectorAll('input').forEach(input => { input.disabled = true; });
      status.textContent = 'Salvando permissões da Auditoria...';
      status.className = 'user-message';
      try {
        const selectedIds = [...checks.querySelectorAll('input:checked')].map(input => input.value);
        await window.skaleeDb.setAuditUserLocations(user.id, selectedIds);
        status.textContent = selectedIds.length
          ? `Permissões da Auditoria atualizadas (${selectedIds.length} loja(s) autorizada(s)).`
          : 'Acesso à Auditoria revogado para este usuário.';
        status.className = 'user-message success';
      } catch (error) {
        status.textContent = error.message || 'Não foi possível salvar as permissões.';
        status.className = 'user-message error';
      } finally {
        save.disabled = !navigator.onLine;
        selectAll.disabled = !navigator.onLine;
        clearSelection.disabled = !navigator.onLine;
        checks.querySelectorAll('input').forEach(input => { input.disabled = false; });
      }
    });

    editor.append(head, checks, status);
    return editor;
  }

  // Bootstrap check in case auth initialized before audit-access.js
  function checkBootstrap() {
    if (window.skaleeDb?.loadAuditAccessContext) {
      if (location.hash === '#audit') {
        void open();
      } else {
        void refresh();
      }
    } else if (window.skaleeDb?.getAdminPermissions) {
      try {
        const perms = window.skaleeDb.getAdminPermissions();
        if (perms?.isPlatformAdmin) {
          signedIn = true;
          tab.hidden = false;
          void (location.hash === '#audit' ? open() : refresh());
        }
      } catch (_) {}
    }
  }

  checkBootstrap();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkBootstrap);
  }
  window.addEventListener('load', checkBootstrap);

  window.skaleeAuditAccess = {
    refresh,
    open,
    createEditor,
    loadAudit,
    getCurrentAudit: () => currentAudit,
    getContext: () => context
  };
})();
