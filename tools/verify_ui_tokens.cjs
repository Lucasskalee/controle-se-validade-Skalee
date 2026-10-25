/**
 * tools/verify_ui_tokens.cjs
 *
 * Verificação Automatizada de Design Tokens Skalee (Fase 1)
 *
 * - Garante que novos estilos utilizem os tokens oficiais (--sk-*)
 * - Permite explicitamente as variáveis legadas já existentes (camada de compatibilidade)
 * - Identifica tokens arbitrários fora da convenção
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// Arquivos de interface a serem inspecionados
const TARGET_FILES = [
  'theme-layout.css',
  'android-ui.css',
  'admin-cadastros.css',
  'auth.css',
  'product-detail.css',
  'notification-center.css',
  'index.html'
];

// Lista explícita de variáveis legadas permitidas (retrocompatibilidade controlada)
const ALLOWED_LEGACY_TOKENS = new Set([
  // Paleta base clássica
  'bg', 'card', 'text', 'muted', 'line',
  'blue', 'blue2', 'red', 'orange', 'yellow', 'green',
  'primary',

  // Variáveis violeta legadas
  'violet', 'violet-hover', 'violet-glow',

  // CSS Houdini / At-rules
  'border-angle',

  // KPIs Mobile (android-ui.css)
  'kpi-border', 'kpi-tint', 'kpi-accent',

  // Módulo Administrativo (admin-cadastros)
  'admin-bg', 'admin-surface', 'admin-surface-2', 'admin-border',
  'admin-primary', 'admin-cyan', 'admin-text', 'admin-muted',
  'admin-success', 'admin-warning', 'admin-danger',

  // Efeitos visuais e componentes modulares
  'ring-color',
  'notification-tone',
  'percentage',
  'glow-c1', 'glow-c2', 'glow-c3', 'glow-shadow', 'glow-shadow-hover',

  // Layout dinâmico e celebrações (index.html)
  'bar', 'catalog-progress', 'icon-columns', 'product-columns', 'report-columns',
  'confetti-color', 'confetti-delay', 'confetti-rotation', 'confetti-x', 'confetti-y',
  'firework-color', 'firework-delay', 'firework-left', 'firework-top', 'firework-x', 'firework-y'
]);

function isAllowedToken(tokenName) {
  // 1. Tokens oficiais Skalee iniciados com 'sk-'
  if (tokenName.startsWith('sk-')) return true;

  // 2. Tokens legados permitidos da lista de compatibilidade
  if (ALLOWED_LEGACY_TOKENS.has(tokenName)) return true;

  return false;
}

function runAudit() {
  console.log('='.repeat(65));
  console.log(' SKALEE DESIGN SYSTEM — VERIFICAÇÃO AUTOMATIZADA DE TOKENS');
  console.log('='.repeat(65));

  let totalFilesScanned = 0;
  let totalTokensFound = 0;
  const officialTokens = new Set();
  const legacyTokens = new Set();
  const violations = [];

  for (const relPath of TARGET_FILES) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath)) continue;

    totalFilesScanned++;
    const content = fs.readFileSync(fullPath, 'utf8');

    // Se for index.html, extrair apenas o bloco de estilo
    let styleToInspect = content;
    let baseLineOffset = 0;
    if (relPath.endsWith('.html')) {
      const match = content.match(/<style>([\s\S]*?)<\/style>/);
      if (!match) continue;
      styleToInspect = match[1];
      const prefix = content.slice(0, match.index);
      baseLineOffset = prefix.split('\n').length - 1;
    }

    const lines = styleToInspect.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1 + baseLineOffset;
      // Captura tokens declarados (--token:) ou usados (var(--token))
      const matches = line.matchAll(/--([a-zA-Z0-9_-]+)/g);

      for (const m of matches) {
        const token = m[1];
        totalTokensFound++;

        if (token.startsWith('sk-')) {
          officialTokens.add(token);
        } else if (ALLOWED_LEGACY_TOKENS.has(token)) {
          legacyTokens.add(token);
        } else {
          violations.push({
            file: relPath,
            line: lineNum,
            token,
            context: line.trim()
          });
        }
      }
    });
  }

  console.log(`\nArquivos inspecionados: ${totalFilesScanned}`);
  console.log(`Total de ocorrências de tokens: ${totalTokensFound}`);
  console.log(`Tokens oficiais --sk-* únicos encontrados: ${officialTokens.size}`);
  console.log(`Tokens legados mapeados permitidos: ${legacyTokens.size}`);

  if (violations.length > 0) {
    console.error('\n❌ VIOLAÇÕES DE DESIGN TOKENS ENCONTRADAS:');
    console.error('Tokens fora do padrão (não usam --sk-* e não constam na lista legada):\n');
    violations.forEach(v => {
      console.error(`  - [${v.file}:${v.line}] --${v.token}`);
      console.error(`    Contexto: ${v.context}`);
    });
    console.error('\nConsulte DESIGN.md para registrar ou adequar novos tokens.');
    process.exit(1);
  }

  console.log('\n✅ SUCESSO: Todos os tokens utilizados são oficiais (--sk-*) ou constam na camada de compatibilidade autorizada.');
  console.log('='.repeat(65));
}

runAudit();

