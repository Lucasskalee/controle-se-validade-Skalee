const fs = require("fs");
const path = require("path");
const sharp = require("../.npm-cache/mascot-vectorizer/node_modules/sharp");

const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets", "skalito");

const ANATOMY_PERFECT_CONFIG = {
  viewBox: "0 0 1000 1000",
  centerAxisX: 495,
  pieces: [
    {
      id: "wing-left",
      name: "Asa Esquerda (Costas)",
      file: "wing-right.png",
      x: 130,
      y: 395,
      width: 272,
      height: 188,
      pivot: { x: 375, y: 505 },
      rot: 0
    },
    {
      id: "wing-right",
      name: "Asa Direita (Costas)",
      file: "wing-left.png",
      x: 560,
      y: 385,
      width: 335,
      height: 205,
      pivot: { x: 610, y: 505 },
      rot: 0
    },
    {
      id: "body-lower",
      name: "Torso, Cintura, Pernas e Cauda",
      file: "body-lower.png",
      x: 235,
      y: 495,
      width: 630,
      height: 360,
      pivot: { x: 495, y: 845 },
      rot: 0
    },
    {
      id: "collar",
      name: "Jaleco / Bandana Skalee",
      file: "collar.png",
      x: 348,
      y: 450,
      width: 256,
      height: 250,
      pivot: { x: 475, y: 520 },
      rot: 0
    },
    {
      id: "arm-right",
      name: "Braço Direito (Nascendo do Ombro)",
      file: "arm-right.png",
      x: 520,
      y: 520,
      width: 135,
      height: 200,
      pivot: { x: 570, y: 535 },
      rot: 0
    },
    {
      id: "arm-left",
      name: "Braço Esquerdo (Nascendo do Ombro)",
      file: "arm-left.png",
      x: 180,
      y: 418,
      width: 252,
      height: 168,
      pivot: { x: 380, y: 510 },
      rot: 0
    },
    {
      id: "head",
      name: "Cabeça (40% Proporção, Chibi)",
      file: "head.png",
      x: 280,
      y: 145,
      width: 440,
      height: 485,
      pivot: { x: 495, y: 520 },
      rot: 0
    },
    {
      id: "eye-left",
      name: "Olho Esquerdo",
      file: "eye-left.png",
      x: 345,
      y: 368,
      width: 72,
      height: 100,
      pivot: { x: 381, y: 418 },
      rot: 0
    },
    {
      id: "eye-right",
      name: "Olho Direito",
      file: "eye-right.png",
      x: 511,
      y: 372,
      width: 82,
      height: 100,
      pivot: { x: 552, y: 422 },
      rot: 0
    }
  ]
};

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
    </g>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${config.viewBox}" width="100%" height="100%" role="img" aria-label="Mascote Skalito">
  <g id="skalito-root" class="skalito-root" style="transform-origin: ${config.centerAxisX}px 750px;">
${imagesMarkup}
  </g>
</svg>`;
}

async function renderAnatomyPerfect() {
  const svgContent = generateSvg(ANATOMY_PERFECT_CONFIG, true);
  fs.writeFileSync(path.join(ASSETS_DIR, "skalito-rig.svg"), generateSvg(ANATOMY_PERFECT_CONFIG, false), "utf8");
  fs.writeFileSync(path.join(ASSETS_DIR, "skalito-rig-standalone.svg"), svgContent, "utf8");

  const rigRenderPath = path.join(ROOT, "dev/pieces-inspect/rig-anatomy-render.png");
  await sharp(Buffer.from(svgContent)).png().toFile(rigRenderPath);

  const refPath = path.join(ROOT, "dev/pieces-inspect/ref.png");
  const refResized = await sharp(refPath).resize(500, 500).png().toBuffer();
  const anatomyResized = await sharp(rigRenderPath).resize(500, 500).png().toBuffer();

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
    { input: anatomyResized, left: 512, top: 10 }
  ])
  .png()
  .toFile(path.join(ROOT, "dev/pieces-inspect/side-by-side-anatomy.png"));

  console.log("Rendered perfect anatomy rig to dev/pieces-inspect/side-by-side-anatomy.png");
}

renderAnatomyPerfect().catch(console.error);
