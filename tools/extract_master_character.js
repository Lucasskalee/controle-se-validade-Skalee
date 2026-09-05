const fs = require("fs");
const path = require("path");
const sharp = require("../.npm-cache/mascot-vectorizer/node_modules/sharp");

const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = path.resolve(process.env.USERPROFILE || "C:/Users/skale", "Downloads");
const masterImgPath = path.join(DOWNLOADS, "WhatsApp Image 2026-08-30 at 01.19.57.jpeg");

async function extractMasterTransparent() {
  const { data, info } = await sharp(masterImgPath).raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  // Background is dark vignette. Let's sample background corners:
  // (0,0), (width-1, 0), (0, height-1), (width-1, height-1)
  const outBuf = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const outIdx = (y * width + x) * 4;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      outBuf[outIdx] = r;
      outBuf[outIdx + 1] = g;
      outBuf[outIdx + 2] = b;

      // Calculate brightness and color distance from background
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Cyan / Blue glows have high B/G relative to R
      const isCyanGlow = (b > 25 && g > 20 && (b - r > 10 || g - r > 8));
      const isRedMarking = (r > 35 && (r - g > 15 || r - b > 15));
      const isWhiteEye = (r > 150 && g > 150 && b > 150);
      const isCharacterBody = lum > 14 || maxC > 18;

      let alpha = 0;
      if (isWhiteEye) {
        alpha = 255;
      } else if (isCyanGlow || isRedMarking) {
        alpha = Math.min(255, Math.round(maxC * 2.2));
      } else if (isCharacterBody) {
        // Soft ramp from background threshold (12 to 24)
        if (lum <= 10) {
          alpha = 0;
        } else if (lum < 22) {
          alpha = Math.min(255, Math.round(((lum - 10) / 12) * 255));
        } else {
          alpha = 255;
        }
      }

      outBuf[outIdx + 3] = alpha;
    }
  }

  // Flood fill / morphological clean to preserve all character interior pixels
  // Any pixel enclosed inside the character bounding box is solid alpha
  // Let's create the master transparent PNG
  await sharp(outBuf, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path.join(ROOT, "dev/pieces-inspect/master-transparent.png"));

  console.log("Created master-transparent.png successfully!");
}

extractMasterTransparent().catch(console.error);

