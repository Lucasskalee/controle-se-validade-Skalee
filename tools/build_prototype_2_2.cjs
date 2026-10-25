/**
 * tools/build_prototype_2_2.cjs
 *
 * Gera o protótipo dev/prototype-titanium-glass-2-2.html com o refinamento estético:
 * 1. Cabeçalho 100% translúcido (sem barra sólida, Aurora contínua e sem borrão ao rolar).
 * 2. Cards de produtos e indicadores (KPIs) mais translúcidos (Liquid Glass de alta transparência).
 * 3. Navegação inferior (cápsula) mais translúcida revelando os produtos passando por trás.
 * 4. Desfoque contextual progressivo (Focus) superior e inferior.
 * 5. Aurora mais dinâmica e vibrante (CSS Mesh aprimorado com 5 blobs e luminosidade alta).
 */

const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'dev', 'prototype-soft-aurora.html');
const destPath = path.join(__dirname, '..', 'dev', 'prototype-titanium-glass-2-2.html');

let html = fs.readFileSync(srcPath, 'utf8');

// 1. Atualizar o Título da Página
html = html.replace(
  '<title>Skalee Validades — Protótipo Soft Aurora A/B</title>',
  '<title>Skalee Titanium Glass 2.2 — Refinamento de Transparência & Desfoque Contextual</title>'
);

