/* ==========================================================================
   SKALEE VALIDADES ANDROID 1.0 — Navegação e Experiência Exclusiva Android
   Ativado SOMENTE no ambiente Capacitor Android. Nunca altera o PWA web.
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

  if (!isCapacitorAndroid()) {
    root.SkaleeAndroidUI = { active: false, isCapacitorAndroid };
    return;
  }

  document.documentElement.classList.add('android-app');
  if (document.body) {
    document.body.classList.add('android-app');
  }

  // Garante viewport-fit=cover para respeitar safe areas do Android sem zoom indevido
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover'
    );
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
          <button type="button" id="androidKpiExpired" class="android-kpi-card kpi-expired" aria-label="Filtrar produtos críticos ou vencidos">
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

          <button type="button" id="androidKpiExpiring" class="android-kpi-card kpi-expiring" aria-label="Filtrar produtos próximos do vencimento">
            <div class="android-kpi-top">
              <span class="android-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </span>
            </div>
            <strong id="androidKpiExpiringValue" class="android-kpi-value">0</strong>
            <span class="android-kpi-label">Próx. vencimento</span>
            <span class="android-kpi-sub">Até 7 dias</span>
          </button>

          <button type="button" id="androidKpiOffer" class="android-kpi-card kpi-offer" aria-label="Filtrar produtos em oferta">
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
            <span class="android-kpi-sub">Marcados em oferta</span>
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
      applyQuickFilterAndOpenProducts({ expiryRange: 'today', offerStatus: null, highQuantity: false });
    });

    homeSection.querySelector('#androidKpiExpiring').addEventListener('click', () => {
      applyQuickFilterAndOpenProducts({ expiryRange: '7', offerStatus: null, highQuantity: false });
    });

    homeSection.querySelector('#androidKpiOffer').addEventListener('click', () => {
      applyQuickFilterAndOpenProducts({ expiryRange: null, offerStatus: 'offer', highQuantity: false });
    });
  }

  function applyQuickFilterAndOpenProducts(nextFilters) {
    if (typeof activeFilters !== 'undefined') {
      activeFilters.expiryRange = nextFilters.expiryRange;
      activeFilters.offerStatus = nextFilters.offerStatus;
      activeFilters.highQuantity = Boolean(nextFilters.highQuantity);
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

        <div class="android-profile-card">
          <h3 class="android-profile-card-title">Tema do aplicativo</h3>
          <div class="android-theme-Segment" role="group" aria-label="Tema do aplicativo">
            <button type="button" class="android-theme-btn" data-android-theme="light">Claro</button>
            <button type="button" class="android-theme-btn" data-android-theme="dark">Escuro</button>
            <button type="button" class="android-theme-btn" data-android-theme="auto">Auto</button>
          </div>
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

    profileSection.querySelector('#androidProfileNotifCenterBtn').addEventListener('click', openNotificationsCenter);

    profileSection.querySelector('#androidProfileNotifSettingsBtn').addEventListener('click', () => {
      if (typeof setNotificationsModalOpen === 'function') {
        setNotificationsModalOpen(true);
      }
    });

    profileSection.querySelector('#androidProfileReportBtn').addEventListener('click', () => {
      userSelectedTabManually = true;
      navigateAndroidTab('report');
      if (typeof carregarProdutosRelatorio === 'function') {
        void carregarProdutosRelatorio();
      }
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

      <button type="button" class="android-nav-item" data-android-page="audit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        <span>Auditoria</span>
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

    const canAccessAudit = Boolean(
      (typeof els !== 'undefined' && els.auditTab && !els.auditTab.hidden) ||
      root.skaleeAuditAccess?.getContext?.()?.can_access_audit
    );
    const shell = auditSection.querySelector('.audit-wrap, .audit-shell');
    banner.hidden = canAccessAudit;
    if (shell) {
      shell.style.display = canAccessAudit ? '' : 'none';
    }
  }

  let enforcingPageState = false;

  function enforceActiveAndroidPage(pageId) {
    const requestedId = pageId || currentAndroidTab || 'android-home';
    const targetSection = document.getElementById(requestedId) || document.getElementById('android-home');
    if (!targetSection) return;

    const resolvedId = targetSection.id;
    currentAndroidTab = resolvedId;

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
        const highlightedTab = ['report', 'local-query'].includes(resolvedId) ? 'android-profile' : resolvedId;
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

    const adminBtn = document.getElementById('androidProfileAdminBtn');
    const posterBtn = document.getElementById('androidProfilePosterBtn');
    if (adminBtn && typeof els !== 'undefined' && els.adminCentralButton) {
      adminBtn.hidden = Boolean(els.adminCentralButton.hidden);
    }
    if (posterBtn && typeof els !== 'undefined' && els.posterTab) {
      posterBtn.hidden = Boolean(els.posterTab.hidden);
    }
  }

  function syncAndroidData() {
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
        if (!userSelectedTabManually) {
          const pendingCamera = Boolean(root.localStorage?.getItem('skalee.camera.pending.v1'));
          currentAndroidTab = pendingCamera ? 'register' : 'android-home';
        }
        enforceActiveAndroidPage(currentAndroidTab);
      });
    });

    if (!('MutationObserver' in root)) return;

    const pageObserver = new MutationObserver(() => {
      if (enforcingPageState) return;
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

  function initAndroidUI() {
    if (root.navigator?.serviceWorker?.getRegistrations) {
      root.navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => void reg.unregister()))
        .catch(() => {});
    }

    if (root.location && root.location.hash === '#audit' && root.history?.replaceState) {
      root.history.replaceState(null, '', root.location.pathname + root.location.search);
    }

    buildAndroidHeader();
    buildAndroidHomePage();
    buildAndroidProductsViewToggle();
    buildAndroidProfilePage();
    buildAndroidBottomNav();
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAndroidUI);
  } else {
    initAndroidUI();
  }

  root.SkaleeAndroidUI = {
    active: true,
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
    setProductsView: (mode) => applyAndroidProductsView(mode, true)
  };
})(typeof window === 'undefined' ? globalThis : window);


