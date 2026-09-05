const fs = require("fs");
const path = require("path");
const sharp = require("../.npm-cache/mascot-vectorizer/node_modules/sharp");

const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets", "skalito");

const PERFECT_RIG_CONFIG = {
  viewBox: "0 0 1000 1000",
  pieces: [
    {
      id: "wing-left",
      name: "Asa Esquerda",
      file: "wing-right.png",
      x: 96,
      y: 430,
      width: 320,
      height: 225,
      pivot: { x: 386, y: 570 },
      rot: 0
    },
    {
      id: "wing-right",
      name: "Asa Direita",
      file: "wing-left.png",
      x: 548,
      y: 420,
      width: 388,
      height: 244,
      pivot: { x: 616, y: 570 },
      rot: 0
    },
    {
      id: "body-lower",
      name: "Corpo, Pernas e Cauda",
      file: "body-lower.png",
      x: 240,
      y: 498,
      width: 620,
      height: 450,
      pivot: { x: 500, y: 908 },
      rot: 0
    },
    {
      id: "collar",
      name: "Bandana / Jaleco Skalee (Atrás da Cabeça)",
      file: "collar.png",
      x: 318,
      y: 488,
      width: 340,
      height: 270,
      pivot: { x: 488, y: 572 },
      rot: 0
    },
    {
      id: "arm-right",
      name: "Braço Direito (Ajustado ao Tronco)",
      file: "arm-right.png",
      x: 580,
      y: 548,
      width: 120,
      height: 230,
      pivot: { x: 616, y: 576 },
      rot: 0
    },
    {
      id: "arm-left",
      name: "Braço Esquerdo (Ajustado ao Ombro)",
      file: "arm-left.png",
      x: 126,
      y: 462,
      width: 292,
      height: 190,
      pivot: { x: 382, y: 566 },
      rot: 0
    },
    {
      id: "head",
      name: "Cabeça (Na Frente do Jaleco)",
      file: "head.png",
      x: 305,
      y: 66,
      width: 390,
      height: 585,
      pivot: { x: 500, y: 570 },
      rot: 0
    },
    {
      id: "eye-left",
      name: "Olho Esquerdo",
      file: "eye-left.png",
      x: 358,
      y: 334,
      width: 88,
      height: 134,
      pivot: { x: 402, y: 401 },
      rot: 0
    },
    {
      id: "eye-right",
      name: "Olho Direito",
      file: "eye-right.png",
      x: 496,
      y: 338,
      width: 100,
      height: 134,
      pivot: { x: 546, y: 405 },
      rot: 0
    }
  ]
};

const VALIDATION_GUIDES = [
  { label: "horns", x: 332, y: 66, width: 335, height: 150 },
  { label: "neck/scarf", x: 318, y: 488, width: 340, height: 94 },
  { label: "torso", x: 330, y: 580, width: 330, height: 210 },
  { label: "legs", x: 280, y: 710, width: 390, height: 170 },
  { label: "feet", x: 258, y: 844, width: 430, height: 104 },
  { label: "tail", x: 630, y: 652, width: 230, height: 210 }
];

function generateSvg(config, inlineBase64 = false) {
  const imagesMarkup = config.pieces.map(p => {
    let href = p.file;
    if (inlineBase64) {
      const imgPath = path.join(ASSETS_DIR, p.file);
      const b64 = fs.readFileSync(imgPath).toString("base64");
      href = `data:image/png;base64,${b64}`;
    }
    return `    <!-- ${p.name} -->
    <g id="${p.id}" class="skalito-piece piece-${p.id}" data-pivot-x="${p.pivot.x}" data-pivot-y="${p.pivot.y}" style="transform-origin: ${p.pivot.x}px ${p.pivot.y}px;">
      <image href="${href}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" preserveAspectRatio="xMidYMid meet" />
      <rect class="skalito-debug-box" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="0" ry="0" fill="none" display="none" />
      <text class="skalito-debug-label" x="${p.x + 6}" y="${p.y + 16}" display="none">${p.id}</text>
      <circle class="skalito-pivot-marker" cx="${p.pivot.x}" cy="${p.pivot.y}" r="${p.id.includes("eye") ? 5 : 7}" fill="${p.id.includes("eye") ? "#00d9ff" : "#ff4057"}" stroke="#fff" stroke-width="${p.id.includes("eye") ? 1.5 : 2}" display="none" />
    </g>`;
  }).join("\n");

  const guideMarkup = VALIDATION_GUIDES.map(g => `    <g class="skalito-validation-guide" aria-hidden="true">
      <rect class="skalito-debug-box" x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="0" ry="0" fill="none" display="none" />
      <text class="skalito-debug-label" x="${g.x + 6}" y="${g.y + 16}" display="none">${g.label}</text>
    </g>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${config.viewBox}" width="100%" height="100%" role="img" aria-label="Mascote Skalito">
  <g id="skalito-root" class="skalito-root" style="transform-origin: 500px 790px;">
${imagesMarkup}
${guideMarkup}
  </g>
</svg>`;
}

async function renderPerfect() {
  const svgContent = generateSvg(PERFECT_RIG_CONFIG, true);
  fs.writeFileSync(path.join(ASSETS_DIR, "skalito-rig.svg"), generateSvg(PERFECT_RIG_CONFIG, false), "utf8");
  fs.writeFileSync(path.join(ASSETS_DIR, "skalito-rig-standalone.svg"), svgContent, "utf8");

  const rigRenderPath = path.join(ROOT, "dev/pieces-inspect/rig-perfect-render.png");
  await sharp(Buffer.from(svgContent)).png().toFile(rigRenderPath);

  // Generate side-by-side comparison
  const refPath = path.join(ROOT, "dev/pieces-inspect/ref.png");
  const refResized = await sharp(refPath).resize(500, 500).png().toBuffer();
  const surgicalResized = await sharp(rigRenderPath).resize(500, 500).png().toBuffer();

  await sharp({
    create: {
      width: 1020,
      height: 520,
      channels: 4,
      background: { r: 10, g: 15, b: 24, alpha: 255 }
    }
  })
  .composite([
    { input: refResized, left: 8, top: 10 },
    { input: surgicalResized, left: 512, top: 10 }
  ])
  .png()
  .toFile(path.join(ROOT, "dev/pieces-inspect/side-by-side-perfect.png"));

  console.log("Rendered perfect surgical rig to dev/pieces-inspect/side-by-side-perfect.png");
}

renderPerfect().catch(console.error);
