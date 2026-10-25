const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'android-ui.css');
let css = fs.readFileSync(cssPath, 'utf8');

// =========================================================================
// 1. Atualizar Navegação Inferior (#androidBottomNav) para Cápsula Flutuante
// =========================================================================
const oldNavSectionRegex = /\/\* ==========================================================================\s+2\. NAVEGAÇÃO INFERIOR FIXA \(#androidBottomNav\)[\s\S]*?(?=\/\* ==========================================================================\s+3\. TELA INICIAL ANDROID)/;

const newNavSection = `/* ==========================================================================
   2. NAVEGAÇÃO INFERIOR FLUTUANTE TITANIUM GLASS (#androidBottomNav)
   - Cápsula única flutuante contínua com cantos externos arredondados
   - Margens laterais ergonômicas
   - Vidro translúcido com desfoque calibrado (Dark & Light)
   - Hairline especular zenital de 1 px e profundidade suave
   ========================================================================== */
html.android-app #androidBottomNav,
html.android-app .android-bottom-nav {
  position: fixed !important;
  top: auto !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: none !important;
  height: auto !important;
  min-height: 64px !important;
  margin: 0 !important;
  border-radius: 0 !important;
  transform: none !important;
  overflow: visible !important;
  z-index: 950 !important;
  display: grid !important;
  grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
  align-items: end !important;
  gap: 0 !important;
  padding: 6px max(14px, calc((100% - 600px) / 2)) calc(8px + env(safe-area-inset-bottom, 0px)) max(14px, calc((100% - 600px) / 2)) !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  box-sizing: border-box !important;
  pointer-events: none !important;
}

/* Cápsula de Vidro Flutuante */
html.android-app #androidBottomNav::before {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  top: 0;
  bottom: calc(6px + env(safe-area-inset-bottom, 0px));
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.78) 0%, rgba(15, 23, 42, 0.88) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 10px 32px -4px rgba(2, 6, 23, 0.50), inset 0 1px 0 0 rgba(255, 255, 255, 0.12);
  pointer-events: auto;
  z-index: 0;
}

html.android-app[data-theme="light"] #androidBottomNav::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(248, 250, 252, 0.82) 100%);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 8px 24px -2px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
}

html.android-app .android-nav-item {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 50px;
  padding: 4px 2px;
  border-radius: 16px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.1;
  transition: color 0.18s ease, transform 0.15s ease;
  position: relative;
  z-index: 1;
  pointer-events: auto;
}

html.android-app[data-theme="light"] .android-nav-item {
  color: #64748b;
}

html.android-app .android-nav-item svg {
  width: 22px;
  height: 22px;
  stroke-width: 2;
  transition: transform 0.18s ease;
}

html.android-app .android-nav-item.active {
  color: #38bdf8;
  font-weight: 800;
}

html.android-app[data-theme="light"] .android-nav-item.active {
  color: #1d4ed8;
}

/* Indicador Minimalista da Aba Ativa (pílula zenital suave) */
html.android-app .android-nav-item.active:not(.android-nav-item-center)::before {
  content: "";
  position: absolute;
  top: 2px;
  width: 16px;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

html.android-app .android-nav-item:active {
  transform: scale(0.95);
}

html.android-app .android-nav-item:disabled {
  opacity: .45;
  cursor: not-allowed;
}

html.android-app :is(.android-nav-item, .android-profile-action-btn, .android-kpi-card):focus-visible {
  outline: 3px solid var(--primary, #38bdf8);
  outline-offset: 3px;
}

/* Botão central Cadastrar destacado em formato circular azul elétrico */
html.android-app .android-nav-item-center {
  position: relative;
  padding-top: 0;
  color: #e2e8f0;
  font-weight: 700;
  z-index: 2;
  pointer-events: auto;
}

html.android-app[data-theme="light"] .android-nav-item-center {
  color: #1e293b;
}

html.android-app .android-nav-fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0077ff 0%, #00d9ff 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: -20px;
  box-shadow: 0 6px 18px rgba(0, 119, 255, 0.40), 0 0 0 3.5px rgba(15, 23, 42, 0.90);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

html.android-app[data-theme="light"] .android-nav-fab {
  background: linear-gradient(135deg, #1d4ed8 0%, #0284c7 100%);
  box-shadow: 0 6px 16px rgba(29, 78, 216, 0.35), 0 0 0 3.5px #ffffff;
}

html.android-app .android-nav-item-center.active .android-nav-fab {
  background: linear-gradient(135deg, #0066dc 0%, #00c4e8 100%);
  transform: translateY(-2px) scale(1.04);
}

html.android-app .android-nav-fab svg {
  width: 26px;
  height: 26px;
  stroke-width: 2.6;
}

/* Transição suave entre abas acelerada por GPU (~200ms) */
@keyframes androidPageEnter {
  from {
    opacity: 0.70;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

html.android-app .page.active {
  animation: androidPageEnter 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: opacity, transform;
}

@media (prefers-reduced-motion: reduce) {
  html.android-app .page.active {
    animation: none !important;
  }
}
`;

if (oldNavSectionRegex.test(css)) {
  css = css.replace(oldNavSectionRegex, newNavSection + '\n\n');
  console.log('Seção de Navegação Inferior atualizada para Cápsula Flutuante!');
} else {
  console.error('Seção de Navegação Inferior não encontrada.');
  process.exit(1);
}

// =========================================================================
// 2. Atualizar Cards de Produtos e Ações Rápidas para Titanium Glass
// =========================================================================
const oldCardsRegex = /\/\* ==========================================================================\s+AÇÕES RÁPIDAS OPERACIONAIS[\s\S]*?(?=\/\* ==========================================================================\s+4\. PRODUTOS \(#products\))/;

const newCardsSection = `/* ==========================================================================
   AÇÕES RÁPIDAS OPERACIONAIS (Placas Titanium Glass)
   ========================================================================== */
html.android-app .android-quick-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 6px 0 10px;
}

html.android-app .android-qa-btn {
  appearance: none;
  -webkit-appearance: none;
  min-height: 58px;
  min-width: 44px;
  padding: 8px 4px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.70) 0%, rgba(15, 23, 42, 0.80) 100%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
  box-shadow: 0 4px 16px rgba(2, 6, 23, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  transition: transform 0.15s ease, background 0.15s ease;
  box-sizing: border-box;
}

html.android-app .android-qa-btn:active {
  transform: scale(0.96);
  background: rgba(30, 41, 59, 0.9);
}

html.android-app .android-qa-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
  flex-shrink: 0;
}

html.android-app .android-qa-icon svg {
  width: 18px;
  height: 18px;
}

html.android-app[data-theme="light"] .android-quick-actions .android-qa-btn {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(248, 250, 252, 0.84) 100%);
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  color: #0f172a;
  box-shadow: 0 3px 12px rgba(15, 23, 42, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.8);
}

html.android-app[data-theme="light"] .android-quick-actions .android-qa-btn:active {
  background: #f1f5f9;
}

html.android-app[data-theme="light"] .android-qa-icon {
  color: #2563eb;
}

/* Seção Produtos em Acompanhamento */
html.android-app .android-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

html.android-app .android-section-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

html.android-app .android-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

html.android-app .android-section-count {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.15);
  color: var(--muted);
}

html.android-app .android-section-link {
  appearance: none;
  border: none;
  background: transparent;
  color: #38bdf8;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 6px;
}

html.android-app[data-theme="light"] .android-section-link {
  color: #2563eb;
}

html.android-app .android-home-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

/* Cards de Produtos Titanium Glass */
html.android-app .android-home-card {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.68) 0%, rgba(15, 23, 42, 0.78) 100%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 6px 20px -3px rgba(2, 6, 23, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  cursor: pointer;
  align-items: center;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

html.android-app[data-theme="light"] .android-home-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(248, 250, 252, 0.82) 100%);
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.8);
}

html.android-app .android-home-card:active {
  transform: scale(0.985);
}

html.android-app .android-home-card .photo {
  width: 78px !important;
  height: 78px !important;
  min-height: 78px !important;
  border-radius: 12px !important;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  padding: 4px;
  box-sizing: border-box;
}

html.android-app[data-theme="light"] .android-home-card .photo {
  background: #f1f5f9;
}

html.android-app .android-home-card .photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 10px;
}

html.android-app .android-home-card-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

html.android-app .android-home-card-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

html.android-app .android-home-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--muted);
}

html.android-app .android-home-card-meta b {
  color: var(--text);
  font-weight: 700;
}

/* Badges e Pílulas de Validade Titanium Glass */
html.android-app .android-home-card-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

html.android-app .android-home-card-badges .badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  border: 1px solid transparent;
}

html.android-app .android-home-card-badges .badge.red {
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.28);
}
html.android-app[data-theme="light"] .android-home-card-badges .badge.red {
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.22);
}

html.android-app .android-home-card-badges .badge.yellow {
  background: rgba(245, 158, 11, 0.14);
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.28);
}
html.android-app[data-theme="light"] .android-home-card-badges .badge.yellow {
  background: rgba(245, 158, 11, 0.08);
  color: #92400e;
  border-color: rgba(245, 158, 11, 0.22);
}

html.android-app .android-home-card-badges .badge.blue {
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.28);
}
html.android-app[data-theme="light"] .android-home-card-badges .badge.blue {
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  border-color: rgba(37, 99, 235, 0.22);
}
`;

if (oldCardsRegex.test(css)) {
  css = css.replace(oldCardsRegex, newCardsSection + '\n\n');
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('Cards de produtos e ações rápidas atualizados para Titanium Glass!');
} else {
  console.error('Seção de cards e ações rápidas não encontrada.');
  process.exit(1);
}