// 2. Inserir estilos do Titanium Glass 2.2 antes de </style>
const glass22Styles = `
/* ==========================================================================
   SKALEE TITANIUM GLASS 2.2 — REFINAMENTO DE TRANSPARÊNCIA & DESFOQUE CONTEXTUAL
   ========================================================================== */

/* 1. AURORA MAIS DINÂMICA E VIBRANTE (CSS MESH 5 BLOBS & LUMINOSIDADE) */
.css-aurora-mesh {
  background: #030712 !important;
}

.blob-1 {
  top: -15% !important;
  left: -20% !important;
  width: 480px !important;
  height: 480px !important;
  background: radial-gradient(circle, rgba(0, 102, 255, 0.85) 0%, rgba(0, 102, 255, 0.38) 45%, rgba(0, 102, 255, 0) 75%) !important;
  filter: blur(65px) !important;
  -webkit-filter: blur(65px) !important;
  animation: auroraFloat1 18s ease-in-out infinite alternate !important;
}

.blob-2 {
  top: 10% !important;
  right: -25% !important;
  width: 440px !important;
  height: 440px !important;
  background: radial-gradient(circle, rgba(0, 229, 255, 0.82) 0%, rgba(0, 210, 255, 0.35) 45%, rgba(0, 210, 255, 0) 75%) !important;
  filter: blur(60px) !important;
  -webkit-filter: blur(60px) !important;
  animation: auroraFloat2 22s ease-in-out infinite alternate !important;
}

.blob-3 {
  bottom: 8% !important;
  left: -20% !important;
  width: 460px !important;
  height: 460px !important;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.75) 0%, rgba(124, 58, 237, 0.30) 45%, rgba(124, 58, 237, 0) 75%) !important;
  filter: blur(65px) !important;
  -webkit-filter: blur(65px) !important;
  animation: auroraFloat3 24s ease-in-out infinite alternate !important;
}

.blob-4 {
  bottom: -15% !important;
  right: -15% !important;
  width: 420px !important;
  height: 420px !important;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.80) 0%, rgba(14, 165, 233, 0.32) 45%, rgba(14, 165, 233, 0) 75%) !important;
  filter: blur(60px) !important;
  -webkit-filter: blur(60px) !important;
  animation: auroraFloat1 20s ease-in-out infinite alternate-reverse !important;
}

.blob-5 {
  position: absolute;
  top: 22% !important;
  left: -10% !important;
  width: 520px !important;
  height: 380px !important;
  border-radius: 50% !important;
  background: radial-gradient(ellipse, rgba(0, 180, 255, 0.65) 0%, rgba(0, 102, 255, 0.25) 48%, rgba(0, 102, 255, 0) 75%) !important;
  filter: blur(60px) !important;
  -webkit-filter: blur(60px) !important;
  animation: auroraFloat2 26s ease-in-out infinite alternate-reverse !important;
  will-change: transform;
  transform: translateZ(0);
}

html[data-theme="light"] .css-aurora-mesh {
  background: #f8fafc !important;
}
html[data-theme="light"] .blob-1 {
  background: radial-gradient(circle, rgba(56, 189, 248, 0.55) 0%, rgba(56, 189, 248, 0) 70%) !important;
}
html[data-theme="light"] .blob-2 {
  background: radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(14, 165, 233, 0) 70%) !important;
}
html[data-theme="light"] .blob-3 {
  background: radial-gradient(circle, rgba(167, 139, 250, 0.40) 0%, rgba(167, 139, 250, 0) 70%) !important;
}
html[data-theme="light"] .blob-4 {
  background: radial-gradient(circle, rgba(96, 165, 250, 0.48) 0%, rgba(96, 165, 250, 0) 70%) !important;
}
html[data-theme="light"] .blob-5 {
  background: radial-gradient(ellipse, rgba(56, 189, 248, 0.48) 0%, rgba(56, 189, 248, 0) 70%) !important;
}

/* 2. REFINAMENTO DE TRANSPARÊNCIA DOS MATERIAIS LIQUID GLASS (DARK MODE) */
:root {
  --kpi-glass-bg: linear-gradient(135deg, rgba(18, 28, 48, 0.20) 0%, rgba(10, 16, 28, 0.28) 100%) !important;
  --kpi-glass-border: 1px solid rgba(255, 255, 255, 0.10) !important;
  --kpi-glass-border-top: 1px solid rgba(255, 255, 255, 0.22) !important;
  --kpi-glass-shadow: 0 8px 32px -4px rgba(0, 0, 0, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.14) !important;

  --qa-glass-bg: linear-gradient(135deg, rgba(18, 28, 48, 0.22) 0%, rgba(11, 18, 32, 0.28) 100%) !important;
  --qa-glass-border: 1px solid rgba(255, 255, 255, 0.10) !important;
  --qa-glass-border-top: 1px solid rgba(255, 255, 255, 0.20) !important;
  --qa-glass-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.12) !important;

  --product-glass-bg: linear-gradient(135deg, rgba(16, 26, 44, 0.22) 0%, rgba(10, 16, 28, 0.30) 100%) !important;
  --product-glass-border: 1px solid rgba(255, 255, 255, 0.10) !important;
  --product-glass-border-top: 1px solid rgba(255, 255, 255, 0.22) !important;
  --product-glass-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.12) !important;

  --nav-glass-bg: linear-gradient(135deg, rgba(16, 25, 42, 0.24) 0%, rgba(10, 16, 30, 0.34) 100%) !important;
}

/* REFINAMENTO DE TRANSPARÊNCIA DOS MATERIAIS LIQUID GLASS (LIGHT MODE) */
html[data-theme="light"] {
  --kpi-glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.36) 0%, rgba(240, 248, 255, 0.22) 100%) !important;
  --kpi-glass-border: 1px solid rgba(255, 255, 255, 0.60) !important;
  --kpi-glass-border-top: 1px solid rgba(255, 255, 255, 0.95) !important;
  --kpi-glass-shadow: 0 6px 24px -2px rgba(15, 23, 42, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.90) !important;

  --qa-glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.38) 0%, rgba(240, 248, 255, 0.24) 100%) !important;
  --qa-glass-border: 1px solid rgba(255, 255, 255, 0.60) !important;
  --qa-glass-border-top: 1px solid rgba(255, 255, 255, 0.95) !important;
  --qa-glass-shadow: 0 4px 16px -2px rgba(15, 23, 42, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.90) !important;

  --product-glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.38) 0%, rgba(240, 248, 255, 0.24) 100%) !important;
  --product-glass-border: 1px solid rgba(255, 255, 255, 0.60) !important;
  --product-glass-border-top: 1px solid rgba(255, 255, 255, 0.95) !important;
  --product-glass-shadow: 0 8px 24px -2px rgba(15, 23, 42, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.85) !important;

  --nav-glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.40) 0%, rgba(240, 248, 255, 0.26) 100%) !important;
}

/* 3. CABEÇALHO 100% TRANSLÚCIDO E SEMPRE NÍTIDO (SEM BARRA SÓLIDA, SEM BORRÃO) */
.sim-header-wrap {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000 !important; /* Sempre no topo de todas as camadas */
  pointer-events: none;
}

.sim-status-bar {
  pointer-events: auto;
  background: transparent !important;
  color: #ffffff !important;
  font-weight: 600;
  padding: 8px 18px 2px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
html[data-theme="light"] .sim-status-bar {
  color: #0f172a !important;
  text-shadow: none;
}

.sim-header {
  pointer-events: auto;
  padding: 4px 18px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: none !important;
  border-bottom: none !important;
  box-shadow: none !important;
}

.brand-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: linear-gradient(135deg, #0066ff, #00d4ff);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 102, 255, 0.45);
  flex-shrink: 0;
}
.brand-mark svg {
  width: 20px;
  height: 20px;
  stroke: #ffffff;
  stroke-width: 2.3;
  fill: none;
}
.brand-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.brand-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #ffffff !important;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  line-height: 1.15;
}
html[data-theme="light"] .brand-title {
  color: #0f172a !important;
  text-shadow: none;
}
.brand-subtitle {
  font-size: 11px;
  font-weight: 600;
  color: #38bdf8;
  display: flex;
  align-items: center;
  gap: 5px;
}
html[data-theme="light"] .brand-subtitle {
  color: #0284c7;
}
.brand-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.10) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff !important;
  cursor: pointer;
  position: relative;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s ease, background 0.15s ease;
}
.header-icon-btn:active {
  transform: scale(0.94);
}
html[data-theme="light"] .header-icon-btn {
  background: rgba(255, 255, 255, 0.60) !important;
  border: 1px solid rgba(148, 163, 184, 0.28) !important;
  color: #0f172a !important;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.header-notif-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #ef4444;
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #030712;
}

/* 4. CAMADA DE DESFOQUE CONTEXTUAL SUPERIOR (DESFOCA SOMENTE O CONTEÚDO QUE ROLA) */
.liquid-blur-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 125px;
  pointer-events: none;
  z-index: 500; /* Fica acima de .scroll-area (10), mas abaixo do header (1000) */
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  -webkit-mask-image: linear-gradient(to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 42px,
    rgba(0, 0, 0, 0.40) 80px,
    rgba(0, 0, 0, 0) 125px
  );
  mask-image: linear-gradient(to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 42px,
    rgba(0, 0, 0, 0.40) 80px,
    rgba(0, 0, 0, 0) 125px
  );
  transition: opacity 0.25s ease;
}

/* 5. CAMADA DE DESFOQUE CONTEXTUAL INFERIOR (FOCUS GRADUAL ANTES DO MENU) */
.liquid-blur-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 155px;
  pointer-events: none;
  z-index: 940; /* Fica acima do scroll (10), mas abaixo da bottom nav (950) */
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  -webkit-mask-image: linear-gradient(to top,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 55px,
    rgba(0, 0, 0, 0.50) 100px,
    rgba(0, 0, 0, 0.15) 130px,
    rgba(0, 0, 0, 0) 155px
  );
  mask-image: linear-gradient(to top,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 55px,
    rgba(0, 0, 0, 0.50) 100px,
    rgba(0, 0, 0, 0.15) 130px,
    rgba(0, 0, 0, 0) 155px
  );
  transition: opacity 0.25s ease;
}

/* Quando desativado via controle de teste A/B */
.blur-disabled .liquid-blur-top,
.blur-disabled .liquid-blur-bottom {
  display: none !important;
}

/* 6. ÁREA DE ROLAGEM */
.scroll-area {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: calc(38px + 52px + 12px) 16px calc(72px + 24px + 12px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: none;
  z-index: 10;
}
.scroll-area::-webkit-scrollbar { display: none; }

/* 7. NAVEGAÇÃO INFERIOR MAIS TRANSPARENTE */
.floating-bottom-nav {
  background: var(--nav-glass-bg) !important;
  backdrop-filter: blur(20px) saturate(140%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(140%) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.26) !important;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.40), inset 0 1px 0 0 rgba(255, 255, 255, 0.16) !important;
  z-index: 950 !important;
}
html[data-theme="light"] .floating-bottom-nav {
  border: 1px solid rgba(255, 255, 255, 0.70) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.98) !important;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.95) !important;
}

/* 8. CARDS DE PRODUTOS & ELEMENTOS COM LIQUID GLASS REFRACTION */
.product-card {
  backdrop-filter: blur(18px) saturate(140%) !important;
  -webkit-backdrop-filter: blur(18px) saturate(140%) !important;
}
.product-card .photo {
  background: rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
html[data-theme="light"] .product-card .photo {
  background: rgba(241, 245, 249, 0.45) !important;
  border: 1px solid rgba(148, 163, 184, 0.18) !important;
}

.kpi-card {
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
}
.action-btn {
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
}

.store-pill {
  background: rgba(37, 99, 235, 0.16) !important;
  border: 1px solid rgba(37, 99, 235, 0.35) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  color: #38bdf8 !important;
}
html[data-theme="light"] .store-pill {
  background: rgba(219, 234, 254, 0.60) !important;
  border: 1px solid rgba(37, 99, 235, 0.25) !important;
  color: #1d4ed8 !important;
}

/* Toolbar Controls para Rolagem e Desfoque */
.tool-group-scroll {
  display: inline-flex;
  align-items: center;
  background: #1e293b;
  border-radius: 10px;
  padding: 3px;
  border: 1px solid rgba(255,255,255,0.06);
}
`;

