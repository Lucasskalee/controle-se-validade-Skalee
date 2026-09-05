const fs = require("fs/promises");
const path = require("path");
const sharp = require("../.npm-cache/mascot-vectorizer/node_modules/sharp");
const potrace = require("../.npm-cache/mascot-vectorizer/node_modules/potrace");

const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = path.resolve(process.env.USERPROFILE || "C:/Users/skale", "Downloads");
const OUT_DIR = path.join(ROOT, "assets", "mascot-svg");

const inputs = [
  { name: "arm-down", file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (3).png" },
  { name: "eye-left", file: "ChatGPT Image 30 de ago. de 2026, 12_16_04 (7).png" },
  { name: "head", file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (1).png" },
  { name: "wing-left", file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (5).png" },
  { name: "arm-up", file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (2).png" },
  { name: "eye-right", file: "ChatGPT Image 30 de ago. de 2026, 12_16_04 (6).png" },
  { name: "wing-right", file: "ChatGPT Image 30 de ago. de 2026, 12_16_03 (4).png" },
  { name: "full-reference", file: "WhatsApp Image 2026-08-30 at 01.19.57.jpeg", jpeg: true },
];

const colors = {
  silhouette: "#050914",
  dark: "#151b28",
  shade: "#2f3546",
  cyan: "#00e6ff",
  red: "#ff4057",
  white: "#ffffff",
};

function trace(buffer, params = {}) {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, {
      threshold: 128,
      turdSize: 8,
      optTolerance: 0.32,
      color: "#000",
      background: "transparent",
      ...params,
    }, (error, svg) => {
      if (error) reject(error);
      else resolve(svg);
    });
  });
}

function extractPaths(svg) {
  return [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"[^>]*>/g)].map((match) => match[1]);
}

function bboxFromPixels(data, width, height, hasAlpha, jpeg) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = hasAlpha ? data[i + 3] : 255;
      const visible = jpeg
        ? a > 0 && (r + g + b > 34) && !(r < 8 && g < 8 && b < 10)
        : a > 12;
      if (!visible) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { left: 0, top: 0, width, height };
  const pad = 8;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(width - 1, maxX + pad);
  const bottom = Math.min(height - 1, maxY + pad);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function maskForLayer(data, width, height, layer, jpeg) {
  const mask = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const bright = (r + g + b) / 3;
      const visible = jpeg
        ? a > 0 && bright > 8
        : a > 12;
      const cyan = visible && b > 120 && g > 100 && r < 95 && (b - r) > 55;
      const red = visible && r > 130 && g < 110 && b < 120 && (r - g) > 45;
      const white = visible && r > 185 && g > 185 && b > 185 && (max - min) < 38;
      const shade = visible && !cyan && !red && !white && bright > 42 && bright < 148;
      let on = false;
      if (layer === "silhouette") on = visible;
      if (layer === "dark") on = visible && !cyan && !red && !white;
      if (layer === "shade") on = shade;
      if (layer === "cyan") on = cyan;
      if (layer === "red") on = red;
      if (layer === "white") on = white;
      const v = on ? 0 : 255;
      mask[i] = v;
      mask[i + 1] = v;
      mask[i + 2] = v;
      mask[i + 3] = 255;
    }
  }
  return mask;
}

function group(id, paths, fill, attrs = "") {
  if (!paths.length) return "";
  const content = paths.map((d) => `    <path d="${d}"/>`).join("\n");
  return `  <g id="${id}" fill="${fill}"${attrs}>\n${content}\n  </g>`;
}

async function vectorizeAsset(asset) {
  const input = path.join(DOWNLOADS, asset.file);
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const bbox = bboxFromPixels(data, info.width, info.height, true, Boolean(asset.jpeg));
  const cropped = await sharp(input).ensureAlpha().extract(bbox).raw().toBuffer({ resolveWithObject: true });

  const layers = ["silhouette", "dark", "shade", "cyan", "red", "white"];
  const traced = {};
  for (const layer of layers) {
    const mask = maskForLayer(cropped.data, cropped.info.width, cropped.info.height, layer, Boolean(asset.jpeg));
    const png = await sharp(mask, {
      raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 },
    }).png().toBuffer();
    traced[layer] = extractPaths(await trace(png, { turdSize: layer === "silhouette" ? 12 : 5 }));
  }

  const width = cropped.info.width;
  const height = cropped.info.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Skalito ${asset.name}">
 <defs>
  <filter id="cyan-glow" x="-25%" y="-25%" width="150%" height="150%">
   <feGaussianBlur stdDeviation="5" result="blur"/>
   <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="red-glow" x="-25%" y="-25%" width="150%" height="150%">
   <feGaussianBlur stdDeviation="4" result="blur"/>
   <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
 </defs>
 <g id="${asset.name}" transform-origin="center">
${group("silhouette", traced.silhouette, colors.silhouette)}
${group("body-dark", traced.dark, colors.dark, ' opacity="0.94"')}
${group("body-shade", traced.shade, colors.shade, ' opacity="0.42"')}
${group("glow-cyan", traced.cyan, colors.cyan, ' filter="url(#cyan-glow)"')}
${group("glow-red", traced.red, colors.red, ' filter="url(#red-glow)"')}
${group("white", traced.white, colors.white)}
 </g>
</svg>
`;

  await fs.writeFile(path.join(OUT_DIR, `${asset.name}.svg`), svg, "utf8");
  return { name: asset.name, width, height, bbox, layers: Object.fromEntries(layers.map((layer) => [layer, traced[layer].length])) };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const results = [];
  for (const input of inputs) results.push(await vectorizeAsset(input));
  await fs.writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
