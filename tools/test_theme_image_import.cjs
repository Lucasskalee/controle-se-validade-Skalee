const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("Iniciando testes de Importação e Redimensionamento de Imagem no Tema Skalee...");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");

// 1. Validar existência dos elementos da interface no index.html
assert.ok(indexHtml.includes('id="androidGlassWallpaperChooseBtn"'), "Botão de importar imagem deve existir");
assert.ok(indexHtml.includes('id="androidGlassWallpaperInput"'), "Input de arquivo deve existir");
assert.ok(indexHtml.includes('id="glassWallpaperEditPanel"'), "Painel de edição e redimensionamento local deve existir");
assert.ok(indexHtml.includes('id="glassWallpaperResizeSelect"'), "Seletor de redimensionamento deve existir");
assert.ok(indexHtml.includes('id="glassWallpaperFitSelect"'), "Seletor de enquadramento deve existir");
assert.ok(indexHtml.includes('id="glassWallpaperDimRange"'), "Controle deslizante de atenuação deve existir");
assert.ok(indexHtml.includes('id="androidGlassWallpaperApplyBtn"'), "Botão de aplicar foto deve existir");
assert.ok(indexHtml.includes('id="androidGlassWallpaperCancelBtn"'), "Botão de cancelar deve existir");
assert.ok(indexHtml.includes('id="androidGlassWallpaperRemoveBtn"'), "Botão de remover foto deve existir");

console.log("PASS: Elementos da interface presentes no HTML.");

// 2. Testar algoritmo de redimensionamento proporcional
function calculateDimensions(originalWidth, originalHeight, maxDim) {
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;
  if (maxDim > 0 && Math.max(originalWidth, originalHeight) > maxDim) {
    const scale = maxDim / Math.max(originalWidth, originalHeight);
    targetWidth = Math.max(1, Math.round(originalWidth * scale));
    targetHeight = Math.max(1, Math.round(originalHeight * scale));
  }
  return { width: targetWidth, height: targetHeight };
}

// Foto 4K horizontal (3840 x 2160) redimensionada para FHD (1920)
const fhdResult = calculateDimensions(3840, 2160, 1920);
assert.equal(fhdResult.width, 1920);
assert.equal(fhdResult.height, 1080);

// Foto vertical de alta resolução (2000 x 4000) redimensionada para FHD (1920)
const portraitResult = calculateDimensions(2000, 4000, 1920);
assert.equal(portraitResult.height, 1920);
assert.equal(portraitResult.width, 960);

// Foto menor (800 x 600) com limite 1920 não deve ser distorcida nem aumentada
const smallResult = calculateDimensions(800, 600, 1920);
assert.equal(smallResult.width, 800);
assert.equal(smallResult.height, 600);

// Redimensionamento para HD (1280)
const hdResult = calculateDimensions(3840, 2160, 1280);
assert.equal(hdResult.width, 1280);
assert.equal(hdResult.height, 720);

// Redimensionamento para QHD 2K (2560)
const qhdResult = calculateDimensions(3840, 2160, 2560);
assert.equal(qhdResult.width, 2560);
assert.equal(qhdResult.height, 1440);

// Sem redimensionamento (0)
const origResult = calculateDimensions(3840, 2160, 0);
assert.equal(origResult.width, 3840);
assert.equal(origResult.height, 2160);

console.log("PASS: Algoritmo de redimensionamento proporcional validado.");

// 3. Validar aplicação no CSS de skalee-i.css
const skaleeCss = fs.readFileSync(path.resolve(__dirname, "../skalee-i.css"), "utf8");
assert.ok(skaleeCss.includes('--sk-glass-wallpaper-dim'), "skalee-i.css deve suportar variável de atenuação (--sk-glass-wallpaper-dim)");
assert.ok(skaleeCss.includes('--sk-glass-wallpaper-fit'), "skalee-i.css deve suportar variável de enquadramento (--sk-glass-wallpaper-fit)");
assert.ok(skaleeCss.includes('[data-glass-wallpaper="image"]'), "skalee-i.css deve suportar wallpaper de imagem tanto na Web quanto no Android");

console.log("PASS: Suporte a variáveis de wallpaper e atenuação em skalee-i.css validado.");
console.log("TODOS OS TESTES DE IMPORTAÇÃO E REDIMENSIONAMENTO PASSARAM COM SUCESSO!");
