const fs = require("fs");
const path = require("path");
const sharp = require("../.npm-cache/mascot-vectorizer/node_modules/sharp");

const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = path.resolve(process.env.USERPROFILE || "C:/Users/skale", "Downloads");
const TARGET_DIR = path.join(ROOT, "assets", "skalito");

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const PIECES_SPEC = [
  {
    id: "wing-left",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (5).png",
    name: "Asa Esquerda",
    targetFile: "wing-left.png"
  },
  {
    id: "wing-right",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (4).png",
    name: "Asa Direita",
    targetFile: "wing-right.png"
  },
  {
    id: "body-lower",
    file: "ChatGPT Image 30 de ago. de 2026, 12_44_40.png",
    name: "Corpo Inferior, Pernas e Cauda",
    targetFile: "body-lower.png"
  },
  {
    id: "arm-right",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (3).png",
    name: "Braco Direito (Repouso)",
    targetFile: "arm-right.png"
  },
  {
    id: "head",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (1).png",
    name: "Cabeca",
    targetFile: "head.png"
  },
  {
    id: "eye-left",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_04 (7).png",
    name: "Olho Esquerdo",
    targetFile: "eye-left.png"
  },
  {
    id: "eye-right",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_04 (6).png",
    name: "Olho Direito",
    targetFile: "eye-right.png"
  },
  {
    id: "collar",
    file: "ChatGPT Image 30 de ago. de 2026, 12_44_52.png",
    name: "Bandana / Colar Skalee",
    targetFile: "collar.png"
  },
  {
    id: "arm-left",
    file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (2).png",
    name: "Braco Esquerdo (Acenando)",
    targetFile: "arm-left.png"
  }
];

async function computeBbox(imageBuffer) {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  let nonTransparent = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > 12) {
        nonTransparent++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { left: 0, top: 0, width: info.width, height: info.height, pixels: 0 };
  }

  // Small 4px padding around cropped bounds
  const pad = 4;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(info.width - 1, maxX + pad);
  const bottom = Math.min(info.height - 1, maxY + pad);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    rawMinX: minX,
    rawMinY: minY,
    rawMaxX: maxX,
    rawMaxY: maxY,
    pixels: nonTransparent,
    canvasWidth: info.width,
    canvasHeight: info.height
  };
}

async function processAll() {
  console.log("Processando pecas do Skalito a partir de:", DOWNLOADS);
  const manifest = [];

  for (const piece of PIECES_SPEC) {
    const srcPath = path.join(DOWNLOADS, piece.file);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Arquivo fonte nao encontrado: ${srcPath}`);
    }

    const srcBuffer = fs.readFileSync(srcPath);
    const bbox = await computeBbox(srcBuffer);

    // Save full original high-res transparent PNG
    const fullDest = path.join(TARGET_DIR, `full-${piece.targetFile}`);
    await sharp(srcBuffer).png({ compressionLevel: 9 }).toFile(fullDest);

    // Save tight cropped transparent PNG
    const cropDest = path.join(TARGET_DIR, piece.targetFile);
    await sharp(srcBuffer)
      .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
      .png({ compressionLevel: 9 })
      .toFile(cropDest);

    console.log(`[OK] ${piece.id}: ${piece.targetFile} (${bbox.width}x${bbox.height}) recortado de (${bbox.canvasWidth}x${bbox.canvasHeight})`);

    manifest.push({
      id: piece.id,
      name: piece.name,
      targetFile: piece.targetFile,
      fullTargetFile: `full-${piece.targetFile}`,
      bbox,
      srcFile: piece.file
    });
  }

  fs.writeFileSync(path.join(TARGET_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Manifesto salvo em: ${path.join(TARGET_DIR, "manifest.json")}`);
}

processAll().catch(err => {
  console.error("Erro no processamento:", err);
  process.exit(1);
});