html = html.replace('</style>', glass22Styles + '\n</style>');

// 3. Adicionar o 5º Blob na camada css-aurora-mesh
const oldMeshBlobs = `<div class="aurora-blob blob-4"></div>
      </div>`;
const newMeshBlobs = `<div class="aurora-blob blob-4"></div>
        <div class="aurora-blob blob-5"></div>
      </div>`;
html = html.replace(oldMeshBlobs, newMeshBlobs);

// 4. Atualizar o Header da Toolbar Desktop
const oldToolbarBadge = `<span class="toolbar-badge" id="activeModeLabel">WebGL (30 FPS)</span>`;
const newToolbarBadge = `<span class="toolbar-badge" id="activeModeLabel">Titanium Glass 2.2</span>`;
html = html.replace(oldToolbarBadge, newToolbarBadge);

// 5. Adicionar controles de Rolagem e Desfoque na Toolbar Desktop
const oldToolbarControls = `<div class="toolbar-controls">`;
const newToolbarControls = `<div class="toolbar-controls">
    <!-- Grupo Desfoque Contextual -->
    <div class="tool-group">
      <button class="tool-btn active" id="btnToggleBlur" onclick="toggleContextualBlur()">
        <span>🌫️</span>
        <span id="btnToggleBlurText">Desfoque: Ativo</span>
      </button>
    </div>

    <!-- Grupo Posição de Rolagem -->
    <div class="tool-group-scroll">
      <span style="font-size:11px; font-weight:700; color:#94a3b8; padding:0 8px;">Rolagem:</span>
      <button class="tool-btn active" id="btnScrollStart" onclick="setScrollPosition(0)">Início</button>
      <button class="tool-btn" id="btnScrollMid" onclick="setScrollPosition(340)">Meio</button>
      <button class="tool-btn" id="btnScrollEnd" onclick="setScrollPosition(780)">Final</button>
    </div>`;

