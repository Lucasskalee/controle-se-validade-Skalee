/* ==========================================================================
   SKALEE VALIDADES — Navegação mobile (Capacitor Android e web até 767px).
   Os nomes android-* são mantidos por compatibilidade com o app nativo.
   ========================================================================== */
(function (root) {
  'use strict';

  function isCapacitorAndroid() {
    const cap = root.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function') return false;
    if (!cap.isNativePlatform()) return false;
    if (typeof cap.getPlatform === 'function') {
      return cap.getPlatform() === 'android';
    }
    return true;
  }

  const mobileViewport = root.matchMedia('(max-width: 767px)');
  let mobileUIActive = false;
  let initialized = false;

  function updateMobileMode() {
    const next = isCapacitorAndroid() || mobileViewport.matches;
    if (next === mobileUIActive) return;
    mobileUIActive = next;
    document.documentElement.classList.toggle('android-app', next);
    document.documentElement.classList.toggle('capacitor-android', isCapacitorAndroid());
    document.body.classList.toggle('android-app', next);
    if (next) {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport && !viewport.content.includes('viewport-fit')) viewport.content += ', viewport-fit=cover';
      if (!initialized) {
        initialized = true;
        initAndroidUI();
      } else {
        navigateAndroidTab(document.querySelector('nav.main-nav .tab.active:not([hidden])')?.dataset.page || 'android-home');
        syncAndroidData();
      }
    } else {
      // Restore the original desktop navigation, including its report/audit hooks.
      document.documentElement.removeAttribute('data-android-tab');
      if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
      document.querySelectorAll('.page').forEach(section => {
        section.hidden = section.id.startsWith('android-') || (section.id === 'audit' && !canOpenAudit());
      });
      document.getElementById('grid')?.removeAttribute('data-android-view');
      document.getElementById('products')?.removeAttribute('data-android-view');
      const target = document.querySelector(`nav.main-nav .tab[data-page="${currentAndroidTab}"]:not([hidden])`)
        || document.querySelector('nav.main-nav .tab[data-page="products"]');
      target?.click();
    }
  }

  let currentAndroidTab = 'android-home';
  let userSelectedTabManually = false;
  let currentAndroidUserId = '';
  let currentAndroidUserEmail = '';
  let isSyncingStoreSelection = false;
  let storeValidatedForCurrentUser = false;
  let lastValidatedLocationsKey = '';
  let draftEvaluationSeq = 0;
  let resumableDraftStoreId = '';

  const ANDROID_STORE_PREF_PREFIX = 'skalee.android.selectedStore.v1:';

  function safeEscape(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAppContainer() {
    return document.getElementById('protectedApp') || document.querySelector('main');
  }

  function getUserPreferenceKeys() {
    const scopeUserId = String(
      currentAndroidUserId || root.skaleeRegistrationDraft?.scope?.()?.userId || ''
    ).trim();
    const scopeEmail = String(
      currentAndroidUserEmail || (typeof activeUserEmail === 'string' ? activeUserEmail : '')
    )
      .trim()
      .toLowerCase();

    const keys = [];
    if (scopeUserId) keys.push(`${ANDROID_STORE_PREF_PREFIX}id:${scopeUserId}`);
    if (scopeEmail) keys.push(`${ANDROID_STORE_PREF_PREFIX}email:${scopeEmail}`);
    return keys;
  }

  function readAndroidUserStorePreference() {
    const keys = getUserPreferenceKeys();
    for (const key of keys) {
      try {
        const raw = root.localStorage?.getItem(key);
        if (raw === null || raw === undefined) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'store' in parsed) {
            return { hasPreference: true, store: String(parsed.store ?? '') };
          }
        } catch (_) {
          return { hasPreference: true, store: String(raw) };
        }
      } catch (_) {}
    }
    return { hasPreference: false, store: '' };
  }

  function writeAndroidUserStorePreference(storeName) {
    const keys = getUserPreferenceKeys();
    if (!keys.length) return;
    const payload = JSON.stringify({
      store: String(storeName ?? ''),
      updatedAt: Date.now()
    });
    for (const key of keys) {
      try {
        root.localStorage?.setItem(key, payload);
      } catch (_) {}
    }
  }

  function getAuthorizedStoreList() {
    if (typeof allowedLocations !== 'undefined' && Array.isArray(allowedLocations)) {
      const activeLocs = allowedLocations.filter((loc) => loc && loc.active !== false);
      const names = activeLocs
        .map((loc) => String(loc.name || '').trim())
        .filter(Boolean);
      return {
        validated: true,
        locations: activeLocs,
        names
      };
    }

    const selectEl = typeof els !== 'undefined' ? els.storeFilter : null;
    if (selectEl && selectEl.options && selectEl.options.length > 1) {
      const names = [...selectEl.options]
        .map((opt) => String(opt.value || '').trim())
        .filter(Boolean);
      return {
        validated: true,
        locations: [],
        names
      };
    }

    return {
      validated: false,
      locations: [],
      names: []
    };
  }

  function getAndroidActiveStoreName() {
    const headerSelect = document.getElementById('androidHeaderStoreSelect');
    if (headerSelect && headerSelect.options && headerSelect.options.length > 1) {
      return String(headerSelect.value ?? '');
    }
    if (typeof els !== 'undefined' && els.storeFilter) {
      return String(els.storeFilter.value ?? '');
    }
    const pref = readAndroidUserStorePreference();
    return pref.hasPreference ? pref.store : '';
  }

  function resolveAuthorizedAndroidStore(requestedStoreName, { useSavedPreference = false } = {}) {
    const { validated, names } = getAuthorizedStoreList();
    let candidate = requestedStoreName;

    if (useSavedPreference || candidate === undefined || candidate === null) {
      const pref = readAndroidUserStorePreference();
      if (pref.hasPreference) {
        candidate = pref.store;
      } else if (typeof els !== 'undefined' && els.storeFilter && els.storeFilter.value) {
        candidate = els.storeFilter.value;
      } else {
        candidate = '';
      }
    }

    const normalized = String(candidate ?? '');

    if (!validated) {
      return {
        store: normalized,
        validated: false,
        fallbackApplied: false
      };
    }

    if (normalized === '') {
      return {
        store: '',
        validated: true,
        fallbackApplied: false
      };
    }

    if (names.includes(normalized)) {
      return {
        store: normalized,
        validated: true,
        fallbackApplied: false
      };
    }

    // Loja anteriormente selecionada não está mais autorizada para este usuário
    const safeFallback = names.length === 1 ? names[0] : '';
    return {
      store: safeFallback,
      validated: true,
      fallbackApplied: true
    };
  }

  function ensureStoreSelectOptions(selectEl, storeNames) {
    if (!selectEl || !Array.isArray(storeNames) || !storeNames.length) return;
    const existingValues = new Set([...selectEl.options].map((opt) => opt.value));
    if (!existingValues.has('')) {
      selectEl.prepend(new Option('Todas as lojas', ''));
    }
    storeNames.forEach((name) => {
      if (name && !existingValues.has(name)) {
        selectEl.add(new Option(name, name));
      }
    });
  }

  function applyAndroidActiveStore(requestedStoreName, options = {}) {
    if (!mobileUIActive) return;
    if (isSyncingStoreSelection) return getAndroidActiveStoreName();

    const {
      persist = true,
      reloadProducts = false,
      reloadNotifications = false,
      useSavedPreference = false
    } = options;

    isSyncingStoreSelection = true;
    try {
      const resolution = resolveAuthorizedAndroidStore(requestedStoreName, { useSavedPreference });
      const targetStore = resolution.store;
      const { names } = getAuthorizedStoreList();

      if (resolution.validated) {
        storeValidatedForCurrentUser = true;
        lastValidatedLocationsKey = names.join('|');
      }

      if (persist) {
        const pref = readAndroidUserStorePreference();
        if (!useSavedPreference || resolution.fallbackApplied || pref.hasPreference) {
          writeAndroidUserStorePreference(targetStore);
        }
      }

      let filterChanged = false;
      if (typeof els !== 'undefined' && els.storeFilter) {
        ensureStoreSelectOptions(els.storeFilter, names);
        if (els.storeFilter.value !== targetStore) {
          if (targetStore === '' || [...els.storeFilter.options].some((o) => o.value === targetStore)) {
            els.storeFilter.value = targetStore;
            filterChanged = true;
          }
        }
      }

      const headerSelect = document.getElementById('androidHeaderStoreSelect');
      if (headerSelect) {
        ensureStoreSelectOptions(headerSelect, names);
        if (headerSelect.value !== targetStore) {
          if (targetStore === '' || [...headerSelect.options].some((o) => o.value === targetStore)) {
            headerSelect.value = targetStore;
          }
        }
      }

      if (typeof els !== 'undefined') {
        if (els.notificationStore) ensureStoreSelectOptions(els.notificationStore, names);
        if (els.notificationCenterStore) ensureStoreSelectOptions(els.notificationCenterStore, names);
      }

      if (typeof readNotificationSettings === 'function' && typeof writeNotificationSettings === 'function') {
        const currentNotif = readNotificationSettings();
        if (currentNotif.store !== targetStore) {
          writeNotificationSettings({ ...currentNotif, store: targetStore });
        }
      } else {
        try {
          root.localStorage?.setItem('skalee.notification.store', targetStore);
        } catch (_) {}
      }

      if (typeof els !== 'undefined') {
        if (els.notificationStore && els.notificationStore.value !== targetStore) {
          if (targetStore === '' || [...els.notificationStore.options].some((o) => o.value === targetStore)) {
            els.notificationStore.value = targetStore;
          }
        }
        if (els.notificationCenterStore && els.notificationCenterStore.value !== targetStore) {
          if (targetStore === '' || [...els.notificationCenterStore.options].some((o) => o.value === targetStore)) {
            els.notificationCenterStore.value = targetStore;
          }
        }
      }

      if (typeof syncNotificationCenterControls === 'function') {
        syncNotificationCenterControls();
      }

      if (targetStore && typeof els !== 'undefined' && els.store && !root.skaleeRegistrationDraft?.pending?.()) {
        const matchingOption = [...els.store.options].find(
          (opt) =>
            opt.value &&
            (String(opt.dataset?.name || '').trim() === targetStore ||
             String(opt.textContent || '').trim() === targetStore)
        );
        if (matchingOption && els.store.value !== matchingOption.value) {
          els.store.value = matchingOption.value;
          els.store.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if ((reloadProducts || filterChanged) && typeof scheduleProductQueryReload === 'function') {
        scheduleProductQueryReload(0);
      }
      if (filterChanged && typeof render === 'function') {
        render();
      }

      if (reloadNotifications) {
        if (typeof scheduleNotificationCenterReload === 'function') {
          scheduleNotificationCenterReload(0);
        } else if (typeof renderNotificationCenter === 'function') {
          renderNotificationCenter();
        }
      }

      syncAndroidHeader();
      syncAndroidHome();
      syncAndroidProfile();

      return targetStore;
    } finally {
      isSyncingStoreSelection = false;
    }
  }

  function openNotificationsCenter() {
    const activeStore = getAndroidActiveStoreName();
    applyAndroidActiveStore(activeStore, {
      persist: false,
      reloadProducts: false,
      reloadNotifications: true
    });
    if (typeof setPersonalPanelOpen === 'function') {
      setPersonalPanelOpen(true, 'notifications');
    } else if (typeof els !== 'undefined' && els.headerProfileButton) {
      els.headerProfileButton.click();
    }
    if (typeof els !== 'undefined' && els.notificationCenterStore && els.notificationCenterStore.value !== activeStore) {
      ensureStoreSelectOptions(els.notificationCenterStore, getAuthorizedStoreList().names);
      if (activeStore === '' || [...els.notificationCenterStore.options].some((o) => o.value === activeStore)) {
        els.notificationCenterStore.value = activeStore;
      }
    }
  }

  function buildAndroidHeader() {
    if (document.getElementById('androidHeader')) return;
    const app = getAppContainer();
    if (!app) return;

    const header = document.createElement('header');
    header.id = 'androidHeader';
    header.className = 'android-header';
    header.innerHTML = `
      <div class="android-header-brand">
        <img src="skalee-icon-192.png" alt="Skalee" class="android-header-logo">
        <div class="android-header-titles">
          <span class="android-header-brand-name">Skalee Validades</span>
          <div class="android-header-store-row">
            <span class="android-header-store-dot" aria-hidden="true"></span>
            <select id="androidHeaderStoreSelect" class="android-header-store-select" aria-label="Selecionar loja ativa">
              <option value="">Todas as lojas</option>
            </select>
          </div>
        </div>
      </div>
      <div class="android-header-actions">
        <button type="button" id="androidHeaderNotificationBtn" class="android-header-icon-btn" aria-label="Notificações de validade">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span id="androidHeaderNotificationBadge" class="android-header-badge" hidden>0</span>
        </button>
      </div>
    `;

    app.prepend(header);

    const storeSelect = header.querySelector('#androidHeaderStoreSelect');
    storeSelect.addEventListener('change', () => {
      applyAndroidActiveStore(storeSelect.value, {
        persist: true,
        reloadProducts: true,
        reloadNotifications: true
      });
    });

    const notifBtn = header.querySelector('#androidHeaderNotificationBtn');
    notifBtn.addEventListener('click', openNotificationsCenter);
  }

  function buildAndroidHomePage() {
    if (document.getElementById('android-home')) return;
    const app = getAppContainer();
    if (!app) return;

    const homeSection = document.createElement('section');
    homeSection.id = 'android-home';
    homeSection.className = 'page active';
    homeSection.innerHTML = `
      <div class="android-home-wrap">
        <div class="android-home-greeting">
          <div class="android-home-greeting-text">
            <h2 id="androidHomeGreetingTitle">Painel de Validades</h2>
            <p id="androidHomeGreetingSub">Resumo em tempo real da operação</p>
          </div>
          <span id="androidHomeStorePill" class="android-home-store-pill">Todas as lojas</span>
        </div>

        <div id="androidHomeDraftBanner" class="android-home-draft-banner" hidden style="display: none;" aria-hidden="true">
          <div>
            <strong id="androidHomeDraftTitle">Cadastro em andamento salvo</strong>
            <small id="androidHomeDraftSub">Retome o preenchimento de onde parou.</small>
          </div>
          <button type="button" id="androidHomeResumeDraftBtn" class="btn" style="min-height: 36px; padding: 0 14px; font-size: 12px; font-weight: 800; flex-shrink: 0;">
            Retomar
          </button>
        </div>

        <div class="android-kpi-grid" role="region" aria-label="Indicadores de validade">
          <button type="button" id="androidKpiExpired" class="android-kpi-card kpi-expired" aria-label="Ver produtos vencidos ou que vencem hoje" aria-controls="products">
            <div class="android-kpi-top">
                <span class="android-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </span>
            </div>
            <strong id="androidKpiExpiredValue" class="android-kpi-value">0</strong>
            <span class="android-kpi-label">Vencidos / Hoje</span>
            <span class="android-kpi-sub">Ação imediata</span>
          </button>

          <button type="button" id="androidKpiExpiring" class="android-kpi-card kpi-expiring" aria-label="Ver produtos com vencimento até 7 dias" aria-controls="products">
            <div class="android-kpi-top">
                <span class="android-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </span>
            </div>
            <strong id="androidKpiExpiringValue" class="android-kpi-value">0</strong>
            <span class="android-kpi-label">Próximos 7 dias</span>
            <span class="android-kpi-sub">Atenção</span>
          </button>

          <button type="button" id="androidKpiOffer" class="android-kpi-card kpi-offer" aria-label="Ver produtos em oferta" aria-controls="products">
            <div class="android-kpi-top">
                <span class="android-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <line x1="7" y1="7" x2="7.01" y2="7"></line>
                </svg>
              </span>
            </div>
            <strong id="androidKpiOfferValue" class="android-kpi-value">0</strong>
            <span class="android-kpi-label">Em oferta</span>
            <span class="android-kpi-sub">Ofertas ativas</span>
          </button>
        </div>
        <div class="android-quick-actions" role="region" aria-label="Ações operacionais rápidas">
          <button type="button" id="androidQaScan" class="android-qa-btn" aria-label="Bipar produto">
            <span class="android-qa-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </span>
            <span>Bipar</span>
          </button>
          <button type="button" id="androidQaRegister" class="android-qa-btn" aria-label="Conferir lote">
            <span class="android-qa-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </span>
            <span>Novo Lote</span>
          </button>
          <button type="button" id="androidQaReports" class="android-qa-btn" aria-label="Acessar relatórios">
            <span class="android-qa-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </span>
            <span>Relatórios</span>
          </button>
          <button type="button" id="androidQaAudit" class="android-qa-btn" aria-label="Acessar auditoria">
            <span class="android-qa-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </span>
            <span>Auditoria</span>
          </button>
        </div>



        <div class="android-section-head">
          <div class="android-section-title-group">
            <h3 class="android-section-title">Produtos em acompanhamento</h3>
            <span id="androidHomeTrackingCount" class="android-section-count">0 produtos</span>
          </div>
          <button type="button" id="androidHomeSeeAllBtn" class="android-section-link">Ver todos →</button>
        </div>

        <div id="androidHomeTrackingList" class="android-home-list" aria-live="polite">
          <div class="empty">Carregando produtos em acompanhamento...</div>
        </div>
      </div>
    `;

    const productsSection = document.getElementById('products');
    if (productsSection && productsSection.parentNode === app) {
      app.insertBefore(homeSection, productsSection);
    } else {
      app.appendChild(homeSection);
    }

    homeSection.querySelector('#androidHomeResumeDraftBtn').addEventListener('click', () => {
      if (
        resumableDraftStoreId &&
        typeof els !== 'undefined' &&
        els.store &&
        els.store.value !== resumableDraftStoreId &&
        [...els.store.options].some((opt) => opt.value === resumableDraftStoreId)
      ) {
        els.store.value = resumableDraftStoreId;
        els.store.dispatchEvent(new Event('change', { bubbles: true }));
      }
      userSelectedTabManually = true;
      navigateAndroidTab('register');
    });

    homeSection.querySelector('#androidHomeSeeAllBtn').addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('products');
    });

    homeSection.querySelector('#androidKpiExpired').addEventListener('click', () => {
      applyQuickFilterAndOpenProducts({ expiryRange: 'expired_today' });
    });

    homeSection.querySelector('#androidKpiExpiring').addEventListener('click', () => {
      applyQuickFilterAndOpenProducts({ expiryRange: '7' });
    });
    homeSection.querySelector('#androidQaScan')?.addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('register');
      const scanBtn = document.getElementById('btnScan');
      if (scanBtn) scanBtn.click();
    });

    homeSection.querySelector('#androidQaRegister')?.addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('register');
    });

    homeSection.querySelector('#androidQaReports')?.addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('reports');
    });

    homeSection.querySelector('#androidQaAudit')?.addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('profile');
    });



    homeSection.querySelector('#androidKpiOffer').addEventListener('click', () => {
      applyQuickFilterAndOpenProducts({ offerStatus: 'offer' });
    });
  }

  function applyQuickFilterAndOpenProducts(nextFilters) {
    if (typeof activeFilters !== 'undefined') {
      // Update only this filter group; retain the existing multiselect combination.
      Object.assign(activeFilters, nextFilters);
      if (typeof syncFilterUI === 'function') syncFilterUI();
      if (typeof scheduleProductQueryReload === 'function') scheduleProductQueryReload(0);
      if (typeof render === 'function') render();
    }
    userSelectedTabManually = true;
    navigateAndroidTab('products');
  }

  const ANDROID_PRODUCTS_VIEW_KEY = 'skalee.android.productsView';

  function readAndroidProductsViewPreference() {
    try {
      const saved = root.localStorage?.getItem(ANDROID_PRODUCTS_VIEW_KEY);
      return saved === 'list' ? 'list' : 'grid';
    } catch (_) {
      return 'grid';
    }
  }

  function applyAndroidProductsView(mode, persist = true) {
    const normalized = mode === 'list' ? 'list' : 'grid';
    if (persist) {
      try {
        root.localStorage?.setItem(ANDROID_PRODUCTS_VIEW_KEY, normalized);
      } catch (_) {}
    }

    const gridEl = document.getElementById('grid');
    if (gridEl && gridEl.dataset.androidView !== normalized) {
      gridEl.dataset.androidView = normalized;
    }

    const productsSection = document.getElementById('products');
    if (productsSection && productsSection.dataset.androidView !== normalized) {
      productsSection.dataset.androidView = normalized;
    }

    const toggle = document.getElementById('androidProductsViewToggle');
    if (toggle) {
      toggle.querySelectorAll('[data-android-view]').forEach((btn) => {
        const isActive = btn.dataset.androidView === normalized;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      });
    }
  }

  function buildAndroidProductsViewToggle() {
    if (document.getElementById('androidProductsViewToggle')) return;
    const productsSection = document.getElementById('products');
    if (!productsSection) return;

    const sortSelect = productsSection.querySelector('#sort');
    const resultEl = productsSection.querySelector('#result');
    const toolbarRow = sortSelect ? sortSelect.closest('.searchrow') : null;
    if (!toolbarRow) return;

    toolbarRow.classList.add('android-products-toolbar');

    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'android-products-toolbar-controls';

    const toggle = document.createElement('div');
    toggle.id = 'androidProductsViewToggle';
    toggle.className = 'android-view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Visualização de produtos');
    toggle.innerHTML = `
      <button type="button" class="android-view-btn active" data-android-view="grid" aria-pressed="true" aria-label="Visualização em grade">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
        </svg>
        <span>Grade</span>
      </button>
      <button type="button" class="android-view-btn" data-android-view="list" aria-pressed="false" aria-label="Visualização em lista">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
        <span>Lista</span>
      </button>
    `;

    if (sortSelect) {
      controlsWrap.appendChild(sortSelect);
    }
    controlsWrap.appendChild(toggle);

    if (resultEl && resultEl.parentNode === toolbarRow) {
      toolbarRow.appendChild(controlsWrap);
    } else {
      toolbarRow.prepend(controlsWrap);
    }

    toggle.querySelectorAll('[data-android-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyAndroidProductsView(btn.dataset.androidView, true);
      });
    });

    applyAndroidProductsView(readAndroidProductsViewPreference(), false);
  }

  function buildAndroidProfilePage() {
    if (document.getElementById('android-profile')) return;
    const app = getAppContainer();
    if (!app) return;

    const profileSection = document.createElement('section');
    profileSection.id = 'android-profile';
    profileSection.className = 'page';
    profileSection.innerHTML = `
      <div class="android-profile-wrap">
        <div class="android-profile-hero">
          <div id="androidProfileAvatar" class="android-profile-avatar" aria-hidden="true">SK</div>
          <div class="android-profile-identity">
            <h2 id="androidProfileName">Usuário</h2>
            <p id="androidProfileEmail">Usuário autenticado</p>
            <span id="androidProfileRole" class="android-profile-role-badge">Usuário normal</span>
          </div>
        </div>

        <div class="android-profile-card">
          <h3 class="android-profile-card-title">Lojas vinculadas</h3>
          <div id="androidProfileStores" class="android-profile-tags">
            <span class="android-profile-tag">Carregando lojas...</span>
          </div>
        </div>

        <div id="androidProfileSuppliersCard" class="android-profile-card" hidden>
          <h3 class="android-profile-card-title">Fornecedores vinculados</h3>
          <div id="androidProfileSuppliers" class="android-profile-tags"></div>
        </div>

        <div class="android-profile-card android-appearance-section">
          <div class="android-appearance-card-header">
            <h3 class="android-profile-card-title" style="margin: 0;">Aparência e Temas</h3>
          <span class="android-appearance-card-badge">Titanium 2.6</span>
          </div>

          <div class="android-appearance-group">
            <span class="android-appearance-label">Tema do Aplicativo</span>
            <div class="android-theme-Segment android-theme-grid" role="group" aria-label="Temas Skalee">
              <button type="button" class="android-theme-btn" data-android-theme="dark"><span class="theme-swatch theme-swatch-dark" aria-hidden="true"></span>Dark</button>
              <button type="button" class="android-theme-btn" data-android-theme="light"><span class="theme-swatch theme-swatch-light" aria-hidden="true"></span>Light</button>
              <button type="button" class="android-theme-btn" data-android-theme="industrial"><span class="theme-swatch theme-swatch-industrial" aria-hidden="true"></span>Industrial</button>
              <button type="button" class="android-theme-btn" data-android-theme="creative"><span class="theme-swatch theme-swatch-creative" aria-hidden="true"></span>Creative</button>
              <button type="button" class="android-theme-btn" data-android-theme="executive"><span class="theme-swatch theme-swatch-executive" aria-hidden="true"></span>Executive</button>
            </div>
          </div>

          <div class="android-appearance-group" style="margin-top: 14px;">
            <span class="android-appearance-label">Estilo de fundo</span>
            <div class="android-background-style-grid" role="radiogroup" aria-label="Fundo global">
              <button type="button" class="android-background-style-btn" data-background-style="titanium" role="radio" aria-checked="false"><strong>Textura Titanium</strong><span>Fundo metálico Skalee</span></button>
              <button type="button" class="android-background-style-btn" data-background-style="image" role="radio" aria-checked="false"><strong>Minha imagem</strong><span>Wallpaper local do dispositivo</span></button>
            </div>
          </div>

          <div class="android-appearance-group android-glass-background-group" style="margin-top: 14px;" data-theme-customization>
            <span class="android-appearance-label">Personalização do fundo</span>
            <div class="android-glass-background-grid" role="radiogroup" aria-label="Personalização do fundo">
              <button type="button" class="android-glass-background-btn" data-glass-background="titanium" role="radio" aria-checked="false">Textura Titanium</button>
              <button type="button" class="android-glass-background-btn" data-glass-background="image" role="radio" aria-checked="false">Minha imagem</button>
            </div>
            <input id="androidGlassWallpaperInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="android-glass-wallpaper-actions" data-theme-customization>
              <button type="button" class="android-glass-secondary-btn" id="androidGlassWallpaperApplyBtn" hidden>Aplicar imagem</button>
              <button type="button" class="android-glass-secondary-btn" id="androidGlassWallpaperCancelBtn" hidden>Cancelar</button>
              <button type="button" class="android-glass-secondary-btn danger" id="androidGlassWallpaperRemoveBtn" hidden>Remover imagem</button>
            </div>
            <p class="android-glass-wallpaper-status" id="androidGlassWallpaperStatus" aria-live="polite"></p>
            <div class="android-glass-tuning" data-theme-customization>
              <label>Desfoque dos cartões <output id="androidGlassBlurValue">18px</output><input id="androidGlassBlurRange" type="range" min="6" max="30" step="1" value="18"></label>
              <label>Intensidade do vidro <output id="androidGlassIntensityValue">72%</output><input id="androidGlassIntensityRange" type="range" min="45" max="90" step="1" value="72"></label>
              <label>Escurecimento do fundo <output id="androidGlassDimValue">18%</output><input id="androidGlassDimRange" type="range" min="0" max="45" step="1" value="18"></label>
            </div>
          </div>

          <div class="android-appearance-group android-legacy-aurora-options" style="margin-top: 14px;" hidden>
            <span class="android-appearance-label">Efeito Visual de Fundo</span>
            <div class="android-visual-grid" role="radiogroup" aria-label="Efeito visual de fundo">
              <button type="button" class="android-visual-card" data-visual-effect="webgl" role="radio" aria-checked="false">
                <div class="android-visual-card-preview webgl-preview">
                  <span class="android-visual-badge">Shader GPU</span>
                </div>
                <div class="android-visual-card-info">
                  <strong class="android-visual-card-title">Aurora Dinâmica (WebGL)</strong>
                  <span class="android-visual-card-desc">Movimento orgânico fluido com shader</span>
                </div>
                <span class="android-visual-card-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </span>
              </button>

              <button type="button" class="android-visual-card" data-visual-effect="css" role="radio" aria-checked="false">
                <div class="android-visual-card-preview css-preview">
                  <span class="android-visual-badge">Mesh Leve</span>
                </div>
                <div class="android-visual-card-info">
                  <strong class="android-visual-card-title">Aurora Suave (CSS Mesh)</strong>
                  <span class="android-visual-card-desc">Gradientes animados contínuos e econômicos</span>
                </div>
                <span class="android-visual-card-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </span>
              </button>

              <button type="button" class="android-visual-card" data-visual-effect="eco" role="radio" aria-checked="false">
                <div class="android-visual-card-preview eco-preview">
                  <span class="android-visual-badge">Econômico</span>
                </div>
                <div class="android-visual-card-info">
                  <strong class="android-visual-card-title">Modo Econômico</strong>
                  <span class="android-visual-card-desc">Fundo estático e máxima economia de bateria</span>
                </div>
                <span class="android-visual-card-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </span>
              </button>
            </div>
          </div>

          <!-- Controles de Diagnóstico e Recuperação WebGL (Seção Avançada Recolhível) -->
          <details class="android-webgl-diag-details" id="androidWebGLDiagDetails">
            <summary class="android-webgl-diag-summary">
              <span class="android-webgl-diag-summary-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 6px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Controles Avançados de Diagnóstico WebGL
              </span>
              <span class="android-webgl-diag-chevron" aria-hidden="true">▾</span>
            </summary>
            <div class="android-webgl-diag-card" id="androidWebGLDiagCard">
              <div class="android-webgl-diag-header">
                <div class="android-webgl-diag-status">
                  <span class="android-webgl-status-dot" id="androidWebGLStatusDot"></span>
                  <span class="android-webgl-status-text" id="androidWebGLStatusText">WebGL Ativo (Shader GPU)</span>
                </div>
                <span class="android-webgl-diag-badge" id="androidWebGLDiagBadge">GPU Shader</span>
              </div>
              <p class="android-webgl-diag-desc" id="androidWebGLDiagDesc">
                Aceleração gráfica ativa com shader Simplex Noise 2D em 30 FPS adaptativos.
              </p>
              <div class="android-webgl-diag-actions" id="androidWebGLDiagActions">
                <button type="button" class="android-diag-btn" id="androidDiagSimulateLossBtn">
                  Simular perda de WebGL
                </button>
                <button type="button" class="android-diag-btn primary" id="androidDiagRestoreBtn" style="display: none;">
                  Restaurar WebGL
                </button>
                <button type="button" class="android-diag-btn" id="androidDiagCancelSimBtn" style="display: none;">
                  Desativar simulação
                </button>
                <button type="button" class="android-diag-btn" id="androidDiagUseEcoBtn" style="display: none;">
                  Usar Modo Econômico
                </button>
              </div>
            </div>
          </details>
        </div>

        <div class="android-profile-card">
          <h3 class="android-profile-card-title">Recursos disponíveis</h3>
          <div class="android-profile-actions">
            <button type="button" id="androidProfileNotifCenterBtn" class="android-profile-action-btn">
              <span>Central de Notificações</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileNotifSettingsBtn" class="android-profile-action-btn">
              <span>Configurar Alertas de Vencimento</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileReportBtn" class="android-profile-action-btn">
              <span>Relatórios e Exportação PDF</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileAuditBtn" class="android-profile-action-btn" hidden>
              <span>Auditoria de Validades</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileLookupBtn" class="android-profile-action-btn">
              <span>Consulta Local de Produtos</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfilePosterBtn" class="android-profile-action-btn" hidden>
              <span>Cartazes de Oferta</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileAdminBtn" class="android-profile-action-btn" hidden>
              <span>Central Administrativa</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileTourBtn" class="android-profile-action-btn">
              <span>Como usar o app (Tour Skalito)</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileAboutBtn" class="android-profile-action-btn">
              <span>Sobre o aplicativo</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" id="androidProfileSignOutBtn" class="android-profile-action-btn danger">
              <span>Sair da conta</span>
              <span aria-hidden="true">⎋</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const auditSection = document.getElementById('audit');
    if (auditSection && auditSection.parentNode === app) {
      auditSection.insertAdjacentElement('afterend', profileSection);
    } else {
      app.appendChild(profileSection);
    }

    profileSection.querySelectorAll('[data-android-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.androidTheme;
        try {
          localStorage.setItem('skalee.theme', choice);
        } catch (_) {}
        if (typeof applyThemePreference === 'function') {
          applyThemePreference(choice, true);
        }
        syncAndroidProfile();
      });
    });

    profileSection.querySelectorAll('[data-visual-effect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.visualEffect;
        setStoredVisualEffect(choice);
      });
    });

    profileSection.querySelectorAll('[data-background-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.backgroundStyle === 'image') {
          profileSection.querySelector('#androidGlassWallpaperInput')?.click();
        } else {
          setStoredBackgroundStyle('titanium');
          setStoredGlassBackground('titanium');
        }
      });
    });

    profileSection.querySelectorAll('[data-glass-background]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.glassBackground;
        if (choice === 'image') {
          profileSection.querySelector('#androidGlassWallpaperInput')?.click();
        } else {
          setStoredGlassBackground(choice);
        }
      });
    });
    profileSection.querySelector('#androidGlassWallpaperInput')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) void prepareGlassWallpaper(file);
    });
    profileSection.querySelector('#androidGlassWallpaperApplyBtn')?.addEventListener('click', () => void applyPendingGlassWallpaper());
    profileSection.querySelector('#androidGlassWallpaperCancelBtn')?.addEventListener('click', cancelPendingGlassWallpaper);
    profileSection.querySelector('#androidGlassWallpaperRemoveBtn')?.addEventListener('click', () => void removeGlassWallpaper());
    profileSection.querySelectorAll('.android-glass-tuning input').forEach((input) => {
      input.addEventListener('input', () => setGlassTuning(input.dataset.glassTuning || input.id.replace('androidGlass', '').replace('Range', '').toLowerCase(), input.value));
    });

    profileSection.querySelector('#androidDiagSimulateLossBtn')?.addEventListener('click', simulateWebGLLoss);
    profileSection.querySelector('#androidDiagRestoreBtn')?.addEventListener('click', restoreWebGL);
    profileSection.querySelector('#androidDiagCancelSimBtn')?.addEventListener('click', disableWebGLSimulation);
    profileSection.querySelector('#androidDiagUseEcoBtn')?.addEventListener('click', useModoEconomicoFromDiag);

    profileSection.querySelector('#androidProfileNotifCenterBtn').addEventListener('click', openNotificationsCenter);

    profileSection.querySelector('#androidProfileNotifSettingsBtn').addEventListener('click', () => {
      if (typeof setNotificationsModalOpen === 'function') {
        setNotificationsModalOpen(true);
      }
    });

    profileSection.querySelector('#androidProfileReportBtn').addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('report');
    });

    profileSection.querySelector('#androidProfileAuditBtn').addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('audit');
    });

    profileSection.querySelector('#androidProfileLookupBtn').addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('local-query');
    });

    profileSection.querySelector('#androidProfilePosterBtn').addEventListener('click', () => {
      if (typeof els !== 'undefined' && els.posterTab) {
        els.posterTab.click();
      } else {
        root.location.href = 'poster.html';
      }
    });

    profileSection.querySelector('#androidProfileAdminBtn').addEventListener('click', () => {
      if (typeof openAdminCentral === 'function') {
        openAdminCentral('overview');
      }
    });

    profileSection.querySelector('#androidProfileTourBtn').addEventListener('click', () => {
      const tourBtn = document.getElementById('personalTourButton');
      if (tourBtn) tourBtn.click();
    });

    profileSection.querySelector('#androidProfileAboutBtn').addEventListener('click', () => {
      if (typeof setAboutModalOpen === 'function') {
        setAboutModalOpen(true);
      }
    });

    profileSection.querySelector('#androidProfileSignOutBtn').addEventListener('click', () => {
      if (typeof els !== 'undefined' && els.personalSignOut) {
        els.personalSignOut.click();
      } else if (typeof els !== 'undefined' && els.signOut) {
        els.signOut.click();
      }
    });
  }

  function buildAndroidBottomNav() {
    if (document.getElementById('androidBottomNav')) return;
    const app = getAppContainer();
    if (!app) return;

    const nav = document.createElement('nav');
    nav.id = 'androidBottomNav';
    nav.className = 'android-bottom-nav';
    nav.setAttribute('aria-label', 'Navegação principal');
    nav.innerHTML = `
      <button type="button" class="android-nav-item active" data-android-page="android-home" aria-current="page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z"></path>
        </svg>
        <span>Início</span>
      </button>

      <button type="button" class="android-nav-item" data-android-page="products">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
        </svg>
        <span>Produtos</span>
      </button>

      <button type="button" class="android-nav-item android-nav-item-center" data-android-page="register" aria-label="Cadastrar produto">
        <span class="android-nav-fab" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </span>
        <span>Cadastrar</span>
      </button>

      <button type="button" class="android-nav-item" data-android-page="report">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 4v16h16M9 16v-5M14 16V7M19 16v-3"></path>
        </svg>
        <span>Relatórios</span>
      </button>

      <button type="button" class="android-nav-item" data-android-page="android-profile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <span>Perfil</span>
      </button>
    `;

    (document.body || app).appendChild(nav);

    nav.querySelectorAll('[data-android-page]').forEach((button) => {
      button.addEventListener('click', () => {
        userSelectedTabManually = true;
        navigateAndroidTab(button.dataset.androidPage);
      });
    });
  }

  function ensureAuditRestrictedBanner() {
    const auditSection = document.getElementById('audit');
    if (!auditSection) return;
    let banner = document.getElementById('androidAuditRestrictedBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'androidAuditRestrictedBanner';
      banner.className = 'android-audit-restricted';
      banner.hidden = true;
      banner.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 36px; height: 36px; color: var(--muted); margin: 0 auto;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h3>Auditoria Mensal de Validades</h3>
        <p>Seu usuário não possui lojas habilitadas para auditoria neste momento ou as permissões ainda estão carregando. Solicite a liberação ao administrador caso necessário.</p>
      `;
      auditSection.prepend(banner);
    }

    const canAccessAudit = canOpenAudit();
    const shell = auditSection.querySelector('.audit-wrap, .audit-shell');
    banner.hidden = canAccessAudit;
    if (shell) {
      shell.style.display = canAccessAudit ? '' : 'none';
    }
  }

  let enforcingPageState = false;

  function canOpenAudit() {
    // Visibility is derived from the RPC context. RLS/RPCs remain the authority.
    const context = root.skaleeAuditAccess?.getContext?.();
    return context?.can_access_audit === true && (!currentAndroidUserId || context.user_id === currentAndroidUserId);
  }

  function enforceActiveAndroidPage(pageId) {
    if (!mobileUIActive) return;
    let requestedId = pageId || currentAndroidTab || 'android-home';
    if (requestedId === 'audit' && !canOpenAudit()) requestedId = 'android-profile';
    if (requestedId === 'register' && typeof isViewer !== 'undefined' && isViewer) requestedId = 'products';
    const targetSection = document.getElementById(requestedId) || document.getElementById('android-home');
    if (!targetSection) return;

    const resolvedId = targetSection.id;
    currentAndroidTab = resolvedId;
    document.documentElement.dataset.androidTab = resolvedId;
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();

    enforcingPageState = true;
    try {
      if (resolvedId !== 'audit' && root.location && root.location.hash === '#audit' && root.history?.replaceState) {
        root.history.replaceState(null, '', root.location.pathname + root.location.search);
      }

      document.querySelectorAll('.page').forEach((section) => {
        const isTarget = section.id === resolvedId;
        if (section.classList.contains('active') !== isTarget) {
          section.classList.toggle('active', isTarget);
        }
        if (section.hidden !== !isTarget) {
          section.hidden = !isTarget;
        }
      });

      const bottomNav = document.getElementById('androidBottomNav');
      if (bottomNav) {
        const highlightedTab = ['audit', 'local-query'].includes(resolvedId) ? 'android-profile' : resolvedId;
        bottomNav.querySelectorAll('[data-android-page]').forEach((btn) => {
          const isActive = btn.dataset.androidPage === highlightedTab;
          btn.classList.toggle('active', isActive);
          if (isActive) btn.setAttribute('aria-current', 'page');
          else btn.removeAttribute('aria-current');
        });
      }
    } finally {
      enforcingPageState = false;
    }
  }

  function navigateAndroidTab(pageId) {
    if (!mobileUIActive) return;
    if (pageId === 'audit' && !canOpenAudit()) return;
    if (pageId === 'register' && typeof isViewer !== 'undefined' && isViewer) return;
    const targetSection = document.getElementById(pageId);
    if (!targetSection) return;

    currentAndroidTab = pageId;

    if (document.body.classList.contains('admin-open') && typeof closeAdminCentral === 'function') {
      closeAdminCentral();
    }
    if (typeof els !== 'undefined' && els.personalPanel && !els.personalPanel.hidden && typeof setPersonalPanelOpen === 'function') {
      setPersonalPanelOpen(false);
    }

    enforceActiveAndroidPage(pageId);

    if (pageId === 'report' && typeof carregarProdutosRelatorio === 'function') {
      void carregarProdutosRelatorio();
    }

    if (pageId === 'audit') {
      ensureAuditRestrictedBanner();
      if (root.skaleeAuditAccess?.open) {
        void Promise.resolve(root.skaleeAuditAccess.open()).finally(() => {
          if (currentAndroidTab === 'audit') {
            enforceActiveAndroidPage('audit');
            ensureAuditRestrictedBanner();
          } else {
            enforceActiveAndroidPage(currentAndroidTab);
          }
        });
      }
    }

    if (pageId === 'android-home') {
      syncAndroidHome();
      void evaluateAndroidHomeDraftBanner();
    } else if (pageId === 'android-profile') {
      syncAndroidProfile();
    }

    syncAndroidFallbackBanner();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function getActiveStoreLabel() {
    const selectedStore = typeof els !== 'undefined' && els.storeFilter ? els.storeFilter.value : '';
    if (selectedStore) return selectedStore;
    if (typeof allowedLocations !== 'undefined' && Array.isArray(allowedLocations)) {
      const activeLocs = allowedLocations.filter((l) => l && l.active !== false);
      if (activeLocs.length === 1) {
        return activeLocs[0].name || 'Loja ativa';
      }
    }
    return 'Todas as lojas';
  }

  function syncAndroidHeader() {
    const { validated, names } = getAuthorizedStoreList();
    const namesKey = names.join('|');
    if (validated && (!storeValidatedForCurrentUser || namesKey !== lastValidatedLocationsKey)) {
      if (!isSyncingStoreSelection) {
        applyAndroidActiveStore(undefined, {
          useSavedPreference: true,
          persist: true,
          reloadProducts: false,
          reloadNotifications: false
        });
      }
    }

    const headerSelect = document.getElementById('androidHeaderStoreSelect');
    const sourceSelect = typeof els !== 'undefined' ? els.storeFilter : null;
    if (headerSelect && sourceSelect) {
      const currentOptions = [...sourceSelect.options].map((opt) => `${opt.value}:${opt.textContent}`).join('|');
      if (headerSelect.dataset.optionsHash !== currentOptions) {
        headerSelect.replaceChildren();
        [...sourceSelect.options].forEach((opt) => {
          headerSelect.add(new Option(opt.textContent, opt.value));
        });
        headerSelect.dataset.optionsHash = currentOptions;
      }
      if (headerSelect.value !== sourceSelect.value) {
        headerSelect.value = sourceSelect.value;
      }
    }

    const badge = document.getElementById('androidHeaderNotificationBadge');
    const sourceBadge = typeof els !== 'undefined' ? els.notificationPendingBadge : null;
    if (badge && sourceBadge) {
      badge.textContent = sourceBadge.textContent || '0';
      badge.hidden = Boolean(sourceBadge.hidden || Number(sourceBadge.textContent || 0) <= 0);
    }
  }

  function hasActiveCameraTicket(requestId) {
    if (!requestId) return false;
    try {
      const raw = root.localStorage?.getItem('skalee.camera.pending.v1');
      if (!raw) return false;
      const ticket = JSON.parse(raw);
      return Boolean(ticket && (!ticket.id || ticket.id === requestId));
    } catch (_) {
      return false;
    }
  }

  function hasEffectiveDraftContent(draft) {
    if (!draft || typeof draft !== 'object') return false;
    const hasCheckpoint = Boolean(
      draft.checkpoint &&
      (draft.checkpoint.state === 'sending' ||
       draft.checkpoint.state === 'photo-pending' ||
       draft.checkpoint.state === 'queued' ||
       draft.checkpoint.id)
    );
    const hasSelected = Boolean(
      draft.selected &&
      (String(draft.selected.name || '').trim() ||
       String(draft.selected.barcode || '').trim() ||
       String(draft.selected.code || '').trim() ||
       draft.selected.catalogProductId)
    );
    const hasPhoto = Boolean(
      draft.photoData?.blob ||
      draft.photoFile ||
      draft.cameraResultId ||
      hasActiveCameraTicket(draft.cameraRequestId)
    );
    const hasFields = Boolean(
      draft.fields &&
      typeof draft.fields === 'object' &&
      Object.values(draft.fields).some((val) => String(val ?? '').trim().length > 0)
    );
    return hasCheckpoint || hasSelected || hasPhoto || hasFields;
  }

  function getStoreIdForStoreName(storeName) {
    const normalized = String(storeName || '').trim();
    if (!normalized) return '';
    if (typeof allowedLocations !== 'undefined' && Array.isArray(allowedLocations)) {
      const match = allowedLocations.find(
        (loc) => loc && loc.active !== false && String(loc.name || '').trim() === normalized
      );
      if (match && match.id) return String(match.id);
    }
    if (typeof els !== 'undefined' && els.store && els.store.options) {
      const opt = [...els.store.options].find(
        (o) =>
          o.value &&
          (String(o.dataset?.name || '').trim() === normalized ||
           String(o.textContent || '').trim() === normalized)
      );
      if (opt) return String(opt.value);
    }
    return '';
  }

  function getAuthorizedStoreIds() {
    const ids = new Set();
    if (typeof allowedLocations !== 'undefined' && Array.isArray(allowedLocations)) {
      allowedLocations.forEach((loc) => {
        if (loc && loc.active !== false && loc.id) {
          ids.add(String(loc.id));
        }
      });
    }
    if (typeof els !== 'undefined' && els.store && els.store.options) {
      [...els.store.options].forEach((opt) => {
        if (opt.value) ids.add(String(opt.value));
      });
    }
    return ids;
  }

  function setDraftBannerVisibility(visible, titleText = '', subText = '', targetStoreId = '') {
    const draftBanner = document.getElementById('androidHomeDraftBanner');
    const draftTitle = document.getElementById('androidHomeDraftTitle');
    const draftSub = document.getElementById('androidHomeDraftSub');
    if (!draftBanner) return;
    resumableDraftStoreId = visible ? String(targetStoreId || '') : '';
    if (!visible) {
      draftBanner.hidden = true;
      draftBanner.style.display = 'none';
      draftBanner.setAttribute('aria-hidden', 'true');
      return;
    }
    if (draftTitle && titleText) draftTitle.textContent = titleText;
    if (draftSub && subText) draftSub.textContent = subText;
    draftBanner.hidden = false;
    draftBanner.style.display = '';
    draftBanner.setAttribute('aria-hidden', 'false');
  }

  async function evaluateAndroidHomeDraftBanner() {
    const seq = ++draftEvaluationSeq;
    const scopeUser = String(
      root.skaleeRegistrationDraft?.scope?.()?.userId || currentAndroidUserId || ''
    ).trim();

    if (!scopeUser || !root.SkaleeDraftStore || !root.indexedDB) {
      setDraftBannerVisibility(false);
      return false;
    }

    try {
      const store = root.SkaleeDraftStore.createStore(root.indexedDB);
      const userDrafts = await store.list(scopeUser);
      if (seq !== draftEvaluationSeq) return false;

      const activeStoreName = getAndroidActiveStoreName();
      const activeStoreId = activeStoreName ? getStoreIdForStoreName(activeStoreName) : '';
      const authorizedIds = getAuthorizedStoreIds();
      const currentFormStoreId = String(
        (typeof els !== 'undefined' && els.store?.value) ||
        root.skaleeRegistrationDraft?.scope?.()?.storeId ||
        ''
      );

      const scopedDrafts = (Array.isArray(userDrafts) ? userDrafts : []).filter((draft) => {
        if (!draft || draft.userId !== scopeUser) return false;
        if (!hasEffectiveDraftContent(draft)) return false;

        const draftLocId = String(draft.originalStoreId ?? draft.storeId ?? '');
        if (activeStoreName) {
          if (!activeStoreId) return false;
          return draftLocId === activeStoreId;
        }
        if (authorizedIds.size > 0) {
          return draftLocId === '' || authorizedIds.has(draftLocId);
        }
        return true;
      });

      if (!scopedDrafts.length) {
        setDraftBannerVisibility(false);
        return false;
      }

      const preferredStoreId = activeStoreId || currentFormStoreId;
      const sortPreferred = (a, b) => {
        const aLoc = String(a.originalStoreId ?? a.storeId ?? '');
        const bLoc = String(b.originalStoreId ?? b.storeId ?? '');
        const aPref = preferredStoreId && aLoc === preferredStoreId ? 1 : 0;
        const bPref = preferredStoreId && bLoc === preferredStoreId ? 1 : 0;
        if (aPref !== bPref) return bPref - aPref;
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      };

      const interruptedDrafts = scopedDrafts
        .filter(
          (d) =>
            !d.originalStoreId &&
            (d.checkpoint?.state === 'sending' || d.checkpoint?.state === 'photo-pending')
        )
        .sort(sortPreferred);

      if (interruptedDrafts.length > 0) {
        const target = interruptedDrafts[0];
        setDraftBannerVisibility(
          true,
          'Cadastro interrompido aguardando conclusão',
          'Toque em Retomar para concluir com segurança.',
          target.storeId
        );
        return true;
      }

      const formDrafts = scopedDrafts
        .filter((d) => !d.originalStoreId && !d.checkpoint)
        .sort(sortPreferred);

      if (formDrafts.length > 0) {
        const target = formDrafts[0];
        setDraftBannerVisibility(
          true,
          'Rascunho automático salvo',
          'Continue o cadastro do produto de onde parou.',
          target.storeId
        );
        return true;
      }

      const pendingStoreDrafts = scopedDrafts
        .filter((d) => Boolean(d.originalStoreId) || d.checkpoint?.state === 'queued')
        .sort(sortPreferred);

      if (pendingStoreDrafts.length > 0) {
        const targetLocId = String(
          pendingStoreDrafts[0].originalStoreId ?? pendingStoreDrafts[0].storeId ?? ''
        );
        const countForLoc = pendingStoreDrafts.filter(
          (d) => String(d.originalStoreId ?? d.storeId ?? '') === targetLocId
        ).length;
        setDraftBannerVisibility(
          true,
          `Cadastros pendentes nesta loja (${countForLoc})`,
          'Toque em Retomar para revisar na aba Cadastrar.',
          targetLocId
        );
        return true;
      }

      setDraftBannerVisibility(false);
      return false;
    } catch (_) {
      setDraftBannerVisibility(false);
      return false;
    }
  }

  function syncAndroidHome() {
    const storePill = document.getElementById('androidHomeStorePill');
    if (storePill) {
      storePill.textContent = getActiveStoreLabel();
    }

    const greetingTitle = document.getElementById('androidHomeGreetingTitle');
    if (greetingTitle && typeof activeUserEmail === 'string' && activeUserEmail) {
      const userName = typeof displayUserName === 'function' ? displayUserName(activeUserEmail) : activeUserEmail.split('@')[0];
      greetingTitle.textContent = `Olá, ${userName}`;
    }

    void evaluateAndroidHomeDraftBanner();

    const allProducts = typeof products !== 'undefined' && Array.isArray(products) ? products : [];
    const selectedStore = typeof els !== 'undefined' && els.storeFilter ? els.storeFilter.value : '';
    const selectedSupplier = typeof els !== 'undefined' && els.supplierFilter ? els.supplierFilter.value.trim().toLowerCase() : '';

    const scopedProducts = allProducts.filter((p) => {
      if (!p || p.completedAt) return false;
      if (selectedStore && p.store !== selectedStore) return false;
      if (selectedSupplier && typeof productHasSupplier === 'function' && !productHasSupplier(p, selectedSupplier)) return false;
      return true;
    });

    const expiredInList = scopedProducts.filter((p) => typeof remaining === 'function' && remaining(p.expiry) < 0).length;
    const todayCount = (typeof dashboardStats !== 'undefined' && dashboardStats)
      ? Number(dashboardStats.today || 0)
      : scopedProducts.filter((p) => typeof remaining === 'function' && remaining(p.expiry) === 0).length;
    const sevenCount = (typeof dashboardStats !== 'undefined' && dashboardStats)
      ? Number(dashboardStats.seven || 0)
      : scopedProducts.filter((p) => typeof remaining === 'function' && remaining(p.expiry) >= 0 && remaining(p.expiry) <= 7).length;
    const offerCount = (typeof dashboardStats !== 'undefined' && dashboardStats)
      ? Number(dashboardStats.offer || 0)
      : scopedProducts.filter((p) => Boolean(p.offer)).length;
    const totalTracked = (typeof dashboardStats !== 'undefined' && dashboardStats)
      ? Number(dashboardStats.products || 0)
      : scopedProducts.filter((p) => typeof remaining === 'function' && remaining(p.expiry) >= 0).length;

    const kpiExpiredVal = document.getElementById('androidKpiExpiredValue');
    const kpiExpiringVal = document.getElementById('androidKpiExpiringValue');
    const kpiOfferVal = document.getElementById('androidKpiOfferValue');
    const trackingCountEl = document.getElementById('androidHomeTrackingCount');

    if (kpiExpiredVal) kpiExpiredVal.textContent = (expiredInList + todayCount).toLocaleString('pt-BR');
    if (kpiExpiringVal) kpiExpiringVal.textContent = sevenCount.toLocaleString('pt-BR');
    if (kpiOfferVal) kpiOfferVal.textContent = offerCount.toLocaleString('pt-BR');
    if (trackingCountEl) {
      trackingCountEl.textContent = `${totalTracked.toLocaleString('pt-BR')} ${totalTracked === 1 ? 'produto' : 'produtos'}`;
    }

    const listContainer = document.getElementById('androidHomeTrackingList');
    if (!listContainer) return;

    const activeTracked = scopedProducts
      .filter((p) => typeof remaining === 'function' && remaining(p.expiry) >= 0)
      .sort((a, b) => remaining(a.expiry) - remaining(b.expiry))
      .slice(0, 12);

    if (!activeTracked.length) {
      const isLoading = typeof productPageLoading !== 'undefined' && productPageLoading;
      listContainer.innerHTML = `<div class="empty">${isLoading ? 'Carregando produtos em acompanhamento...' : 'Nenhum produto em acompanhamento para o filtro atual.'}</div>`;
      return;
    }

    listContainer.innerHTML = activeTracked.map((product) => {
      const days = typeof remaining === 'function' ? remaining(product.expiry) : 0;
      const [label, tone] = typeof status === 'function' ? status(days) : ['Controlado', 'green'];
      const expiryText = product.expiry ? new Date(product.expiry + 'T00:00:00').toLocaleDateString('pt-BR') : '--';
      const normId = String(product.id || '');
      const registered = typeof resolvedProductPhotoState !== 'undefined' ? resolvedProductPhotoState.get(normId) : null;
      const samePath = registered && String(registered.photoPath || '').trim() === String(product.photoPath || '').trim();
      const effectivePhoto = samePath ? (registered.photo || product.photo || '') : (product.photo || '');
      const effectivePhotoLoaded = samePath ? (registered.photoLoaded || product.photoLoaded || false) : (product.photoLoaded || false);
      const photoContent = effectivePhoto
        ? `<img src="${safeEscape(effectivePhoto)}" loading="lazy" decoding="async" alt="">`
        : (effectivePhotoLoaded ? 'Sem foto' : 'Foto...');
      const photoAttrs = (!effectivePhoto && !effectivePhotoLoaded)
        ? ` data-photo-id="${safeEscape(product.id)}"`
        : '';
      const storeName = String(product.store || 'Sem loja').trim();
      const offerBadges = typeof renderOfferBadgesMarkup === 'function'
        ? renderOfferBadgesMarkup(product)
        : (product.offer ? '<span class="badge blue">EM OFERTA</span>' : '');

      return `
        <article class="android-home-card" data-android-product-id="${safeEscape(product.id)}" role="button" tabindex="0" aria-label="Ver detalhes de ${safeEscape(product.name)}">
          <div class="photo"${photoAttrs}>${photoContent}</div>
          <div class="android-home-card-body">
            <div class="android-home-card-name">${safeEscape(product.name)}</div>
            <div class="android-home-card-meta">
              <span>Qtd: <b>${Number(product.qty || 0)} un.</b></span>
              <span>Validade: <b>${safeEscape(expiryText)}</b></span>
              <span>Loja: <b>${safeEscape(storeName)}</b></span>
            </div>
            <div class="android-home-card-badges">
              <span class="badge ${safeEscape(tone)}">${days === 0 ? 'Vence hoje' : safeEscape(label)}</span>
              ${offerBadges}
            </div>
          </div>
        </article>
      `;
    }).join('');

    listContainer.querySelectorAll('.android-home-card[data-android-product-id]').forEach((card) => {
      const openDetails = () => {
        const id = card.dataset.androidProductId;
        const product = allProducts.find((item) => String(item.id) === String(id));
        if (product && typeof openProductDetailModal === 'function') {
          openProductDetailModal(product, card);
        }
      };
      card.addEventListener('click', openDetails);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetails();
        }
      });
    });

    if (typeof queueProductPhotoLoad === 'function') {
      listContainer.querySelectorAll('.photo[data-photo-id]').forEach((slot) => {
        queueProductPhotoLoad(slot.dataset.photoId);
      });
    }
  }

  function syncAndroidWebGLDiagnostics() {
    const diagCard = document.getElementById('androidWebGLDiagCard');
    if (!diagCard) return;

    const currentVisual = document.documentElement.dataset.visualEffect || getStoredVisualEffect();
    const showDiag = (currentVisual === 'webgl' || auroraState.isSimulatingLoss || auroraState.contextLost);
    diagCard.style.display = showDiag ? 'flex' : 'none';

    const dot = document.getElementById('androidWebGLStatusDot');
    const statusText = document.getElementById('androidWebGLStatusText');
    const badge = document.getElementById('androidWebGLDiagBadge');
    const desc = document.getElementById('androidWebGLDiagDesc');
    const btnSimLoss = document.getElementById('androidDiagSimulateLossBtn');
    const btnRestore = document.getElementById('androidDiagRestoreBtn');
    const btnCancelSim = document.getElementById('androidDiagCancelSimBtn');
    const btnUseEco = document.getElementById('androidDiagUseEcoBtn');

    if (!dot || !statusText || !badge || !desc) return;

    dot.className = 'android-webgl-status-dot';
    badge.className = 'android-webgl-diag-badge';

    if (auroraState.isSimulatingLoss) {
      dot.classList.add('warning');
      badge.classList.add('warning');
      statusText.textContent = 'Simulação de perda ativa';
      badge.textContent = 'Fallback CSS';
      desc.textContent = 'Contexto WebGL suspenso para teste. A preferência "Aurora Dinâmica" permanece salva. O app está operando temporariamente com Aurora Suave (CSS).';
      if (btnSimLoss) btnSimLoss.style.display = 'none';
      if (btnRestore) {
        btnRestore.style.display = 'inline-flex';
        btnRestore.textContent = 'Restaurar WebGL';
      }
      if (btnCancelSim) btnCancelSim.style.display = 'inline-flex';
      if (btnUseEco) btnUseEco.style.display = 'inline-flex';
    } else if (auroraState.runtimeStatus === 'recovering') {
      dot.classList.add('recovering');
      statusText.textContent = 'Recuperando WebGL...';
      badge.textContent = 'Reinicializando';
      desc.textContent = 'Restabelecendo contexto e recompilando shaders GPU...';
      if (btnSimLoss) btnSimLoss.style.display = 'none';
      if (btnRestore) btnRestore.style.display = 'none';
      if (btnCancelSim) btnCancelSim.style.display = 'none';
      if (btnUseEco) btnUseEco.style.display = 'inline-flex';
    } else if (auroraState.contextLost || auroraState.runtimeStatus === 'context_lost' || auroraState.runtimeStatus === 'unavailable') {
      dot.classList.add('danger');
      badge.classList.add('danger');
      statusText.textContent = 'WebGL Indisponível';
      badge.textContent = 'Fallback CSS Ativo';
      desc.textContent = 'O contexto WebGL foi perdido pelo sistema. A Aurora Suave (CSS) foi ativada como proteção. Sua preferência original continua salva.';
      if (btnSimLoss) btnSimLoss.style.display = 'none';
      if (btnRestore) {
        btnRestore.style.display = 'inline-flex';
        btnRestore.textContent = 'Tentar recuperar WebGL';
      }
      if (btnCancelSim) btnCancelSim.style.display = 'none';
      if (btnUseEco) btnUseEco.style.display = 'inline-flex';
    } else {
      statusText.textContent = 'WebGL Ativo (Shader GPU)';
      badge.textContent = 'GPU Shader';
      desc.textContent = 'Aceleração gráfica ativa com shader Simplex Noise 2D em 30 FPS adaptativos.';
      if (btnSimLoss) btnSimLoss.style.display = 'inline-flex';
      if (btnRestore) btnRestore.style.display = 'none';
      if (btnCancelSim) btnCancelSim.style.display = 'none';
      if (btnUseEco) btnUseEco.style.display = 'none';
    }

    const details = document.getElementById('androidWebGLDiagDetails');
    if (details && (auroraState.isSimulatingLoss || auroraState.contextLost)) {
      details.open = true;
    }

    syncAndroidFallbackBanner();
  }

  function syncAndroidFallbackBanner() {
    let banner = document.getElementById('androidFallbackBanner');
    const isLossActive = auroraState.isSimulatingLoss || (auroraState.contextLost && (document.documentElement.dataset.visualEffect === 'webgl'));
    
    // Se estiver no Perfil (onde o diagnóstico já é visível) ou se foi dispensado ou sem perda ativa:
    if (currentAndroidTab === 'android-profile' || auroraState.fallbackBannerDismissed || !isLossActive) {
      if (banner) banner.style.display = 'none';
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'androidFallbackBanner';
      banner.className = 'android-fallback-banner';
      const app = getAppContainer() || document.body;
      app.appendChild(banner);
    }

    banner.innerHTML = `
      <span class="android-fallback-banner-text">⚠️ ${auroraState.isSimulatingLoss ? 'Simulação de perda WebGL ativa (CSS).' : 'WebGL indisponível (Fallback CSS ativo).'}</span>
      <div class="android-fallback-banner-actions">
        <button type="button" id="androidBannerRestoreBtn" class="android-fallback-banner-restore">Restaurar WebGL</button>
        <button type="button" id="androidBannerDismissBtn" class="android-fallback-banner-dismiss" aria-label="Dispensar aviso" title="Dispensar aviso">✕</button>
      </div>
    `;
    banner.style.display = 'flex';
    banner.querySelector('#androidBannerRestoreBtn')?.addEventListener('click', () => {
      restoreWebGL();
    });
    banner.querySelector('#androidBannerDismissBtn')?.addEventListener('click', () => {
      auroraState.fallbackBannerDismissed = true;
      banner.style.display = 'none';
    });
  }

  function syncAndroidProfile() {
    const nameEl = document.getElementById('androidProfileName');
    const emailEl = document.getElementById('androidProfileEmail');
    const roleEl = document.getElementById('androidProfileRole');
    const avatarEl = document.getElementById('androidProfileAvatar');

    const nameText = (typeof els !== 'undefined' && els.personalUserName?.textContent) || 'Usuário';
    const emailText = (typeof els !== 'undefined' && els.personalProfileEmail?.textContent) || (typeof activeUserEmail === 'string' && activeUserEmail) || 'Usuário autenticado';
    const roleText = (typeof els !== 'undefined' && els.personalUserRole?.textContent) || 'Usuário normal';

    if (nameEl) nameEl.textContent = nameText;
    if (emailEl) emailEl.textContent = emailText;
    if (roleEl) roleEl.textContent = roleText;
    if (avatarEl) {
      const initials = nameText
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('') || 'SK';
      avatarEl.textContent = initials;
    }

    const storesContainer = document.getElementById('androidProfileStores');
    if (storesContainer) {
      const locs = typeof allowedLocations !== 'undefined' && Array.isArray(allowedLocations)
        ? allowedLocations.filter((l) => l.active !== false)
        : [];
      if (locs.length) {
        storesContainer.innerHTML = locs
          .map((loc) => `<span class="android-profile-tag">${safeEscape(loc.name)}</span>`)
          .join('');
      } else {
        storesContainer.innerHTML = '<span class="android-profile-tag">Todas as lojas autorizadas</span>';
      }
    }

    const suppliersCard = document.getElementById('androidProfileSuppliersCard');
    const suppliersContainer = document.getElementById('androidProfileSuppliers');
    if (suppliersCard && suppliersContainer) {
      const supps = typeof allowedSuppliers !== 'undefined' && Array.isArray(allowedSuppliers)
        ? allowedSuppliers.filter((s) => s.active !== false)
        : [];
      suppliersCard.hidden = !supps.length;
      if (supps.length) {
        suppliersContainer.innerHTML = supps
          .map((s) => `<span class="android-profile-tag">${safeEscape(s.name || s.code)}</span>`)
          .join('');
      }
    }

    const currentPref = document.documentElement.dataset.themePreference || 'auto';
    document.querySelectorAll('[data-android-theme]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.androidTheme === currentPref);
    });

    const userPref = getStoredVisualEffect();
    document.querySelectorAll('[data-visual-effect]').forEach((card) => {
      const isChoiceActive = card.dataset.visualEffect === userPref;
      card.classList.toggle('active', isChoiceActive);
      card.setAttribute('aria-checked', isChoiceActive ? 'true' : 'false');

      if (card.dataset.visualEffect === 'webgl') {
        const descEl = card.querySelector('.android-visual-card-desc');
        if (descEl) {
          if (auroraState.isFallback && !auroraState.isSimulatingLoss) {
            descEl.innerHTML = '<span style="color:#f59e0b;font-weight:700;">Aurora Suave ativa temporariamente · Toque para tentar novamente</span>';
          } else if (auroraState.isSimulatingLoss) {
            descEl.innerHTML = '<span style="color:#f59e0b;font-weight:700;">Simulação de perda ativa (CSS)</span>';
          } else {
            descEl.textContent = 'Movimento orgânico fluido com shader';
          }
        }
      }
    });

    const backgroundStyle = getStoredBackgroundStyle();
    document.querySelectorAll('[data-background-style]').forEach((btn) => {
      const active = btn.dataset.backgroundStyle === backgroundStyle;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    syncAndroidWebGLDiagnostics();

    const adminBtn = document.getElementById('androidProfileAdminBtn');
    const auditBtn = document.getElementById('androidProfileAuditBtn');
    if (auditBtn) auditBtn.hidden = !canOpenAudit();
    const registerBtn = document.querySelector('#androidBottomNav [data-android-page="register"]');
    if (registerBtn) registerBtn.disabled = typeof isViewer !== 'undefined' && isViewer;
    const posterBtn = document.getElementById('androidProfilePosterBtn');
    if (adminBtn && typeof els !== 'undefined' && els.adminCentralButton) {
      adminBtn.hidden = Boolean(els.adminCentralButton.hidden);
    }
    if (posterBtn && typeof els !== 'undefined' && els.posterTab) {
      posterBtn.hidden = Boolean(els.posterTab.hidden);
    }
    syncGlassAppearance();
  }

  function syncAndroidData() {
    if (!mobileUIActive) return;
    enforceActiveAndroidPage(currentAndroidTab);
    applyAndroidProductsView(readAndroidProductsViewPreference(), false);
    syncAndroidHeader();
    syncAndroidHome();
    syncAndroidProfile();
    ensureAuditRestrictedBanner();
  }

  function observePageIsolation() {
    document.querySelectorAll('nav.main-nav .tab[data-page]').forEach((legacyTab) => {
      legacyTab.addEventListener('click', () => {
        if (!mobileUIActive) return;
        if (!userSelectedTabManually) {
          const pendingCamera = Boolean(root.localStorage?.getItem('skalee.camera.pending.v1'));
          currentAndroidTab = pendingCamera ? 'register' : 'android-home';
        }
        enforceActiveAndroidPage(currentAndroidTab);
      });
    });

    if (!('MutationObserver' in root)) return;

    const pageObserver = new MutationObserver(() => {
      if (!mobileUIActive || enforcingPageState) return;
      const pages = document.querySelectorAll('.page');
      let outOfSync = false;
      pages.forEach((section) => {
        const shouldBeActive = section.id === currentAndroidTab;
        if (section.classList.contains('active') !== shouldBeActive || section.hidden !== !shouldBeActive) {
          outOfSync = true;
        }
      });
      if (outOfSync) {
        enforceActiveAndroidPage(currentAndroidTab);
      }
    });

    const attachPageObservers = () => {
      document.querySelectorAll('.page').forEach((section) => {
        if (section.dataset.androidPageObserved === '1') return;
        section.dataset.androidPageObserved = '1';
        pageObserver.observe(section, {
          attributes: true,
          attributeFilter: ['class', 'hidden']
        });
      });
    };

    attachPageObservers();
    const app = getAppContainer();
    if (app) {
      const containerObserver = new MutationObserver(() => {
        attachPageObservers();
        if (!enforcingPageState) {
          enforceActiveAndroidPage(currentAndroidTab);
        }
      });
      containerObserver.observe(app, { childList: true });
    }
  }

  function installAndroidStoreAndPanelHooks() {
    if (typeof root.popularLojasPermitidas === 'function' && !root.popularLojasPermitidas.__androidWrapped) {
      const originalPopularLojasPermitidas = root.popularLojasPermitidas;
      const wrappedPopularLojasPermitidas = function (locations) {
        const result = originalPopularLojasPermitidas.apply(this, arguments);
        storeValidatedForCurrentUser = false;
        applyAndroidActiveStore(undefined, {
          useSavedPreference: true,
          persist: true,
          reloadProducts: true,
          reloadNotifications: true
        });
        return result;
      };
      wrappedPopularLojasPermitidas.__androidWrapped = true;
      root.popularLojasPermitidas = wrappedPopularLojasPermitidas;
    }

    if (typeof root.setPersonalPanelOpen === 'function' && !root.setPersonalPanelOpen.__androidWrapped) {
      const originalSetPersonalPanelOpen = root.setPersonalPanelOpen;
      const wrappedSetPersonalPanelOpen = function (open) {
        if (open && !isSyncingStoreSelection) {
          const activeStore = getAndroidActiveStoreName();
          applyAndroidActiveStore(activeStore, {
            persist: false,
            reloadProducts: false,
            reloadNotifications: false
          });
        }
        return originalSetPersonalPanelOpen.apply(this, arguments);
      };
      wrappedSetPersonalPanelOpen.__androidWrapped = true;
      root.setPersonalPanelOpen = wrappedSetPersonalPanelOpen;
    }

    if (typeof els !== 'undefined') {
      if (els.storeFilter && !els.storeFilter.dataset.androidStoreBound) {
        els.storeFilter.dataset.androidStoreBound = '1';
        els.storeFilter.addEventListener('change', () => {
          if (isSyncingStoreSelection) return;
          applyAndroidActiveStore(els.storeFilter.value, {
            persist: true,
            reloadProducts: false,
            reloadNotifications: true
          });
        });
      }

      if (els.notificationCenterStore && !els.notificationCenterStore.dataset.androidStoreBound) {
        els.notificationCenterStore.dataset.androidStoreBound = '1';
        els.notificationCenterStore.addEventListener('change', () => {
          if (isSyncingStoreSelection) return;
          applyAndroidActiveStore(els.notificationCenterStore.value, {
            persist: true,
            reloadProducts: true,
            reloadNotifications: false
          });
        });
      }

      if (els.notificationStore && !els.notificationStore.dataset.androidStoreBound) {
        els.notificationStore.dataset.androidStoreBound = '1';
        els.notificationStore.addEventListener('change', () => {
          if (isSyncingStoreSelection) return;
          applyAndroidActiveStore(els.notificationStore.value, {
            persist: true,
            reloadProducts: true,
            reloadNotifications: false
          });
        });
      }

      if (els.store && !els.store.dataset.androidDraftBound) {
        els.store.dataset.androidDraftBound = '1';
        els.store.addEventListener('change', () => {
          void evaluateAndroidHomeDraftBanner();
        });
      }
    }

    root.addEventListener('skalee:draft-changed', () => {
      void evaluateAndroidHomeDraftBanner();
    });
  }

  /* ==========================================================================
     SKALEE SOFT AURORA ENGINE (Titanium Glass 2.1)
     - Tema Escuro: CSS Aurora Mesh nativo (GPU Compositor, 60 FPS, 0 ms JS)
     - Tema Claro: WebGL Soft Aurora (Shader 2D Simplex, 30 FPS cap, 0.5x res)
     - Pausa automática fora da Home, em segundo plano ou com prefers-reduced-motion
     - Fallback automático para CSS Mesh em perda de contexto WebGL
     ========================================================================== */
  const auroraState = {
    initialized: false,
    webglGl: null,
    webglProgram: null,
    webglAnimationId: null,
    loseContextExt: null,
    uTimeLoc: null,
    uResLoc: null,
    uThemeLoc: null,
    uIntensityLoc: null,
    contextLost: false,
    isSimulatingLoss: false,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3,
    runtimeStatus: 'active', // 'active' | 'simulated_loss' | 'context_lost' | 'unavailable' | 'recovering'
    intensity: 0.85,
    fpsCap: 30,
    resolutionScale: 0.5,
    startTime: performance.now(),
    lastRenderTime: 0,
    webglActive: false,
    userChoice: 'css',
    activeEngine: 'css',
    isFallback: false,
    fallbackReason: null,
    fallbackBannerDismissed: false
  };

  const vsSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uTheme;
    uniform float uIntensity;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                          -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                             + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m;
      m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 st = gl_FragCoord.xy / uResolution.xy;
      st.y = 1.0 - st.y;

      float t = uTime * 0.16;
      vec2 p = vec2(st.x * 2.2, st.y * 1.6);
      float n1 = snoise(p + vec2(t * 0.4, t * 0.2));
      float n2 = snoise(p * 1.5 - vec2(t * 0.3, t * 0.5));
      float combinedNoise = (n1 * 0.65 + n2 * 0.35) * 0.5 + 0.5;

      vec3 darkBase   = vec3(0.027, 0.043, 0.071);
      vec3 darkBlue   = vec3(0.0, 0.467, 1.0);
      vec3 darkCyan   = vec3(0.0, 0.851, 1.0);
      vec3 darkIndigo = vec3(0.388, 0.400, 0.945);

      vec3 lightBase  = vec3(0.945, 0.961, 0.976);
      vec3 lightBlue  = vec3(0.220, 0.741, 0.973);
      vec3 lightCyan  = vec3(0.490, 0.839, 0.988);
      vec3 lightLilac = vec3(0.659, 0.686, 0.980);

      vec3 color;
      if (uTheme < 0.5) {
        vec3 auroraTint = mix(darkBlue, darkCyan, sin(combinedNoise * 3.1415 + t) * 0.5 + 0.5);
        auroraTint = mix(auroraTint, darkIndigo, clamp(n2, 0.0, 1.0) * 0.4);
        color = mix(darkBase, auroraTint, combinedNoise * uIntensity * 0.85);
      } else {
        vec3 auroraTint = mix(lightBlue, lightCyan, sin(combinedNoise * 3.1415 + t) * 0.5 + 0.5);
        auroraTint = mix(auroraTint, lightLilac, clamp(n2, 0.0, 1.0) * 0.35);
        color = mix(lightBase, auroraTint, combinedNoise * uIntensity * 0.65);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function createAuroraShader(glCtx, type, source) {
    if (!glCtx) return null;
    try {
      if (typeof glCtx.isContextLost === 'function' && glCtx.isContextLost()) return null;
      const shader = glCtx.createShader(type);
      if (!shader) return null;
      glCtx.shaderSource(shader, source);
      glCtx.compileShader(shader);
      if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        const info = glCtx.getShaderInfoLog(shader);
        if (info && info.trim()) {
          console.warn('[Skalee Aurora] Erro de compilação de shader:', info);
        }
        glCtx.deleteShader(shader);
        return null;
      }
      return shader;
    } catch (_) {
      return null;
    }
  }

  function initAuroraWebGL() {
    const canvas = document.getElementById('androidAuroraCanvas');
    if (!canvas) return false;
    try {
      const w = window.innerWidth || 393;
      const h = window.innerHeight || 852;
      canvas.width = Math.max(1, Math.round(w * auroraState.resolutionScale));
      canvas.height = Math.max(1, Math.round(h * auroraState.resolutionScale));

      const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      });

      if (!gl || (typeof gl.isContextLost === 'function' && gl.isContextLost())) {
        auroraState.contextLost = true;
        return false;
      }

      const vs = createAuroraShader(gl, gl.VERTEX_SHADER, vsSource);
      const fs = createAuroraShader(gl, gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return false;

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[Skalee Aurora] Falha ao linkar shader WebGL');
        return false;
      }

      gl.useProgram(program);

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
      ]), gl.STATIC_DRAW);

      const aPosLoc = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

      auroraState.webglGl = gl;
      auroraState.webglProgram = program;
      auroraState.loseContextExt = gl.getExtension('WEBGL_lose_context') || gl.getExtension('MOZ_WEBGL_lose_context') || gl.getExtension('WEBKIT_WEBGL_lose_context');
      auroraState.uTimeLoc = gl.getUniformLocation(program, 'uTime');
      auroraState.uResLoc = gl.getUniformLocation(program, 'uResolution');
      auroraState.uThemeLoc = gl.getUniformLocation(program, 'uTheme');
      auroraState.uIntensityLoc = gl.getUniformLocation(program, 'uIntensity');
      auroraState.contextLost = false;
      if (!auroraState.isSimulatingLoss) {
        auroraState.runtimeStatus = 'active';
      }

      return true;
    } catch (e) {
      console.warn('[Skalee Aurora] Exceção ao inicializar WebGL:', e);
      auroraState.contextLost = true;
      auroraState.runtimeStatus = 'unavailable';
      return false;
    }
  }

  function renderAuroraWebGL(now) {
    if (!auroraState.webglActive || auroraState.contextLost) return;
    const gl = auroraState.webglGl;
    const program = auroraState.webglProgram;
    if (!gl || !program) return;

    const elapsed = now - auroraState.lastRenderTime;
    const targetInterval = 1000 / auroraState.fpsCap;

    if (elapsed < targetInterval) {
      auroraState.webglAnimationId = requestAnimationFrame(renderAuroraWebGL);
      return;
    }

    auroraState.lastRenderTime = now - (elapsed % targetInterval);

    const canvas = document.getElementById('androidAuroraCanvas');
    if (canvas) {
      const w = Math.max(1, Math.round((window.innerWidth || 393) * auroraState.resolutionScale));
      const h = Math.max(1, Math.round((window.innerHeight || 852) * auroraState.resolutionScale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    const timeSec = (now - auroraState.startTime) / 1000.0;
    const isLight = document.documentElement.dataset.theme === 'light';

    gl.uniform1f(auroraState.uTimeLoc, timeSec);
    gl.uniform2f(auroraState.uResLoc, canvas ? canvas.width : 300, canvas ? canvas.height : 600);
    gl.uniform1f(auroraState.uThemeLoc, isLight ? 1.0 : 0.0);
    gl.uniform1f(auroraState.uIntensityLoc, auroraState.intensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    auroraState.webglAnimationId = requestAnimationFrame(renderAuroraWebGL);
  }

  function showDemandingEffectAdvisoryIfNeeded() {
    try {
      if (sessionStorage.getItem('skalee.batteryNoticeShown')) return;
      sessionStorage.setItem('skalee.batteryNoticeShown', '1');
    } catch (_) {}

    let toast = document.getElementById('androidAdvisoryToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'androidAdvisoryToast';
      toast.className = 'android-advisory-toast';
      const app = getAppContainer() || document.body;
      app.appendChild(toast);
    }

    toast.innerHTML = `
      <div class="android-advisory-icon" aria-hidden="true">⚡</div>
      <div class="android-advisory-body">
        <strong>Aurora Dinâmica ativada</strong>
        <span>Este efeito pode aumentar o consumo de bateria e reduzir a fluidez em alguns dispositivos.</span>
      </div>
      <button type="button" class="android-advisory-close" aria-label="Fechar aviso">✕</button>
    `;
    toast.style.display = 'flex';

    const closeBtn = toast.querySelector('.android-advisory-close');
    closeBtn?.addEventListener('click', () => {
      toast.style.display = 'none';
    });

    setTimeout(() => {
      if (toast && toast.style.display !== 'none') {
        toast.style.display = 'none';
      }
    }, 4500);
  }

  const ANDROID_VISUAL_EFFECT_KEY = 'skalee.visualEffect';
  const ANDROID_BACKGROUND_STYLE_KEY = 'skalee.backgroundStyle';
  const GLASS_BACKGROUND_KEY = 'skalee.glassBackground';
  const GLASS_TUNING_KEY = 'skalee.glassTuning';
  const GLASS_WALLPAPER_META_KEY = 'skalee.glassWallpaper';
  let pendingGlassWallpaper = null;

  function glassTuningDefaults() {
    return { blur: 18, intensity: 72, dim: 18 };
  }

  function getStoredGlassTuning() {
    try {
      const parsed = JSON.parse(root.localStorage?.getItem(GLASS_TUNING_KEY) || '{}');
      const defaults = glassTuningDefaults();
      return { blur: Number(parsed.blur) || defaults.blur, intensity: Number(parsed.intensity) || defaults.intensity, dim: Number(parsed.dim) || defaults.dim };
    } catch (_) { return glassTuningDefaults(); }
  }

  function applyGlassTuning(values = getStoredGlassTuning()) {
    const tuning = { blur: Math.max(6, Math.min(30, Number(values.blur) || 18)), intensity: Math.max(45, Math.min(90, Number(values.intensity) || 72)), dim: Math.max(0, Math.min(45, Number(values.dim) || 18)) };
    document.documentElement.style.setProperty('--sk-glass-blur', `${tuning.blur}px`);
    document.documentElement.style.setProperty('--sk-glass-alpha', `${tuning.intensity}%`);
    document.documentElement.style.setProperty('--sk-glass-dim', `${(tuning.dim / 100).toFixed(2)}`);
    const profile = document.getElementById('android-profile');
    if (profile) {
      const fields = [['androidGlassBlurRange', tuning.blur], ['androidGlassIntensityRange', tuning.intensity], ['androidGlassDimRange', tuning.dim]];
      fields.forEach(([id, value]) => { const input = profile.querySelector(`#${id}`); if (input) input.value = String(value); });
      const labels = [['androidGlassBlurValue', `${tuning.blur}px`], ['androidGlassIntensityValue', `${tuning.intensity}%`], ['androidGlassDimValue', `${tuning.dim}%`]];
      labels.forEach(([id, value]) => { const output = profile.querySelector(`#${id}`); if (output) output.textContent = value; });
    }
    return tuning;
  }

  function setGlassTuning(key, value) {
    const next = { ...getStoredGlassTuning(), [key]: Number(value) };
    try { root.localStorage?.setItem(GLASS_TUNING_KEY, JSON.stringify(next)); } catch (_) {}
    applyGlassTuning(next);
  }

  function getStoredGlassBackground() {
    try {
      const value = root.localStorage?.getItem(GLASS_BACKGROUND_KEY);
      return value === 'image' ? 'image' : 'titanium';
    } catch (_) { return 'titanium'; }
  }

  async function readGlassWallpaper() {
    try { return await root.skaleeLocalStore?.getMeta(GLASS_WALLPAPER_META_KEY, null); } catch (_) { return null; }
  }

  function applyGlassWallpaperCss(dataUrl, active) {
    const rootEl = document.documentElement;
    if (active && dataUrl) rootEl.style.setProperty('--sk-glass-wallpaper', `url("${String(dataUrl).replace(/"/g, '%22')}")`);
    else rootEl.style.removeProperty('--sk-glass-wallpaper');
    rootEl.dataset.glassWallpaper = active ? 'image' : 'none';
  }

  function setStoredGlassBackground(choice) {
    if (!['titanium', 'image'].includes(choice)) return;
    try { root.localStorage?.setItem(GLASS_BACKGROUND_KEY, choice); } catch (_) {}
    document.documentElement.dataset.glassBackground = choice;
    document.documentElement.dataset.backgroundStyle = choice;
    document.querySelectorAll('[data-glass-background]').forEach((btn) => {
      const active = btn.dataset.glassBackground === choice;
      btn.classList.toggle('active', active); btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (choice !== 'image') applyGlassWallpaperCss('', false);
  }

  function glassWallpaperImageFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) return reject(new Error('Selecione JPG, PNG ou WebP de até 8 MB.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const image = new Image(); image.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({ dataUrl: canvas.toDataURL('image/webp', 0.82), width: canvas.width, height: canvas.height });
        }; image.onerror = () => reject(new Error('Não foi possível decodificar a imagem.')); image.src = String(reader.result);
      }; reader.readAsDataURL(file);
    });
  }

  async function prepareGlassWallpaper(file) {
    const status = document.getElementById('androidGlassWallpaperStatus');
    try {
      pendingGlassWallpaper = await glassWallpaperImageFromFile(file);
      applyGlassWallpaperCss(pendingGlassWallpaper.dataUrl, true);
      setStoredGlassBackground('image');
      if (status) status.textContent = 'Prévia pronta. Toque em Aplicar imagem para salvar no dispositivo.';
      document.getElementById('androidGlassWallpaperApplyBtn')?.removeAttribute('hidden');
      document.getElementById('androidGlassWallpaperCancelBtn')?.removeAttribute('hidden');
    } catch (error) { pendingGlassWallpaper = null; if (status) status.textContent = error.message || 'Imagem inválida.'; }
  }

  async function applyPendingGlassWallpaper() {
    if (!pendingGlassWallpaper) return;
    const saved = await root.skaleeLocalStore?.setMeta(GLASS_WALLPAPER_META_KEY, { ...pendingGlassWallpaper, updatedAt: Date.now() });
    if (saved !== true) { const status = document.getElementById('androidGlassWallpaperStatus'); if (status) status.textContent = 'Armazenamento local indisponível. A imagem não foi salva.'; return; }
    pendingGlassWallpaper = null;
    document.getElementById('androidGlassWallpaperApplyBtn')?.setAttribute('hidden', '');
    document.getElementById('androidGlassWallpaperCancelBtn')?.setAttribute('hidden', '');
    document.getElementById('androidGlassWallpaperRemoveBtn')?.removeAttribute('hidden');
    const status = document.getElementById('androidGlassWallpaperStatus'); if (status) status.textContent = 'Imagem salva somente neste dispositivo.';
  }

  function cancelPendingGlassWallpaper() {
    pendingGlassWallpaper = null;
    void restoreGlassWallpaper();
  }

  async function removeGlassWallpaper() {
    await root.skaleeLocalStore?.removeMeta(GLASS_WALLPAPER_META_KEY);
    pendingGlassWallpaper = null; applyGlassWallpaperCss('', false); setStoredGlassBackground('titanium');
    const status = document.getElementById('androidGlassWallpaperStatus'); if (status) status.textContent = 'Imagem removida. Textura Titanium restaurada.';
  }

  async function restoreGlassWallpaper() {
    const wallpaper = await readGlassWallpaper();
    if (wallpaper?.dataUrl) applyGlassWallpaperCss(wallpaper.dataUrl, true);
    else applyGlassWallpaperCss('', false);
    document.getElementById('androidGlassWallpaperApplyBtn')?.setAttribute('hidden', '');
    document.getElementById('androidGlassWallpaperCancelBtn')?.setAttribute('hidden', '');
    const remove = document.getElementById('androidGlassWallpaperRemoveBtn');
    if (remove) remove.hidden = !wallpaper?.dataUrl;
  }

  function syncGlassAppearance() {
    document.querySelectorAll('[data-theme-customization]').forEach((node) => { node.hidden = false; });
    applyGlassTuning();
    const background = getStoredGlassBackground();
    document.documentElement.dataset.glassBackground = background;
    document.documentElement.dataset.backgroundStyle = background;
    document.querySelectorAll('[data-glass-background]').forEach((btn) => {
      const active = btn.dataset.glassBackground === background;
      btn.classList.toggle('active', active); btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    void restoreGlassWallpaper();
    const remove = document.getElementById('androidGlassWallpaperRemoveBtn'); if (remove) remove.hidden = background !== 'image';
  }

  function getStoredBackgroundStyle() {
    try {
      const value = root.localStorage?.getItem(ANDROID_BACKGROUND_STYLE_KEY);
      if (value === 'image') return 'image';
      if (value === 'solid' || value === 'textured' || value === 'dynamic' || value === 'aurora') return 'titanium';
    } catch (_) {}
    return 'titanium';
  }

  function setStoredBackgroundStyle(choice) {
    const normalized = choice === 'image' ? 'image' : 'titanium';
    try { root.localStorage?.setItem(ANDROID_BACKGROUND_STYLE_KEY, normalized); } catch (_) {}
    document.documentElement.dataset.backgroundStyle = normalized;
    document.querySelectorAll('[data-background-style]').forEach((btn) => {
      const active = btn.dataset.backgroundStyle === normalized;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  document.documentElement.dataset.backgroundStyle = getStoredBackgroundStyle();

  function getStoredVisualEffect() {
    try {
      const val = root.localStorage?.getItem(ANDROID_VISUAL_EFFECT_KEY);
      if (val === 'webgl' || val === 'css' || val === 'eco') return val;
    } catch (_) {}
    const theme = document.documentElement.dataset.theme || 'dark';
    return theme === 'light' ? 'webgl' : 'css';
  }

  function setStoredVisualEffect(choice) {
    if (choice !== 'webgl' && choice !== 'css' && choice !== 'eco') return;
    try {
      root.localStorage?.setItem(ANDROID_VISUAL_EFFECT_KEY, choice);
    } catch (_) {}

    auroraState.userChoice = choice;
    auroraState.isSimulatingLoss = false;

    if (choice === 'webgl') {
      auroraState.contextLost = false;
      auroraState.recoveryAttempts = 0;
      auroraState.fallbackBannerDismissed = false;

      // Mostra aviso informativo sobre bateria (apenas uma vez por sessão)
      showDemandingEffectAdvisoryIfNeeded();

      // Tenta ativar o motor WebGL
      const success = initAuroraWebGL();
      if (success && !auroraState.contextLost) {
        auroraState.activeEngine = 'webgl';
        auroraState.isFallback = false;
        auroraState.fallbackReason = null;
        auroraState.runtimeStatus = 'active';
      } else {
        // Fallback automático para CSS se WebGL não iniciar
        auroraState.activeEngine = 'css';
        auroraState.isFallback = true;
        auroraState.fallbackReason = 'unsupported';
        auroraState.runtimeStatus = 'unavailable';
      }
    } else if (choice === 'css') {
      stopAuroraWebGLLoop();
      auroraState.activeEngine = 'css';
      auroraState.isFallback = false;
      auroraState.fallbackReason = null;
      auroraState.runtimeStatus = 'active';
      auroraState.fallbackBannerDismissed = true;
    } else if (choice === 'eco') {
      stopAuroraWebGLLoop();
      auroraState.activeEngine = 'eco';
      auroraState.isFallback = false;
      auroraState.fallbackReason = null;
      auroraState.runtimeStatus = 'active';
      auroraState.fallbackBannerDismissed = true;
    }

    applyVisualEffect();
  }

  function applyVisualEffect(choice) {
    const userPref = (choice === 'webgl' || choice === 'css' || choice === 'eco') ? choice : getStoredVisualEffect();
    auroraState.userChoice = userPref;

    if (!auroraState.activeEngine) {
      if (userPref === 'webgl' && (auroraState.contextLost || auroraState.isSimulatingLoss)) {
        auroraState.activeEngine = 'css';
        auroraState.isFallback = true;
      } else {
        auroraState.activeEngine = userPref;
        auroraState.isFallback = false;
      }
    }

    document.documentElement.dataset.visualPreference = userPref;
    document.documentElement.dataset.visualEffect = auroraState.activeEngine;

    updateAuroraEngine();
    syncAndroidProfile();
  }

  function simulateWebGLLoss() {
    if (auroraState.isSimulatingLoss) return;
    auroraState.isSimulatingLoss = true;
    auroraState.contextLost = true;
    auroraState.runtimeStatus = 'simulated_loss';
    auroraState.activeEngine = 'css';
    auroraState.isFallback = true;
    auroraState.fallbackReason = 'simulated_loss';
    auroraState.fallbackBannerDismissed = false;

    stopAuroraWebGLLoop();
    document.documentElement.dataset.visualEffect = 'css';
    updateAuroraEngine();
    syncAndroidProfile();

    if (auroraState.loseContextExt && typeof auroraState.loseContextExt.loseContext === 'function') {
      try {
        auroraState.loseContextExt.loseContext();
      } catch (e) {
        console.warn('[Skalee Aurora] Falha ao chamar loseContext:', e);
      }
    }
  }

  function restoreWebGL() {
    auroraState.isSimulatingLoss = false;
    auroraState.contextLost = false;
    auroraState.runtimeStatus = 'recovering';
    auroraState.recoveryAttempts = 0;
    auroraState.fallbackBannerDismissed = false;

    let restoredViaExt = false;
    if (auroraState.loseContextExt && typeof auroraState.loseContextExt.restoreContext === 'function') {
      try {
        if (auroraState.webglGl && typeof auroraState.webglGl.isContextLost === 'function' && auroraState.webglGl.isContextLost()) {
          auroraState.loseContextExt.restoreContext();
          restoredViaExt = true;
        }
      } catch (e) {
        console.warn('[Skalee Aurora] Falha ao chamar restoreContext:', e);
      }
    }

    if (!restoredViaExt) {
      const success = initAuroraWebGL();
      if (success && !auroraState.contextLost) {
        auroraState.runtimeStatus = 'active';
        auroraState.activeEngine = 'webgl';
        auroraState.isFallback = false;
        auroraState.fallbackReason = null;
      } else {
        auroraState.runtimeStatus = 'unavailable';
        auroraState.activeEngine = 'css';
        auroraState.isFallback = true;
        auroraState.fallbackReason = 'unsupported';
      }
      document.documentElement.dataset.visualEffect = auroraState.activeEngine;
      updateAuroraEngine();
      syncAndroidProfile();
    }
  }

  function disableWebGLSimulation() {
    restoreWebGL();
  }

  function useModoEconomicoFromDiag() {
    auroraState.isSimulatingLoss = false;
    auroraState.contextLost = false;
    auroraState.isFallback = false;
    setStoredVisualEffect('eco');
  }

  function startAuroraWebGLLoop() {
    if (auroraState.contextLost || auroraState.isSimulatingLoss) return;
    if (auroraState.webglActive && auroraState.webglAnimationId) return;
    if (auroraState.webglAnimationId) {
      cancelAnimationFrame(auroraState.webglAnimationId);
      auroraState.webglAnimationId = null;
    }
    if (!auroraState.webglGl || (typeof auroraState.webglGl.isContextLost === 'function' && auroraState.webglGl.isContextLost())) {
      if (!initAuroraWebGL()) return;
    }
    auroraState.webglActive = true;
    auroraState.lastRenderTime = performance.now();
    auroraState.webglAnimationId = requestAnimationFrame(renderAuroraWebGL);
  }

  function stopAuroraWebGLLoop() {
    auroraState.webglActive = false;
    if (auroraState.webglAnimationId) {
      cancelAnimationFrame(auroraState.webglAnimationId);
      auroraState.webglAnimationId = null;
    }
  }

  function updateAuroraEngine() {
    // Titanium 2.6 usa somente a textura Titanium ou wallpaper local.
    // Mantemos o módulo carregável para compatibilidade, mas não iniciamos
    // WebGL/CSS Aurora nem loops de animação no shell Android.
    stopAuroraWebGLLoop();
    const retiredAurora = document.getElementById('androidAuroraContainer');
    if (retiredAurora) retiredAurora.hidden = true;
    auroraState.activeEngine = 'eco';
    return;
    /* legacy Aurora engine retained below for migration diagnostics */
    /* eslint-disable no-unreachable */
    if (!mobileUIActive) {
      stopAuroraWebGLLoop();
      return;
    }
    const container = document.getElementById('androidAuroraContainer');
    if (!container) return;

    const isHidden = document.hidden;
    const isReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.getElementById('androidAuroraCanvas');
    const mesh = document.getElementById('androidAuroraMesh');

    // Modo Econômico ou prefers-reduced-motion
    if (auroraState.activeEngine === 'eco' || isReducedMotion) {
      stopAuroraWebGLLoop();
      container.classList.add('android-aurora-paused');
      if (canvas) canvas.style.display = 'none';
      if (mesh) mesh.style.display = 'none';
      return;
    }

    // Se o documento estiver em segundo plano, pausa o loop gráfico
    if (isHidden) {
      stopAuroraWebGLLoop();
      container.classList.add('android-aurora-paused');
      return;
    }

    container.classList.remove('android-aurora-paused');

    // WebGL ativo sem perda nem simulação
    if (auroraState.activeEngine === 'webgl' && !auroraState.contextLost && !auroraState.isSimulatingLoss) {
      if (!auroraState.webglGl || (typeof auroraState.webglGl.isContextLost === 'function' && auroraState.webglGl.isContextLost())) {
        initAuroraWebGL();
      }
      if (auroraState.webglGl && !auroraState.contextLost && !auroraState.isSimulatingLoss) {
        if (mesh) mesh.style.display = 'none';
        if (canvas) canvas.style.display = 'block';
        startAuroraWebGLLoop();
        return;
      }
    }

    // Fallback para CSS Aurora Mesh (ou activeEngine === 'css')
    stopAuroraWebGLLoop();
    if (canvas) canvas.style.display = 'none';
    if (mesh) mesh.style.display = 'block';
    /* eslint-enable no-unreachable */
  }

  function buildAndroidAurora() {
    if (document.getElementById('androidAuroraContainer')) return;
    const app = getAppContainer() || document.body;
    if (!app) return;

    const container = document.createElement('div');
    container.id = 'androidAuroraContainer';
    container.setAttribute('aria-hidden', 'true');
    container.innerHTML = `
      <canvas id="androidAuroraCanvas"></canvas>
      <div id="androidAuroraMesh">
        <div class="android-aurora-blob blob-1"></div>
        <div class="android-aurora-blob blob-2"></div>
        <div class="android-aurora-blob blob-3"></div>
        <div class="android-aurora-blob blob-4"></div>
        <div class="android-aurora-blob blob-5"></div>
      </div>
    `;

    app.prepend(container);

    const canvas = container.querySelector('#androidAuroraCanvas');
    if (canvas) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        auroraState.contextLost = true;
        auroraState.webglActive = false;
        auroraState.runtimeStatus = auroraState.isSimulatingLoss ? 'simulated_loss' : 'context_lost';
        auroraState.activeEngine = 'css';
        auroraState.isFallback = true;
        auroraState.fallbackReason = auroraState.isSimulatingLoss ? 'simulated_loss' : 'context_lost';
        stopAuroraWebGLLoop();
        document.documentElement.dataset.visualEffect = 'css';
        updateAuroraEngine();
        syncAndroidProfile();
      }, false);

      canvas.addEventListener('webglcontextrestored', () => {
        auroraState.contextLost = false;
        auroraState.isSimulatingLoss = false;
        auroraState.recoveryAttempts = 0;
        const success = initAuroraWebGL();
        if (success && !auroraState.contextLost) {
          auroraState.runtimeStatus = 'active';
          auroraState.activeEngine = 'webgl';
          auroraState.isFallback = false;
          auroraState.fallbackReason = null;
        } else {
          auroraState.runtimeStatus = 'unavailable';
          auroraState.activeEngine = 'css';
          auroraState.isFallback = true;
          auroraState.fallbackReason = 'unsupported';
        }
        document.documentElement.dataset.visualEffect = auroraState.activeEngine;
        updateAuroraEngine();
        syncAndroidProfile();
      }, false);
    }

    document.addEventListener('visibilitychange', () => {
      updateAuroraEngine();
    });

    if (window.matchMedia) {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      mql.addEventListener?.('change', () => {
        updateAuroraEngine();
      });
    }

    let scrollPauseTimer = null;
    let isScrollPaused = false;

    function onAndroidScroll() {
      if (!mobileUIActive || currentAndroidTab !== 'android-home') return;
      if (!isScrollPaused) {
        isScrollPaused = true;
        document.documentElement.classList.add('android-is-scrolling');
      }
      if (scrollPauseTimer) clearTimeout(scrollPauseTimer);
      scrollPauseTimer = setTimeout(() => {
        isScrollPaused = false;
        document.documentElement.classList.remove('android-is-scrolling');
      }, 140);
    }

    window.addEventListener('scroll', onAndroidScroll, { passive: true });

    if ('MutationObserver' in root) {
      const themeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'data-theme' || m.attributeName === 'data-visual-effect')) {
            updateAuroraEngine();
            break;
          }
        }
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-visual-effect'] });
    }

    auroraState.initialized = true;
    updateAuroraEngine();
  }

  function buildAndroidBlurLayers() {
    if (document.getElementById('androidLiquidBlurTop')) return;
    const app = getAppContainer() || document.body;
    if (!app) return;

    const blurTop = document.createElement('div');
    blurTop.id = 'androidLiquidBlurTop';
    blurTop.setAttribute('aria-hidden', 'true');
    app.prepend(blurTop);

    if (!document.getElementById('androidLiquidBlurBottom')) {
      const blurBottom = document.createElement('div');
      blurBottom.id = 'androidLiquidBlurBottom';
      blurBottom.setAttribute('aria-hidden', 'true');
      app.appendChild(blurBottom);
    }
  }

  function applyLiquidTitaniumPrototypeMaterials() {
    const setMaterial = (selector, material) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.dataset.liquidMaterial = material;
      });
    };

    // Etapa 3: somente shell da Home e modal de detalhes.
    setMaterial('#androidHeader', 'base');
    setMaterial('#androidBottomNav', 'floating');
    setMaterial('#android-home .android-kpi-card, #android-home .android-home-card', 'card');
    setMaterial('#android-home .android-quick-actions', 'floating');
    setMaterial('.product-detail-modal', 'overlay');
    setMaterial('.product-detail-panel', 'modal');
  }

  function initAndroidUI() {
    if (isCapacitorAndroid() && root.navigator?.serviceWorker?.getRegistrations) {
      root.navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => void reg.unregister()))
        .catch(() => {});
    }

    if (root.location && root.location.hash === '#audit' && root.history?.replaceState) {
      root.history.replaceState(null, '', root.location.pathname + root.location.search);
    }

    buildAndroidBlurLayers();
    buildAndroidHeader();
    buildAndroidHomePage();
    applyLiquidTitaniumPrototypeMaterials();
    buildAndroidProductsViewToggle();
    buildAndroidProfilePage();
    buildAndroidBottomNav();
    applyVisualEffect(getStoredVisualEffect());
    buildAndroidAurora();
    installAndroidStoreAndPanelHooks();

    const hasPendingCameraTicket = Boolean(root.localStorage?.getItem('skalee.camera.pending.v1'));
    navigateAndroidTab(hasPendingCameraTicket ? 'register' : 'android-home');
    observePageIsolation();
    syncAndroidData();

    const observeTargets = [
      document.getElementById('grid'),
      document.getElementById('sProducts'),
      document.getElementById('sToday'),
      document.getElementById('s7'),
      document.getElementById('sOffer'),
      document.getElementById('notificationPendingBadge'),
      document.getElementById('draftStatus'),
      document.getElementById('draftPending')
    ].filter(Boolean);

    if ('MutationObserver' in root && observeTargets.length) {
      const observer = new MutationObserver(() => {
        syncAndroidData();
      });
      observeTargets.forEach((el) => {
        observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      });
    }

    root.addEventListener('skalee:authenticated', (event) => {
      userSelectedTabManually = false;
      currentAndroidUserId = String(event?.detail?.userId || '').trim();
      currentAndroidUserEmail = String(
        event?.detail?.email || (typeof activeUserEmail === 'string' ? activeUserEmail : '')
      )
        .trim()
        .toLowerCase();
      storeValidatedForCurrentUser = false;
      lastValidatedLocationsKey = '';

      if (!mobileUIActive) return;

      applyAndroidActiveStore(undefined, {
        useSavedPreference: true,
        persist: false,
        reloadProducts: false,
        reloadNotifications: true
      });

      const pendingCamera = Boolean(root.localStorage?.getItem('skalee.camera.pending.v1'));
      navigateAndroidTab(pendingCamera ? 'register' : 'android-home');
      syncAndroidData();
      setTimeout(() => {
        applyAndroidActiveStore(undefined, {
          useSavedPreference: true,
          persist: true,
          reloadProducts: false,
          reloadNotifications: true
        });
        const stillPendingCamera = Boolean(root.localStorage?.getItem('skalee.camera.pending.v1'));
        if (!userSelectedTabManually && !stillPendingCamera) {
          navigateAndroidTab('android-home');
        }
        syncAndroidData();
      }, 180);
    });

    root.addEventListener('skalee:permissions-updated', () => {
      syncAndroidData();
    });
    root.addEventListener('skalee:audit-access-updated', syncAndroidData);

    root.addEventListener('skalee:signed-out', () => {
      userSelectedTabManually = false;
      currentAndroidUserId = '';
      currentAndroidUserEmail = '';
      storeValidatedForCurrentUser = false;
      lastValidatedLocationsKey = '';
      setDraftBannerVisibility(false);
      navigateAndroidTab('android-home');
      syncAndroidData();
    });
  }

  mobileViewport.addEventListener('change', updateMobileMode);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateMobileMode);
  else updateMobileMode();

  root.SkaleeAndroidUI = {
    get active() { return mobileUIActive; },
    isCapacitorAndroid,
    navigateAndroidTab,
    syncAndroidData,
    evaluateAndroidHomeDraftBanner,
    getActiveStore: getAndroidActiveStoreName,
    setActiveStore: (storeName, persist = true) =>
      applyAndroidActiveStore(storeName, {
        persist,
        reloadProducts: true,
        reloadNotifications: true
      }),
    getCurrentTab: () => currentAndroidTab,
    getProductsView: readAndroidProductsViewPreference,
    setProductsView: (mode) => applyAndroidProductsView(mode, true),
    simulateWebGLLoss,
    restoreWebGL,
    disableWebGLSimulation,
    useModoEconomicoFromDiag,
    getVisualEffect: getStoredVisualEffect,
    setVisualEffect: setStoredVisualEffect,
    getWebGLStatus: () => auroraState.runtimeStatus
  };

  root.simulateWebGLLoss = simulateWebGLLoss;
  root.restoreWebGL = restoreWebGL;
  root.simulateContextLoss = simulateWebGLLoss;
  root.simulateContextRestore = restoreWebGL;
})(typeof window === 'undefined' ? globalThis : window);


