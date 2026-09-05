const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log("=== INICIANDO VERIFICAÇÃO DO MASCOTE CYBER SPIRIT E TOUR ===");

// 1. Assets do Mascote
const requiredAssets = [
  "assets/mascot/head.png",
  "assets/mascot/body.png",
  "assets/mascot/left-arm.png",
  "assets/mascot/right-arm.png",
  "assets/mascot/left-wing.png",
  "assets/mascot/right-wing.png",
  "assets/mascot/left-eye.png",
  "assets/mascot/right-eye.png"
];

for (const asset of requiredAssets) {
  const full = path.join(ROOT, asset);
  assert(fs.existsSync(full), `Asset existe: ${asset}`);
  assert(fs.statSync(full).size > 100, `Asset válido: ${asset}`);
}

// 2. Componentes
const requiredComponents = [
  "components/skalito/SkalitoMascot.js",
  "components/skalito/skalito.css",
  "components/skalito/skalitoAnimations.css",
  "components/tour/SkalitoTour.js",
  "components/tour/skalitoTourSteps.js",
  "components/tour/skalitoTour.css"
];

for (const comp of requiredComponents) {
  const full = path.join(ROOT, comp);
  assert(fs.existsSync(full), `Componente existe: ${comp}`);
}

console.log("\n🎉 TODAS AS VERIFICAÇÕES DO MASCOTE E TOUR PASSARAM COM SUCESSO!");