html = html.replace(oldToolbarControls, newToolbarControls);

// 6. Atualizar a estrutura interna de viewport-content para conter os layers de blur e o wrap do header
const oldViewportContentTop = `<div class="viewport-content">

      <!-- Status Bar (Desktop mock apenas) -->
      <div class="sim-status-bar">
        <span>09:41</span>
        <div class="status-right">
          <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L12 22l7.03-4.39C20.26 16.07 21 14.12 21 12c0-4.97-4.03-9-9-9z"/></svg>
          <svg viewBox="0 0 24 24"><path d="M2 17h20v4H2v-4zm0-6h20v4H2v-4zm0-6h20v4H2V5z"/></svg>
          <svg viewBox="0 0 24 24"><path d="M17 4h-3V2h-4v2H7v18h10V4z"/></svg>
        </div>
      </div>

      <!-- Header Compacto -->
      <header class="sim-header">
        <div class="brand-group">
          <div class="brand-mark">
            <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <span class="brand-title">Skalee Validades</span>
        </div>
        <div class="header-actions">
          <div class="header-icon-btn" onclick="openBottomSheet()">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </div>
          <div class="header-icon-btn">
            <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </div>
        </div>
      </header>`;

const newViewportContentTop = `<div class="viewport-content" id="viewportContent">

      <!-- CAMADA DE DESFOQUE CONTEXTUAL SUPERIOR (LIQUID GLASS 2.2) -->
      <div class="liquid-blur-top" id="liquidBlurTop"></div>

      <!-- HEADER COMPACTO + STATUS BAR (100% TRANSLÚCIDO E NÍTIDO SOBRE A AURORA) -->
      <div class="sim-header-wrap">
        <div class="sim-status-bar">
          <span>10:52</span>
          <div class="status-right">
            <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L12 22l7.03-4.39C20.26 16.07 21 14.12 21 12c0-4.97-4.03-9-9-9z"/></svg>
            <svg viewBox="0 0 24 24"><path d="M2 17h20v4H2v-4zm0-6h20v4H2v-4zm0-6h20v4H2V5z"/></svg>
            <svg viewBox="0 0 24 24"><path d="M17 4h-3V2h-4v2H7v18h10V4z"/></svg>
          </div>
        </div>

        <header class="sim-header">
          <div class="brand-group">
            <div class="brand-mark">
              <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div class="brand-meta">
              <span class="brand-title">Skalee Validades</span>
              <div class="brand-subtitle"><span class="brand-live-dot"></span> Supermercado sol 3</div>
            </div>
          </div>
          <div class="header-actions">
            <button class="header-icon-btn" onclick="openBottomSheet()" title="Configurações e Demonstração" aria-label="Configurações">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button class="header-icon-btn" title="Notificações" aria-label="Notificações">
              <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <span class="header-notif-badge">1</span>
            </button>
          </div>
        </header>
      </div>`;

