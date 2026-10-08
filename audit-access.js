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
      
      .audit-subnav { display: flex; gap: 8px; margin-bottom: 2px; }
      .audit-subtab { padding: 9px 18px; border-radius: 12px; border: 1px solid var(--line, #e2e8f0); background: var(--card, #fff); color: var(--muted, #64748b); font-size: 13px; font-weight: 700; cursor: pointer; transition: all .15s ease; }
      .audit-subtab:hover { color: var(--text); border-color: var(--blue, #2563eb); }
      .audit-subtab.active { background: var(--blue, #2563eb); color: #fff; border-color: var(--blue, #2563eb); }
      html[data-theme="dark"] .audit-subtab { background: #0c1421; border-color: rgba(255,255,255,0.1); color: #94a3b8; }
      html[data-theme="dark"] .audit-subtab.active { background: #2563eb; color: #fff; }

      .audit-history-card { background: var(--card, #fff); border: 1px solid var(--line, #e2e8f0); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
      html[data-theme="dark"] .audit-history-card { background: var(--card, #101827); border-color: rgba(255,255,255,0.08); }
      .audit-history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .audit-history-table th { padding: 10px 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted, #64748b); border-bottom: 2px solid var(--line, #e2e8f0); text-align: left; }
      .audit-history-table td { padding: 12px; border-bottom: 1px solid var(--line, #e2e8f0); color: var(--text); }
      html[data-theme="dark"] .audit-history-table th, html[data-theme="dark"] .audit-history-table td { border-color: rgba(255,255,255,0.08); }
      .audit-modal-panel.large { max-width: 1050px; width: 95%; height: 92vh; }
    </style>

    <div class="audit-wrap">
      <!-- Top Sub-Navigation -->
      <div class="audit-subnav">
        <button type="button" id="auditTabActive" class="audit-subtab active">Apuração Mensal</button>
        <button type="button" id="auditTabHistory" class="audit-subtab">Auditorias Anteriores (Histórico)</button>
      </div>

      <!-- Active Audit Section -->
      <div id="auditActiveSection" style="display: flex; flex-direction: column; gap: 18px;">
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

              <button type="button" id="auditReviewBtn" class="btn2" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px; color: #2563eb;">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                <span>Revisão do Fechamento</span>
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

          <!-- Seção Oficial Visível: Relatório Mensal -->
          <div id="auditReportSection" style="margin-top: 14px; background: linear-gradient(135deg, rgba(15, 39, 68, 0.05) 0%, rgba(0, 217, 255, 0.06) 100%); border: 1px solid rgba(0, 217, 255, 0.28); border-radius: 12px; padding: 14px 18px;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(0, 217, 255, 0.12); display: flex; align-items: center; justify-content: center; color: var(--sk-cyan, #00d9ff); flex-shrink: 0;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 22px; height: 22px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <strong style="font-size: 15px; color: var(--text, #0f172a);">Relatório Mensal</strong>
                    <span id="auditReportStatusPill" class="audit-status-tag status-tag-open" style="font-size: 11px;">Prévia em Andamento</span>
                  </div>
                  <p style="margin: 3px 0 0 0; font-size: 12px; color: var(--muted, #64748b);">
                    Relatório executivo auditável com resumo gerencial, análise por motivos e memória de cálculo A4.
                  </p>
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <button type="button" id="auditViewReportBtn" class="btn2" style="min-height: 38px; padding: 0 16px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; color: #2563eb; border: 1.5px solid rgba(37,99,235,0.4); background: rgba(37,99,235,0.06);">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>Visualizar Relatório</span>
                </button>

                <button type="button" id="auditPrintReportBtn" class="btn" style="min-height: 38px; padding: 0 18px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  <span>Gerar PDF</span>
                </button>
              </div>
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

    <!-- History Section Wrapper -->
    <div id="auditHistorySection" style="display: none; flex-direction: column; gap: 18px;">
      <div class="audit-card">
        <div class="audit-header">
          <div>
            <h2 class="audit-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px; height:24px; color:var(--sk-cyan, #00d9ff);">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Histórico Oficial de Auditorias Mensais
            </h2>
            <p class="audit-subtitle">Consultas, relatórios congelados e versionamento de fechamento</p>
          </div>
        </div>

        <div class="audit-bar" style="margin-top: 14px; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
          <div class="audit-field-group" style="flex: 1 1 200px;">
            <label class="audit-field-label" for="historyStoreSelect">LOJA</label>
            <select id="historyStoreSelect" class="audit-select">
              <option value="">Todas as lojas autorizadas</option>
            </select>
          </div>

          <div class="audit-field-group" style="max-width: 140px;">
            <label class="audit-field-label" for="historyYearSelect">ANO</label>
            <select id="historyYearSelect" class="audit-select">
              <option value="">Todos</option>
            </select>
          </div>

          <div class="audit-field-group" style="max-width: 190px;">
            <label class="audit-field-label" for="historyStatusSelect">STATUS</label>
            <select id="historyStatusSelect" class="audit-select">
              <option value="">Todos os status</option>
              <option value="completed">Finalizada</option>
              <option value="reopened">Reaberta</option>
              <option value="ready_for_review">Pronta p/ Fechamento</option>
              <option value="open">Em andamento</option>
            </select>
          </div>

          <button type="button" id="historyRefreshBtn" class="btn2" style="min-height: 42px; padding: 0 18px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      <div class="audit-card">
        <div style="overflow-x: auto;">
          <table class="audit-history-table">
            <thead>
              <tr>
                <th>Loja</th>
                <th>Competência</th>
                <th>Status</th>
                <th style="text-align: center;">Revisão</th>
                <th style="text-align: center;">Itens</th>
                <th style="text-align: center;">Qtd Vencida</th>
                <th style="text-align: right;">Impacto Custo</th>
                <th>Fechamento</th>
                <th style="text-align: right;">Ações</th>
              </tr>
            </thead>
            <tbody id="historyTableBody">
              <tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 30px;">Clique em "Atualizar" ou selecione os filtros para consultar o histórico.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
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

    <!-- Modal 3: Diagnóstico e Revisão de Fechamento -->
    <div id="modalReview" class="audit-modal-overlay">
      <div class="audit-modal-panel" style="max-width: 680px;">
        <div class="audit-modal-head">
          <div>
            <h3 class="audit-modal-title">Diagnóstico Pré-Fechamento</h3>
            <p style="margin: 2px 0 0; color: var(--muted); font-size: 12px;">Validação de pendências, itens sem custo e integridade antes do fechamento oficial</p>
          </div>
          <button type="button" class="audit-modal-close" data-close-modal="review">&times;</button>
        </div>

        <!-- Diagnostic Metrics Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-top: 6px;">
          <div style="padding: 10px; border-radius: 10px; background: rgba(148,163,184,0.08); border: 1px solid var(--line, #e2e8f0); text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Total Itens</span>
            <strong id="reviewTotalItems" style="display: block; font-size: 18px; color: var(--text); margin-top: 2px;">0</strong>
          </div>
          <div style="padding: 10px; border-radius: 10px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #16a34a; text-transform: uppercase;">Apurados</span>
            <strong id="reviewCountedItems" style="display: block; font-size: 18px; color: #16a34a; margin-top: 2px;">0</strong>
          </div>
          <div id="reviewPendingCard" style="padding: 10px; border-radius: 10px; background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.2); text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #ea580c; text-transform: uppercase;">Pendentes</span>
            <strong id="reviewPendingItems" style="display: block; font-size: 18px; color: #ea580c; margin-top: 2px;">0</strong>
          </div>
          <div style="padding: 10px; border-radius: 10px; background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.2); text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #dc2626; text-transform: uppercase;">Com Perda</span>
            <strong id="reviewLossItems" style="display: block; font-size: 18px; color: #dc2626; margin-top: 2px;">0</strong>
          </div>
          <div style="padding: 10px; border-radius: 10px; background: rgba(37,99,235,0.08); border: 1px solid rgba(37,99,235,0.2); text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Impacto Custo</span>
            <strong id="reviewCostImpact" style="display: block; font-size: 15px; color: #2563eb; margin-top: 4px;">R$ 0,00</strong>
          </div>
        </div>

        <!-- Diagnostic Alerts & Warnings List -->
        <div id="reviewAlertsContainer" style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;"></div>

        <!-- Action Shortcuts -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--line, #e2e8f0); flex-wrap: wrap;">
          <div>
            <button type="button" id="reviewFilterPendingBtn" class="btn2" style="display: none; font-size: 12px;">
              <span>🔍 Filtrar Pendentes na Lista</span>
            </button>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn2" data-close-modal="review">Fechar</button>
            <button type="button" id="reviewMarkReadyBtn" class="btn2" style="color: #d97706; border-color: rgba(245,158,11,0.4);">
              <span>Pronta para Fechamento</span>
            </button>
            <button type="button" id="reviewProceedCloseBtn" class="btn" style="background: #16a34a;">
              <span>Prosseguir para Fechamento</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal 4: Fechamento Oficial da Auditoria -->
    <div id="modalCloseAudit" class="audit-modal-overlay">
      <div class="audit-modal-panel" style="max-width: 750px;">
        <div class="audit-modal-head">
          <div>
            <h3 class="audit-modal-title">Fechamento Mensal Oficial</h3>
            <p style="margin: 2px 0 0; color: var(--muted); font-size: 12px;">Formalização de controladoria, parecer executivo, plano de ação e congelamento dos dados</p>
          </div>
          <button type="button" class="audit-modal-close" data-close-modal="close-audit">&times;</button>
        </div>

        <form id="formCloseAudit" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label class="audit-field-label" for="closeSummaryInput">Sumário Executivo / Parecer da Auditoria *</label>
            <textarea id="closeSummaryInput" class="audit-input" style="width: 100%; min-height: 70px; font-family: inherit;" required placeholder="Apresente uma síntese executiva da apuração do mês, causas predominantes e desempenho da loja..."></textarea>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label class="audit-field-label" for="closeCriticalPointsInput">Pontos Críticos Identificados</label>
              <textarea id="closeCriticalPointsInput" class="audit-input" style="width: 100%; min-height: 55px; font-family: inherit;" placeholder="Seções, categorias ou produtos com maior concentração de perdas..."></textarea>
            </div>
            <div>
              <label class="audit-field-label" for="closeRecommendationsInput">Recomendações da Controladoria</label>
              <textarea id="closeRecommendationsInput" class="audit-input" style="width: 100%; min-height: 55px; font-family: inherit;" placeholder="Medidas de ajuste de compras, reforço do PVPS ou acompanhamento..."></textarea>
            </div>
          </div>

          <div>
            <label class="audit-field-label" for="closeNotesInput">Observações Complementares</label>
            <textarea id="closeNotesInput" class="audit-input" style="width: 100%; min-height: 45px; font-family: inherit;" placeholder="Ressalvas ou notas internas adicionais..."></textarea>
          </div>

          <!-- Action Plan Section -->
          <div style="border: 1px solid var(--line, #e2e8f0); border-radius: 10px; padding: 12px; background: rgba(148,163,184,0.04);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <label class="audit-field-label" style="margin: 0;">Plano de Ação Corretiva</label>
              <button type="button" id="closeAddActionBtn" class="btn2" style="font-size: 11px; padding: 4px 10px;">+ Adicionar Medida</button>
            </div>
            <div style="overflow-x: auto;">
              <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid var(--line, #e2e8f0); color: var(--muted); text-align: left; font-size: 11px;">
                    <th style="padding: 4px 6px;">Ação Corretiva</th>
                    <th style="padding: 4px 6px; width: 140px;">Responsável</th>
                    <th style="padding: 4px 6px; width: 115px;">Prazo</th>
                    <th style="padding: 4px 6px; width: 100px;">Prioridade</th>
                    <th style="padding: 4px 6px; width: 40px; text-align: center;"></th>
                  </tr>
                </thead>
                <tbody id="closeActionPlanTableBody"></tbody>
              </table>
            </div>
          </div>

          <div id="modalCloseError" style="display: none; padding: 8px 12px; border-radius: 8px; background: rgba(220,38,38,0.1); color: #dc2626; font-size: 13px;"></div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;">
            <button type="button" class="btn2" data-close-modal="close-audit">Cancelar</button>
            <button type="submit" id="closeAuditSubmitBtn" class="btn" style="background: #16a34a;">Confirmar Fechamento e Congelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal 5: Reabertura Controlada da Auditoria -->
    <div id="modalReopenAudit" class="audit-modal-overlay">
      <div class="audit-modal-panel" style="max-width: 550px;">
        <div class="audit-modal-head">
          <div>
            <h3 class="audit-modal-title">Reabertura de Auditoria</h3>
            <p style="margin: 2px 0 0; color: #ea580c; font-size: 12px; font-weight: 700;">Ação restrita ao Administrador Skalee</p>
          </div>
          <button type="button" class="audit-modal-close" data-close-modal="reopen-audit">&times;</button>
        </div>

        <div style="padding: 10px 14px; border-radius: 8px; background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.25); font-size: 12px; color: #ea580c; line-height: 1.4;">
          <strong>⚠️ Registro de Auditoria & Versionamento</strong><br>
          A reabertura incrementará a versão da auditoria (ex: Revisão 1 → 2) e registrará um evento imutável com usuário, data e justificativa. O snapshot anterior permanecerá preservado no histórico de controladoria.
        </div>

        <form id="formReopenAudit" style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
          <div>
            <label class="audit-field-label" for="reopenReasonInput">Justificativa da Reabertura *</label>
            <textarea id="reopenReasonInput" class="audit-input" style="width: 100%; min-height: 80px; font-family: inherit;" required minlength="5" placeholder="Explique formalmente o motivo da reabertura (ex: recontagem solicitada pela gerência, divergência física confirmada)..."></textarea>
          </div>

          <div id="modalReopenError" style="display: none; padding: 8px 12px; border-radius: 8px; background: rgba(220,38,38,0.1); color: #dc2626; font-size: 13px;"></div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;">
            <button type="button" class="btn2" data-close-modal="reopen-audit">Cancelar</button>
            <button type="submit" id="reopenAuditSubmitBtn" class="btn" style="background: #ea580c;">Confirmar Reabertura</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal 6: Visualização Prévia do Relatório Executivo -->
    <div id="modalReportPreview" class="audit-modal-overlay">
      <div class="audit-modal-panel large">
        <div class="audit-modal-head" style="margin-bottom: 8px;">
          <div>
            <h3 class="audit-modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span>Relatório Mensal de Auditoria</span>
              <span id="reportPreviewBadge" class="audit-status-tag status-tag-completed" style="font-size: 11px;">Versão 1</span>
            </h3>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="previewPrintActionBtn" class="btn" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 14px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              <span>Imprimir / Salvar PDF</span>
            </button>
            <button type="button" class="audit-modal-close" data-close-modal="report-preview">&times;</button>
          </div>
        </div>

        <div style="flex: 1; border: 1px solid var(--line, #e2e8f0); border-radius: 10px; overflow: hidden; background: #fff; position: relative;">
          <iframe id="reportPreviewIframe" title="Visualização do Relatório" style="width: 100%; height: 100%; border: 0;"></iframe>
        </div>
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
  const reviewBtn = panel.querySelector('#auditReviewBtn');
  const closeBtn = panel.querySelector('#auditCloseBtn');
  const reopenBtn = panel.querySelector('#auditReopenBtn');
  const viewReportBtn = panel.querySelector('#auditViewReportBtn');
  const printReportBtn = panel.querySelector('#auditPrintReportBtn');
  const reportSectionWrap = panel.querySelector('#auditReportSection');
  const reportStatusPill = panel.querySelector('#auditReportStatusPill');
  const completedNotice = panel.querySelector('#auditCompletedNotice');

  // Subnav & History elements
  const tabActive = panel.querySelector('#auditTabActive');
  const tabHistory = panel.querySelector('#auditTabHistory');
  const activeSection = panel.querySelector('#auditActiveSection');
  const historySection = panel.querySelector('#auditHistorySection');
  const historyStore = panel.querySelector('#historyStoreSelect');
  const historyYear = panel.querySelector('#historyYearSelect');
  const historyStatus = panel.querySelector('#historyStatusSelect');
  const historyRefreshBtn = panel.querySelector('#historyRefreshBtn');
  const historyTableBody = panel.querySelector('#historyTableBody');

  // Modal 3 (Review) elements
  const modalReview = panel.querySelector('#modalReview');
  const reviewTotal = panel.querySelector('#reviewTotalItems');
  const reviewCounted = panel.querySelector('#reviewCountedItems');
  const reviewPending = panel.querySelector('#reviewPendingItems');
  const reviewLoss = panel.querySelector('#reviewLossItems');
  const reviewCostImpact = panel.querySelector('#reviewCostImpact');
  const reviewAlertsContainer = panel.querySelector('#reviewAlertsContainer');
  const reviewFilterPendingBtn = panel.querySelector('#reviewFilterPendingBtn');
  const reviewMarkReadyBtn = panel.querySelector('#reviewMarkReadyBtn');
  const reviewProceedCloseBtn = panel.querySelector('#reviewProceedCloseBtn');

  // Modal 4 (Close) elements
  const modalCloseAudit = panel.querySelector('#modalCloseAudit');
  const formCloseAudit = panel.querySelector('#formCloseAudit');
  const closeSummary = panel.querySelector('#closeSummaryInput');
  const closeCriticalPoints = panel.querySelector('#closeCriticalPointsInput');
  const closeRecommendations = panel.querySelector('#closeRecommendationsInput');
  const closeNotes = panel.querySelector('#closeNotesInput');
  const closeAddActionBtn = panel.querySelector('#closeAddActionBtn');
  const closeActionPlanBody = panel.querySelector('#closeActionPlanTableBody');
  const closeAuditSubmitBtn = panel.querySelector('#closeAuditSubmitBtn');
  const modalCloseError = panel.querySelector('#modalCloseError');

  // Modal 5 (Reopen) elements
  const modalReopenAudit = panel.querySelector('#modalReopenAudit');
  const formReopenAudit = panel.querySelector('#formReopenAudit');
  const reopenReason = panel.querySelector('#reopenReasonInput');
  const reopenAuditSubmitBtn = panel.querySelector('#reopenAuditSubmitBtn');
  const modalReopenError = panel.querySelector('#modalReopenError');

  // Modal 6 (Report Preview) elements
  const modalReportPreview = panel.querySelector('#modalReportPreview');
  const reportPreviewBadge = panel.querySelector('#reportPreviewBadge');
  const reportPreviewIframe = panel.querySelector('#reportPreviewIframe');
  const previewPrintActionBtn = panel.querySelector('#previewPrintActionBtn');

  let lastReportData = null;

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

  // Modal close handlers for all modals
  const allModals = [modalCount, modalAddFound, modalReview, modalCloseAudit, modalReopenAudit, modalReportPreview].filter(Boolean);

  panel.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.closest('.audit-modal-overlay');
      if (m) m.classList.remove('show');
    });
  });

  allModals.forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('show');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      allModals.forEach(m => m.classList.remove('show'));
    }
  });

  // Subnav handling
  tabActive?.addEventListener('click', () => {
    tabActive.classList.add('active');
    tabHistory.classList.remove('active');
    activeSection.style.display = 'flex';
    historySection.style.display = 'none';
  });

  tabHistory?.addEventListener('click', () => {
    tabHistory.classList.add('active');
    tabActive.classList.remove('active');
    historySection.style.display = 'flex';
    activeSection.style.display = 'none';
    void loadAuditHistory();
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
    historyStoresPopulated = false;
    lastReportData = null;
    historyStore?.replaceChildren();
    if (historyTableBody) {
      historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 30px;">Clique em "Atualizar" ou selecione os filtros para consultar o histórico.</td></tr>';
    }
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

    if (historyStore) {
      historyStore.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: 'Todas as lojas autorizadas' }),
        ...activeLocations.map(loc => {
          const opt = document.createElement('option');
          opt.value = loc.id;
          opt.textContent = loc.name;
          return opt;
        })
      );
      historyStoresPopulated = true;
    }

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

    // Status tag & action buttons
    const isCompleted = currentAudit.status === 'completed';
    const isReady = currentAudit.status === 'ready_for_review';
    const isReopened = currentAudit.status === 'reopened';
    const isAdmin = Boolean(context?.is_admin || context?.access_role === 'platform_admin');
    const revNum = currentAudit.revision_number || 1;

    statusTag.className = 'audit-status-tag';
    // Seção Oficial Relatório Mensal: sempre visível no workspace
    if (reportSectionWrap) reportSectionWrap.style.display = 'block';
    if (viewReportBtn) viewReportBtn.style.display = 'inline-flex';
    if (printReportBtn) printReportBtn.style.display = 'inline-flex';

    if (isCompleted) {
      statusTag.textContent = `● Finalizada (Rev. ${revNum})`;
      statusTag.classList.add('status-tag-completed');
      completedNotice.style.display = 'block';
      closeBtn.style.display = 'none';
      reviewBtn.style.display = 'none';
      syncBtn.disabled = true;
      addFoundBtn.disabled = true;
      reopenBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      if (reportStatusPill) {
        reportStatusPill.textContent = `● Oficial Congelado (Rev. ${revNum})`;
        reportStatusPill.className = 'audit-status-tag status-tag-completed';
      }
    } else if (isReady) {
      statusTag.textContent = `● Pronta para Fechamento (Rev. ${revNum})`;
      statusTag.classList.add('status-tag-ready');
      completedNotice.style.display = 'none';
      reviewBtn.style.display = 'inline-flex';
      closeBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      reopenBtn.style.display = 'none';
      syncBtn.disabled = false;
      addFoundBtn.disabled = false;
      if (reportStatusPill) {
        reportStatusPill.textContent = `● Pronta p/ Fechamento (Rev. ${revNum})`;
        reportStatusPill.className = 'audit-status-tag status-tag-ready';
      }
    } else if (isReopened) {
      statusTag.textContent = `● Reaberta (Rev. ${revNum})`;
      statusTag.classList.add('status-tag-open');
      completedNotice.style.display = 'none';
      reviewBtn.style.display = 'inline-flex';
      closeBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      reopenBtn.style.display = 'none';
      syncBtn.disabled = false;
      addFoundBtn.disabled = false;
      if (reportStatusPill) {
        reportStatusPill.textContent = `● Reaberta em Andamento (Rev. ${revNum})`;
        reportStatusPill.className = 'audit-status-tag status-tag-open';
      }
    } else {
      statusTag.textContent = `● Em andamento (Rev. ${revNum})`;
      statusTag.classList.add('status-tag-open');
      completedNotice.style.display = 'none';
      reviewBtn.style.display = 'inline-flex';
      closeBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      reopenBtn.style.display = 'none';
      syncBtn.disabled = false;
      addFoundBtn.disabled = false;
      if (reportStatusPill) {
        reportStatusPill.textContent = `● Prévia em Andamento (Rev. ${revNum})`;
        reportStatusPill.className = 'audit-status-tag status-tag-open';
      }
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

  // ==========================================
  // FASE 4: DIAGNÓSTICO E REVISÃO PRÉ-FECHAMENTO
  // ==========================================
  reviewBtn.addEventListener('click', async () => {
    if (!currentAudit) return;
    reviewBtn.disabled = true;
    try {
      const diag = await window.skaleeDb.reviewValidityAudit(currentAudit.id);

      // Populate metrics
      reviewTotal.textContent = String(diag.total_items || 0);
      reviewCounted.textContent = String(diag.counted_items || 0);
      reviewPending.textContent = String(diag.pending_items || 0);
      reviewLoss.textContent = String(diag.items_with_loss || 0);
      reviewCostImpact.textContent = diag.total_cost_impact !== null ? formatCurrency(diag.total_cost_impact) : 'Não apurado';

      if (diag.pending_items > 0) {
        reviewPendingCard.style.borderColor = 'rgba(234,88,12,0.4)';
        reviewPendingCard.style.background = 'rgba(234,88,12,0.12)';
        reviewFilterPendingBtn.style.display = 'inline-flex';
      } else {
        reviewPendingCard.style.borderColor = 'rgba(148,163,184,0.2)';
        reviewPendingCard.style.background = 'rgba(148,163,184,0.08)';
        reviewFilterPendingBtn.style.display = 'none';
      }

      // Render diagnostic alerts
      reviewAlertsContainer.replaceChildren();

      if (diag.pending_items > 0) {
        const alert = document.createElement('div');
        alert.style.cssText = 'padding: 10px 14px; border-radius: 8px; background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.3); font-size: 12px; color: #ea580c; line-height: 1.4;';
        alert.innerHTML = `<strong>⚠️ ${diag.pending_items} produto(s) com contagem pendente:</strong> Para auditoria auditável e sem distorções, recomenda-se realizar a apuração física (inclusive confirmar 0 para itens sem perda) antes do fechamento.`;
        reviewAlertsContainer.append(alert);
      } else {
        const ok = document.createElement('div');
        ok.style.cssText = 'padding: 10px 14px; border-radius: 8px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.25); font-size: 12px; color: #16a34a; line-height: 1.4;';
        ok.innerHTML = `<strong>✓ Apuração completa:</strong> Todos os ${diag.total_items} produtos foram verificados e possuem apuração registrada.`;
        reviewAlertsContainer.append(ok);
      }

      if (diag.uncosted_loss_items > 0) {
        const info = document.createElement('div');
        info.style.cssText = 'padding: 10px 14px; border-radius: 8px; background: rgba(37,99,235,0.08); border: 1px solid rgba(37,99,235,0.25); font-size: 12px; color: #2563eb; line-height: 1.4;';
        info.innerHTML = `<strong>ℹ️ ${diag.uncosted_loss_items} produto(s) com perda sem custo unitário no SG:</strong> Estes itens constam na memória de cálculo como <em>"Não apurado"</em>, assegurando que o custo total não seja distorcido com R$ 0,00.`;
        reviewAlertsContainer.append(info);
      }

      if (diag.no_reason_loss_items > 0) {
        const warn = document.createElement('div');
        warn.style.cssText = 'padding: 10px 14px; border-radius: 8px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3); font-size: 12px; color: #d97706; line-height: 1.4;';
        warn.innerHTML = `<strong>⚠️ ${diag.no_reason_loss_items} produto(s) com perda registrada sem motivo classificado:</strong> A classificação auxilia na precisão da análise de causas no relatório de Controladoria.`;
        reviewAlertsContainer.append(warn);
      }

      if (Array.isArray(diag.blocking_reasons) && diag.blocking_reasons.length > 0) {
        const block = document.createElement('div');
        block.style.cssText = 'padding: 10px 14px; border-radius: 8px; background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.3); font-size: 12px; color: #dc2626; line-height: 1.4;';
        block.innerHTML = `<strong>Bloqueios:</strong> ${diag.blocking_reasons.map(escapeHtml).join('<br>')}`;
        reviewAlertsContainer.append(block);
      }

      const isAdmin = Boolean(context?.is_admin || context?.access_role === 'platform_admin');
      reviewProceedCloseBtn.style.display = isAdmin ? 'inline-flex' : 'none';

      modalReview.classList.add('show');
    } catch (err) {
      console.error('Erro ao revisar auditoria:', err);
      alert(err.message || 'Erro ao realizar diagnóstico pré-fechamento.');
    } finally {
      reviewBtn.disabled = false;
    }
  });

  reviewFilterPendingBtn.addEventListener('click', () => {
    modalReview.classList.remove('show');
    filterChips.forEach(chip => chip.classList.toggle('active', chip.dataset.filter === 'pending'));
    currentFilter = 'pending';
    renderItems();
  });

  reviewMarkReadyBtn.addEventListener('click', async () => {
    if (!currentAudit) return;
    reviewMarkReadyBtn.disabled = true;
    try {
      const updated = await window.skaleeDb.markAuditReadyForReview(currentAudit.id);
      currentAudit = updated;
      renderAuditWorkspace();
      modalReview.classList.remove('show');
      alert('Auditoria sinalizada com sucesso como Pronta para Fechamento!');
    } catch (err) {
      console.error('Erro ao sinalizar auditoria:', err);
      alert(err.message || 'Erro ao marcar auditoria como pronta para fechamento.');
    } finally {
      reviewMarkReadyBtn.disabled = false;
    }
  });

  reviewProceedCloseBtn.addEventListener('click', () => {
    modalReview.classList.remove('show');
    openCloseModal();
  });

  // ==========================================
  // FASE 4: FECHAMENTO OFICIAL E PLANO DE AÇÃO
  // ==========================================
  function addActionPlanRow(item = { action: '', owner: '', due_date: '', priority: 'Média' }) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--line, #e2e8f0)';
    tr.innerHTML = `
      <td style="padding: 4px 6px;">
        <input type="text" class="audit-input plan-action" style="width: 100%; font-size: 12px; padding: 4px 8px;" placeholder="Ex: Reforçar PVPS na seção" value="${escapeHtml(item.action || '')}">
      </td>
      <td style="padding: 4px 6px;">
        <input type="text" class="audit-input plan-owner" style="width: 100%; font-size: 12px; padding: 4px 8px;" placeholder="Ex: Gerente da Loja" value="${escapeHtml(item.owner || '')}">
      </td>
      <td style="padding: 4px 6px;">
        <input type="date" class="audit-input plan-due-date" style="width: 100%; font-size: 12px; padding: 4px 6px;" value="${escapeHtml(item.due_date || '')}">
      </td>
      <td style="padding: 4px 6px;">
        <select class="audit-select plan-priority" style="width: 100%; font-size: 12px; padding: 4px 6px;">
          <option value="Baixa"${item.priority === 'Baixa' ? ' selected' : ''}>Baixa</option>
          <option value="Média"${item.priority === 'Média' || !item.priority ? ' selected' : ''}>Média</option>
          <option value="Alta"${item.priority === 'Alta' ? ' selected' : ''}>Alta</option>
          <option value="Urgente"${item.priority === 'Urgente' ? ' selected' : ''}>Urgente</option>
        </select>
      </td>
      <td style="padding: 4px 6px; text-align: center;">
        <button type="button" class="plan-row-delete" style="background: none; border: 0; color: #dc2626; font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;" title="Remover item">&times;</button>
      </td>
    `;
    tr.querySelector('.plan-row-delete').addEventListener('click', () => tr.remove());
    closeActionPlanBody.append(tr);
  }

  closeAddActionBtn.addEventListener('click', () => addActionPlanRow());

  function openCloseModal() {
    if (!currentAudit) return;
    formCloseAudit.reset();
    modalCloseError.style.display = 'none';

    closeSummary.value = currentAudit.conclusion_summary || '';
    closeCriticalPoints.value = currentAudit.conclusion_critical_points || '';
    closeRecommendations.value = currentAudit.conclusion_recommendations || '';
    closeNotes.value = currentAudit.conclusion_notes || '';

    closeActionPlanBody.replaceChildren();
    if (Array.isArray(currentAudit.action_plan) && currentAudit.action_plan.length > 0) {
      currentAudit.action_plan.forEach(item => addActionPlanRow(item));
    } else {
      addActionPlanRow();
    }

    modalCloseAudit.classList.add('show');
    closeSummary.focus();
  }

  closeBtn.addEventListener('click', () => openCloseModal());

  formCloseAudit.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentAudit) return;

    const summary = closeSummary.value.trim();
    if (!summary) {
      modalCloseError.textContent = 'O Sumário Executivo é obrigatório para formalizar o fechamento.';
      modalCloseError.style.display = 'block';
      closeSummary.focus();
      return;
    }

    // Collect action plan
    const actionPlan = [];
    closeActionPlanBody.querySelectorAll('tr').forEach(tr => {
      const action = tr.querySelector('.plan-action')?.value?.trim();
      if (!action) return;
      actionPlan.push({
        action,
        owner: tr.querySelector('.plan-owner')?.value?.trim() || null,
        due_date: tr.querySelector('.plan-due-date')?.value || null,
        priority: tr.querySelector('.plan-priority')?.value || 'Média'
      });
    });

    closeAuditSubmitBtn.disabled = true;
    closeAuditSubmitBtn.textContent = 'Finalizando e congelando dados...';
    modalCloseError.style.display = 'none';

    try {
      const closed = await window.skaleeDb.closeValidityAudit(currentAudit.id, {
        conclusionSummary: summary,
        conclusionCriticalPoints: closeCriticalPoints.value.trim() || null,
        conclusionRecommendations: closeRecommendations.value.trim() || null,
        conclusionNotes: closeNotes.value.trim() || null,
        actionPlan
      });

      currentAudit = closed;
      modalCloseAudit.classList.remove('show');
      renderAuditWorkspace();
      alert('Auditoria finalizada com sucesso! Seus dados e memória de cálculo foram congelados como histórico oficial da Controladoria.');
    } catch (err) {
      console.error('Erro ao finalizar auditoria:', err);
      modalCloseError.textContent = err.message || 'Erro ao finalizar auditoria.';
      modalCloseError.style.display = 'block';
    } finally {
      closeAuditSubmitBtn.disabled = false;
      closeAuditSubmitBtn.textContent = 'Confirmar Fechamento e Congelar';
    }
  });

  // ==========================================
  // FASE 4: REABERTURA CONTROLADA
  // ==========================================
  reopenBtn.addEventListener('click', () => {
    if (!currentAudit) return;
    formReopenAudit.reset();
    modalReopenError.style.display = 'none';
    modalReopenAudit.classList.add('show');
    reopenReason.focus();
  });

  formReopenAudit.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentAudit) return;

    const reason = reopenReason.value.trim();
    if (!reason || reason.length < 5) {
      modalReopenError.textContent = 'Por favor, informe uma justificativa válida com pelo menos 5 caracteres.';
      modalReopenError.style.display = 'block';
      reopenReason.focus();
      return;
    }

    reopenAuditSubmitBtn.disabled = true;
    reopenAuditSubmitBtn.textContent = 'Reabrindo...';
    modalReopenError.style.display = 'none';

    try {
      const reopened = await window.skaleeDb.reopenValidityAudit(currentAudit.id, reason);
      currentAudit = reopened;
      modalReopenAudit.classList.remove('show');
      renderAuditWorkspace();
      alert(`Auditoria reaberta com sucesso! Nova revisão criada: Revisão ${reopened.revision_number}. As edições foram desbloqueadas.`);
    } catch (err) {
      console.error('Erro ao reabrir auditoria:', err);
      modalReopenError.textContent = err.message || 'Erro ao reabrir auditoria.';
      modalReopenError.style.display = 'block';
    } finally {
      reopenAuditSubmitBtn.disabled = false;
      reopenAuditSubmitBtn.textContent = 'Confirmar Reabertura';
    }
  });

  // ==========================================
  // FASE 4: RELATÓRIO EXECUTIVO & PDF
  // ==========================================
  viewReportBtn.addEventListener('click', async () => {
    if (!currentAudit) return;
    viewReportBtn.disabled = true;
    try {
      const repData = await window.skaleeDb.getValidityAuditReportData(currentAudit.id);
      lastReportData = repData;
      if (window.skaleeAuditReport?.buildExecutiveAuditHtml) {
        const htmlDoc = window.skaleeAuditReport.buildExecutiveAuditHtml(repData);
        reportPreviewIframe.srcdoc = htmlDoc;
        reportPreviewBadge.textContent = `Versão ${repData.revision_number || 1}`;
        modalReportPreview.classList.add('show');
      } else {
        alert('Módulo de geração de relatórios indisponível.');
      }
    } catch (err) {
      console.error('Erro ao visualizar relatório:', err);
      alert(err.message || 'Erro ao carregar dados do relatório.');
    } finally {
      viewReportBtn.disabled = false;
    }
  });

  async function triggerPrintReport() {
    try {
      let data = lastReportData;
      if (!data || data.id !== currentAudit?.id) {
        if (!currentAudit) return;
        data = await window.skaleeDb.getValidityAuditReportData(currentAudit.id);
        lastReportData = data;
      }
      if (window.skaleeAuditReport?.openPrintableReportWindow) {
        window.skaleeAuditReport.openPrintableReportWindow(data);
      }
    } catch (err) {
      console.error('Erro ao imprimir relatório:', err);
      alert(err.message || 'Erro ao gerar relatório para impressão.');
    }
  }

  printReportBtn.addEventListener('click', triggerPrintReport);
  previewPrintActionBtn.addEventListener('click', triggerPrintReport);

  // ==========================================
  // FASE 4: HISTÓRICO DE AUDITORIAS
  // ==========================================
  let historyStoresPopulated = false;

  async function loadAuditHistory() {
    if (!historyTableBody) return;

    if (!historyStoresPopulated && context?.locations?.length) {
      const activeLocs = context.locations.filter(l => l.active !== false);
      const currentVal = historyStore.value;
      historyStore.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: 'Todas as lojas autorizadas' }),
        ...activeLocs.map(l => Object.assign(document.createElement('option'), { value: l.id, textContent: l.name }))
      );
      if (currentVal) historyStore.value = currentVal;
      historyStoresPopulated = true;
    }

    if (!historyYear.options.length || historyYear.options.length <= 1) {
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1, currentYear - 2];
      historyYear.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: 'Todos os anos' }),
        ...years.map(y => Object.assign(document.createElement('option'), { value: String(y), textContent: String(y) }))
      );
    }

    historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 25px;">Carregando histórico oficial...</td></tr>';

    try {
      const filters = {
        retailLocationId: historyStore.value || null,
        year: historyYear.value ? Number(historyYear.value) : null,
        status: historyStatus.value || null
      };
      const list = await window.skaleeDb.listValidityAuditsHistory(filters);

      if (!list || !list.length) {
        historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 30px;">Nenhuma auditoria encontrada para os filtros selecionados.</td></tr>';
        return;
      }

      historyTableBody.replaceChildren(...list.map(row => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--line, #e2e8f0)';

        const storeName = row.store_name || 'Loja';
        const compFormatted = formatCompetence(row.competence_month);

        let statusBadgeHtml = '<span class="audit-status-tag status-tag-open">Em andamento</span>';
        if (row.status === 'completed') {
          statusBadgeHtml = '<span class="audit-status-tag status-tag-completed">Finalizada</span>';
        } else if (row.status === 'reopened') {
          statusBadgeHtml = '<span class="audit-status-tag status-tag-open" style="border-color: rgba(234,88,12,0.4); color: #ea580c;">Reaberta</span>';
        } else if (row.status === 'ready_for_review') {
          statusBadgeHtml = '<span class="audit-status-tag status-tag-ready">Pronta p/ Fechamento</span>';
        }

        const revText = `Rev. ${row.revision_number || 1}`;
        const totalItemsText = row.total_items_count !== null ? String(row.total_items_count) : '—';
        const lossUnitsText = row.total_loss_units !== null ? `${row.total_loss_units} un.` : '—';
        const costImpactText = row.total_cost_impact !== null ? formatCurrency(row.total_cost_impact) : (row.has_uncosted_loss ? 'Não apurado' : 'R$ 0,00');

        let closedInfo = '—';
        if (row.closed_at) {
          const d = new Date(row.closed_at).toLocaleDateString('pt-BR');
          closedInfo = `${d}${row.closed_by_email ? ` (${row.closed_by_email.split('@')[0]})` : ''}`;
        }

        tr.innerHTML = `
          <td style="padding: 10px 12px; font-weight: 700;">${escapeHtml(storeName)}</td>
          <td style="padding: 10px 12px;">${escapeHtml(compFormatted)}</td>
          <td style="padding: 10px 12px;">${statusBadgeHtml}</td>
          <td style="padding: 10px 12px; text-align: center;"><span style="font-size: 11px; font-weight: 700; color: var(--muted);">${escapeHtml(revText)}</span></td>
          <td style="padding: 10px 12px; text-align: center;">${totalItemsText}</td>
          <td style="padding: 10px 12px; text-align: center; font-weight: 700; color: #dc2626;">${lossUnitsText}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #2563eb;">${costImpactText}</td>
          <td style="padding: 10px 12px; font-size: 12px; color: var(--muted);">${escapeHtml(closedInfo)}</td>
          <td style="padding: 10px 12px; text-align: right;">
            <div style="display: inline-flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end;">
              <button type="button" class="btn2 btn-open-history" style="font-size: 11px; padding: 4px 8px;">Abrir</button>
              <button type="button" class="btn2 btn-report-history" style="font-size: 11px; padding: 4px 8px; color: #2563eb; border-color: rgba(37,99,235,0.3);">Visualizar</button>
              <button type="button" class="btn btn-pdf-history" style="font-size: 11px; padding: 4px 8px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff;">Gerar PDF</button>
            </div>
          </td>
        `;

        tr.querySelector('.btn-open-history')?.addEventListener('click', () => {
          storeSelect.value = row.retail_location_id;
          monthInput.value = row.competence_month;
          tabActive.click();
          void loadAudit(true);
        });

        tr.querySelector('.btn-report-history')?.addEventListener('click', async () => {
          try {
            const repData = await window.skaleeDb.getValidityAuditReportData(row.id);
            if (window.skaleeAuditReport?.buildExecutiveAuditHtml) {
              const htmlDoc = window.skaleeAuditReport.buildExecutiveAuditHtml(repData);
              reportPreviewIframe.srcdoc = htmlDoc;
              reportPreviewBadge.textContent = `Versão ${repData.revision_number || 1}`;
              lastReportData = repData;
              modalReportPreview.classList.add('show');
            }
          } catch (e) {
            alert(e.message || 'Erro ao carregar relatório da auditoria.');
          }
        });

        tr.querySelector('.btn-pdf-history')?.addEventListener('click', async () => {
          try {
            const repData = await window.skaleeDb.getValidityAuditReportData(row.id);
            if (window.skaleeAuditReport?.openPrintableReportWindow) {
              window.skaleeAuditReport.openPrintableReportWindow(repData);
            }
          } catch (e) {
            alert(e.message || 'Erro ao gerar PDF da auditoria.');
          }
        });

        return tr;
      }));
    } catch (err) {
      console.error('Erro ao listar histórico de auditorias:', err);
      historyTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #dc2626; padding: 25px;">${escapeHtml(err.message || 'Erro ao consultar histórico.')}</td></tr>`;
    }
  }

  historyRefreshBtn?.addEventListener('click', () => void loadAuditHistory());
  historyStore?.addEventListener('change', () => void loadAuditHistory());
  historyYear?.addEventListener('change', () => void loadAuditHistory());
  historyStatus?.addEventListener('change', () => void loadAuditHistory());

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
    if (!signedIn && !context) {
      if (location.hash === '#audit') {
        history.replaceState(null, '', location.pathname + location.search);
      }
      return;
    }
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
    } else {
      void refresh();
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
