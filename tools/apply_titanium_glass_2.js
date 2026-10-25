const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// =========================================================================
// 1. Atualizar theme-layout.css com os Tokens Oficiais Titanium Glass 2.0
// =========================================================================
const themeLayoutPath = path.join(root, 'theme-layout.css');
let themeCss = fs.readFileSync(themeLayoutPath, 'utf8');

// Adicionar tokens no tema claro se não existirem
const lightGlassTokens = `  /* Superfícies Titanium Glass 2.0 */
  --sk-glass-bg: rgba(255, 255, 255, 0.85);
  --sk-glass-bg-subtle: rgba(248, 250, 252, 0.75);
  --sk-glass-border: rgba(15, 23, 42, 0.08);
  --sk-glass-specular: rgba(255, 255, 255, 0.95);
  --sk-glass-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
  --sk-glass-blur: 16px;
`;

if (!themeCss.includes('--sk-glass-bg')) {
  themeCss = themeCss.replace(
    /(\s*)--sk-bg-base: #f1f5f9;/,
    '\n' + lightGlassTokens + '$1--sk-bg-base: #f1f5f9;'
  );
}

// Adicionar tokens no tema escuro se não existirem
const darkGlassTokens = `  /* Superfícies Titanium Glass 2.0 */
  --sk-glass-bg: rgba(15, 23, 42, 0.75);
  --sk-glass-bg-subtle: rgba(30, 41, 59, 0.65);
  --sk-glass-border: rgba(255, 255, 255, 0.07);
  --sk-glass-specular: rgba(255, 255, 255, 0.16);
  --sk-glass-shadow: 0 8px 24px -4px rgba(2, 6, 23, 0.45);
  --sk-glass-blur: 16px;
`;

if (!themeCss.includes('/* Superfícies Titanium Glass 2.0 */\n  --sk-glass-bg: rgba(15, 23, 42, 0.75);')) {
  themeCss = themeCss.replace(
    /(\s*)--sk-bg-base: #070b12;/,
    '\n' + darkGlassTokens + '$1--sk-bg-base: #070b12;'
  );
}

fs.writeFileSync(themeLayoutPath, themeCss, 'utf8');
console.log('theme-layout.css atualizado com tokens Titanium Glass 2.0!');

// =========================================================================
// 2. Atualizar android-ui.js: Remover Laser Dots do DOM
// =========================================================================
const androidJsPath = path.join(root, 'android-ui.js');
let androidJs = fs.readFileSync(androidJsPath, 'utf8');

androidJs = androidJs.replace(
  /\s*<span class="android-kpi-laser" aria-hidden="true"><\/span>/g,
  ''
);

fs.writeFileSync(androidJsPath, androidJs, 'utf8');
console.log('android-ui.js atualizado (Laser Dots removidos)!');

// =========================================================================
// 3. Atualizar android-ui.css: Redesenho dos KPIs (React Bits Minimalist)
// =========================================================================
const androidCssPath = path.join(root, 'android-ui.css');
let androidCss = fs.readFileSync(androidCssPath, 'utf8');

// Substituir o bloco dos KPIs
const newKpiCss = `/* ==========================================================================
   TITANIUM GLASS 2.0: Indicadores Principais (React Bits Minimalist)
   - Superfície Glass Translúcida Refinada (Dark & Light)
   - Sem riscos coloridos no topo e sem elementos decorativos chamativos
   - Números grandes protagonistas, ícones neutros e tipografia tabular
   ========================================================================== */
html.android-app .android-kpi-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 10px;
}

html.android-app .android-kpi-card {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.85) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 18px;
  padding: 14px 10px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  align-items: start;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
  box-sizing: border-box;
  box-shadow: 0 8px 24px -4px rgba(2, 6, 23, 0.38), inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
  position: relative;
  overflow: hidden;
}

html.android-app[data-theme="light"] .android-kpi-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(248, 250, 252, 0.85) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.8);
}

html.android-app .android-kpi-card:active {
  transform: scale(0.97);
}

html.android-app .android-kpi-top {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
}

html.android-app .android-kpi-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--kpi-tint);
  color: var(--kpi-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

html.android-app .android-kpi-icon svg {
  width: 17px;
  height: 17px;
  stroke-width: 1.8;
}

html.android-app .android-kpi-value {
  font-size: 30px;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--kpi-accent);
  overflow-wrap: anywhere;
}

/* Card Hero (Vencidos / Hoje) ganha destaque tipográfico assimétrico */
html.android-app .android-kpi-card.kpi-expired .android-kpi-value {
  font-size: clamp(34px, 8.5vw, 40px);
}

html.android-app .android-kpi-label {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--text);
  word-break: normal;
}

html.android-app .android-kpi-sub {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
}

/* Cores semânticas refinadas para comunicação de riscos operacionais */
html.android-app .android-kpi-card.kpi-expired {
  --kpi-accent: #fca5a5;
  --kpi-border: rgba(239, 68, 68, 0.28);
  --kpi-tint: rgba(239, 68, 68, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expired {
  --kpi-accent: #b91c1c;
  --kpi-tint: rgba(239, 68, 68, 0.08);
}

html.android-app .android-kpi-card.kpi-expiring {
  --kpi-accent: #fcd34d;
  --kpi-border: rgba(245, 158, 11, 0.28);
  --kpi-tint: rgba(245, 158, 11, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expiring {
  --kpi-accent: #92400e;
  --kpi-tint: rgba(245, 158, 11, 0.08);
}

html.android-app .android-kpi-card.kpi-offer {
  --kpi-accent: #93c5fd;
  --kpi-border: rgba(59, 130, 246, 0.28);
  --kpi-tint: rgba(59, 130, 246, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-offer {
  --kpi-accent: #1d4ed8;
  --kpi-tint: rgba(37, 99, 235, 0.08);
}`;

// Substituir da seção dos KPIs até o início das Ações Rápidas
const regexKpiSection = /\/\* ==========================================================================\s+SÍNTESE TITANIUM PREMIUM: Indicadores Principais[\s\S]*?(?=\/\* ==========================================================================\s+AÇÕES RÁPIDAS OPERACIONAIS)/;

if (regexKpiSection.test(androidCss)) {
  androidCss = androidCss.replace(regexKpiSection, newKpiCss + '\n\n');
  fs.writeFileSync(androidCssPath, androidCss, 'utf8');
  console.log('android-ui.css atualizado com sucesso com Titanium Glass 2.0!');
} else {
  console.error('Seção dos KPIs não encontrada em android-ui.css.');
  process.exit(1);
}

