const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'android-ui.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Bloco atual a substituir em android-ui.css
const oldKpiSection = `/* Indicadores principais (Vencidos, Próximos do vencimento, Em oferta) */
html.android-app .android-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

html.android-app .android-kpi-card {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--kpi-border);
  background: var(--card, #1e293b);
  border-radius: 20px;
  padding: 16px 12px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  align-items: start;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
  transition: transform 0.15s ease, border-color 0.15s ease;
  min-width: 0;
  box-sizing: border-box;
}

html.android-app .android-kpi-card:active {
  transform: scale(0.97);
}

html.android-app .android-kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 6px;
}

html.android-app .android-kpi-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--kpi-tint);
  color: var(--kpi-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

html.android-app .android-kpi-icon svg {
  width: 18px;
  height: 18px;
  stroke-width: 1.8;
}

html.android-app .android-kpi-value {
  font-size: clamp(30px, 8vw, 38px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--kpi-accent);
  overflow-wrap: anywhere;
}

html.android-app .android-kpi-label {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text);
  word-break: normal;
}

html.android-app .android-kpi-sub {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

html.android-app .android-kpi-card.kpi-expired {
  --kpi-accent: #fca5a5;
  --kpi-border: rgba(239, 68, 68, 0.28);
  --kpi-tint: rgba(239, 68, 68, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expired {
  --kpi-accent: #b91c1c;
}

html.android-app .android-kpi-card.kpi-expiring {
  --kpi-accent: #fcd34d;
  --kpi-border: rgba(245, 158, 11, 0.28);
  --kpi-tint: rgba(245, 158, 11, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expiring {
  --kpi-accent: #92400e;
}

html.android-app .android-kpi-card.kpi-offer {
  --kpi-accent: #93c5fd;
  --kpi-border: rgba(59, 130, 246, 0.28);
  --kpi-tint: rgba(59, 130, 246, 0.10);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-offer {
  --kpi-accent: #1d4ed8;
}`;

// Novo bloco com Síntese Titanium Premium (Titanium Flow + Borderless + Glass Metallic)
const newKpiSection = `/* ==========================================================================
   SÍNTESE TITANIUM PREMIUM: Indicadores Principais (KPIs)
   - Layout Assimétrico (Hero Vencidos)
   - Acabamento Borderless com Destaque Metálico Superior
   - Laser Dots e Micro-brilhos Semânticos
   ========================================================================== */
html.android-app .android-kpi-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 10px;
}

html.android-app .android-kpi-card {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.20);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.88) 0%, rgba(15, 23, 42, 0.96) 100%);
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
  box-shadow: 0 8px 24px -4px rgba(2, 6, 23, 0.45);
  position: relative;
  overflow: hidden;
}

/* Indicador sutil de borda superior semitransparente */
html.android-app .android-kpi-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--kpi-accent);
  opacity: 0.75;
}

html.android-app[data-theme="light"] .android-kpi-card {
  border: 1px solid rgba(15, 23, 42, 0.09);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
}

html.android-app .android-kpi-card:active {
  transform: scale(0.97);
}

html.android-app .android-kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 6px;
}

/* Laser Dots Lúmina */
html.android-app .android-kpi-laser {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

html.android-app .android-kpi-card.kpi-expired .android-kpi-laser {
  background: #ef4444;
  box-shadow: 0 0 8px #ef4444, 0 0 16px rgba(239, 68, 68, 0.55);
}

html.android-app .android-kpi-card.kpi-expiring .android-kpi-laser {
  background: #f59e0b;
  box-shadow: 0 0 8px #f59e0b, 0 0 16px rgba(245, 158, 11, 0.55);
}

html.android-app .android-kpi-card.kpi-offer .android-kpi-laser {
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8, 0 0 16px rgba(56, 189, 248, 0.55);
}

html.android-app[data-theme="light"] .android-kpi-card.kpi-expired .android-kpi-laser {
  background: #dc2626;
  box-shadow: 0 0 6px rgba(220, 38, 38, 0.6);
}

html.android-app[data-theme="light"] .android-kpi-card.kpi-expiring .android-kpi-laser {
  background: #d97706;
  box-shadow: 0 0 6px rgba(217, 119, 6, 0.6);
}

html.android-app[data-theme="light"] .android-kpi-card.kpi-offer .android-kpi-laser {
  background: #2563eb;
  box-shadow: 0 0 6px rgba(37, 99, 235, 0.6);
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

html.android-app .android-kpi-card.kpi-expired {
  --kpi-accent: #fca5a5;
  --kpi-border: rgba(239, 68, 68, 0.28);
  --kpi-tint: rgba(239, 68, 68, 0.12);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expired {
  --kpi-accent: #b91c1c;
  --kpi-tint: rgba(239, 68, 68, 0.08);
}

html.android-app .android-kpi-card.kpi-expiring {
  --kpi-accent: #fcd34d;
  --kpi-border: rgba(245, 158, 11, 0.28);
  --kpi-tint: rgba(245, 158, 11, 0.12);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-expiring {
  --kpi-accent: #92400e;
  --kpi-tint: rgba(245, 158, 11, 0.08);
}

html.android-app .android-kpi-card.kpi-offer {
  --kpi-accent: #93c5fd;
  --kpi-border: rgba(59, 130, 246, 0.28);
  --kpi-tint: rgba(59, 130, 246, 0.12);
}
html.android-app[data-theme="light"] .android-kpi-card.kpi-offer {
  --kpi-accent: #1d4ed8;
  --kpi-tint: rgba(37, 99, 235, 0.08);
}

/* ==========================================================================
   AÇÕES RÁPIDAS OPERACIONAIS (Placa Titânio com Superfície de Precisão)
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
  border-radius: 14px;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-top: 1px solid rgba(255, 255, 255, 0.16);
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
  box-shadow: 0 4px 14px rgba(2, 6, 23, 0.20);
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
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
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.95);
  color: #0f172a;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}

html.android-app[data-theme="light"] .android-quick-actions .android-qa-btn:active {
  background: #f1f5f9;
}

html.android-app[data-theme="light"] .android-qa-icon {
  color: #2563eb;
}`;

// Normalização de quebras de linha para substituição confiável
const norm = s => s.replace(/\r\n/g, '\n');

if (norm(css).includes(norm(oldKpiSection))) {
  css = norm(css).replace(norm(oldKpiSection), norm(newKpiSection));
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('android-ui.css atualizado com sucesso!');
} else {
  console.error('Bloco alvo não encontrado em android-ui.css.');
  process.exit(1);
}