html = html.replace(oldViewportContentTop, newViewportContentTop);

// 7. Adicionar camada de desfoque inferior antes da floating-bottom-nav
const oldBottomNav = `<!-- Floating Navigation Bar -->
      <nav class="floating-bottom-nav">`;

const newBottomNav = `<!-- CAMADA DE DESFOQUE CONTEXTUAL INFERIOR (LIQUID GLASS 2.2) -->
      <div class="liquid-blur-bottom" id="liquidBlurBottom"></div>

      <!-- Floating Navigation Bar -->
      <nav class="floating-bottom-nav">`;

html = html.replace(oldBottomNav, newBottomNav);

// 8. Adicionar controles de rolagem e desfoque no Bottom Sheet para teste móvel
const oldSheetContent = `<div class="sheet-section">
      <span class="sheet-section-label">Motor Aurora</span>`;

const newSheetContent = `<div class="sheet-section">
      <span class="sheet-section-label">Desfoque Contextual (Titanium Glass 2.2)</span>
      <div class="sheet-btn-row">
        <button class="sheet-btn active" id="sheetBtnBlurOn" onclick="setContextualBlur(true)">Ativo</button>
        <button class="sheet-btn" id="sheetBtnBlurOff" onclick="setContextualBlur(false)">Desativado</button>
      </div>
    </div>

    <div class="sheet-section">
      <span class="sheet-section-label">Posição da Rolagem</span>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px;">
        <button class="sheet-btn active" id="sheetScrollStart" onclick="setScrollPosition(0)">Início</button>
        <button class="sheet-btn" id="sheetScrollMid" onclick="setScrollPosition(340)">Meio</button>
        <button class="sheet-btn" id="sheetScrollEnd" onclick="setScrollPosition(780)">Final</button>
      </div>
    </div>

    <div class="sheet-section">
      <span class="sheet-section-label">Motor Aurora</span>`;

