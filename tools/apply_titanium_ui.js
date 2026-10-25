const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'android-ui.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Inserir laser dots no topo de cada KPI
code = code.replace(
  /<div class="android-kpi-top">(\r?\n\s*)<span class="android-kpi-icon"/g,
  '<div class="android-kpi-top">$1  <span class="android-kpi-laser" aria-hidden="true"></span>$1  <span class="android-kpi-icon"'
);

// 2. Inserir Quick Actions logo abaixo de android-kpi-grid
const qaMarkup = `        <div class="android-quick-actions" role="region" aria-label="Ações operacionais rápidas">
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
        </div>\n\n`;

if (!code.includes('android-quick-actions')) {
  code = code.replace(
    /(\s*)<div class="android-section-head">/,
    '\n' + qaMarkup + '$1<div class="android-section-head">'
  );
}

// 3. Adicionar listeners para os botões de ação rápida
const listeners = `    homeSection.querySelector('#androidQaScan')?.addEventListener('click', () => {
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
    });\n\n`;

if (!code.includes('#androidQaScan')) {
  code = code.replace(
    /(\s*)homeSection\.querySelector\('#androidKpiOffer'\)\.addEventListener\('click'/,
    '\n' + listeners + '$1homeSection.querySelector(\'#androidKpiOffer\').addEventListener(\'click\''
  );
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('android-ui.js atualizado com sucesso!');