html = html.replace(oldSheetContent, newSheetContent);

// 9. Inserir funções JavaScript de controle de rolagem e desfoque contextual
const jsControls = `
/* --------------------------------------------------------------------------
   CONTROLES DO TITANIUM GLASS 2.2: DESFOQUE CONTEXTUAL & ROLAGEM
   -------------------------------------------------------------------------- */
let blurEnabled = true;

window.toggleContextualBlur = function() {
  setContextualBlur(!blurEnabled);
};

window.setContextualBlur = function(enable) {
  blurEnabled = enable;
  const vp = document.getElementById('viewportContent');
  const btn = document.getElementById('btnToggleBlur');
  const btnText = document.getElementById('btnToggleBlurText');
  const sheetOn = document.getElementById('sheetBtnBlurOn');
  const sheetOff = document.getElementById('sheetBtnBlurOff');

  if (enable) {
    if (vp) vp.classList.remove('blur-disabled');
    if (btn) btn.classList.add('active');
    if (btnText) btnText.textContent = 'Desfoque: Ativo';
    if (sheetOn) sheetOn.classList.add('active');
    if (sheetOff) sheetOff.classList.remove('active');
  } else {
    if (vp) vp.classList.add('blur-disabled');
    if (btn) btn.classList.remove('active');
    if (btnText) btnText.textContent = 'Desfoque: Desativado';
    if (sheetOn) sheetOn.classList.remove('active');
    if (sheetOff) sheetOff.classList.add('active');
  }
};

window.setScrollPosition = function(top) {
  const scroller = document.getElementById('scrollContent');
  if (!scroller) return;
  scroller.scrollTo({ top, behavior: 'smooth' });

  // Atualizar botões de feedback
  const btnStart = document.getElementById('btnScrollStart');
  const btnMid = document.getElementById('btnScrollMid');
  const btnEnd = document.getElementById('btnScrollEnd');
  const sheetStart = document.getElementById('sheetScrollStart');
  const sheetMid = document.getElementById('sheetScrollMid');
  const sheetEnd = document.getElementById('sheetScrollEnd');

  [btnStart, btnMid, btnEnd, sheetStart, sheetMid, sheetEnd].forEach(b => b?.classList.remove('active'));

  if (top <= 50) {
    btnStart?.classList.add('active');
    sheetStart?.classList.add('active');
  } else if (top <= 500) {
    btnMid?.classList.add('active');
    sheetMid?.classList.add('active');
  } else {
    btnEnd?.classList.add('active');
    sheetEnd?.classList.add('active');
  }
};

// Listener para sincronizar os botões conforme a rolagem manual
const scrollElem = document.getElementById('scrollContent');
if (scrollElem) {
  scrollElem.addEventListener('scroll', () => {
    const top = scrollElem.scrollTop;
    const btnStart = document.getElementById('btnScrollStart');
    const btnMid = document.getElementById('btnScrollMid');
    const btnEnd = document.getElementById('btnScrollEnd');
    const sheetStart = document.getElementById('sheetScrollStart');
    const sheetMid = document.getElementById('sheetScrollMid');
    const sheetEnd = document.getElementById('sheetScrollEnd');

    [btnStart, btnMid, btnEnd, sheetStart, sheetMid, sheetEnd].forEach(b => b?.classList.remove('active'));

    if (top <= 100) {
      btnStart?.classList.add('active');
      sheetStart?.classList.add('active');
    } else if (top < 600) {
      btnMid?.classList.add('active');
      sheetMid?.classList.add('active');
    } else {
      btnEnd?.classList.add('active');
      sheetEnd?.classList.add('active');
    }
  }, { passive: true });
}
`;

html = html.replace('</script>', jsControls + '\n</script>');

fs.writeFileSync(destPath, html, 'utf8');
console.log('Protótipo Titanium Glass 2.2 gerado com sucesso em: ' + destPath);
