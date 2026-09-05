const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const css1 = fs.readFileSync(path.join(ROOT, "components/skalito/skalito.css"), "utf8");
const css2 = fs.readFileSync(path.join(ROOT, "components/skalito/skalitoAnimations.css"), "utf8");
const standaloneSvg = fs.readFileSync(path.join(ROOT, "assets/skalito/skalito-rig-standalone.svg"), "utf8");

const html = `<!doctype html>
<html lang="pt-BR" data-bg="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Skalito SVG - Validação Anatômica e Animação | Skalee</title>
  <link rel="icon" type="image/png" sizes="64x64" href="skalee-icon-64.png">
  <style>
${css1}
${css2}

    * { box-sizing: border-box; }
    :root {
      --sk-primary: #0756d8;
      --sk-cyan: #00d9ff;
      --sk-cyan-glow: rgba(0, 217, 255, 0.4);
      --sk-text: #e8edf5;
      --sk-muted: #94a3b8;
      --sk-border: #1f3348;
      --sk-sidebar: #0d1726;
      --sk-card: #101c2d;
    }

    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100svh;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: var(--sk-text);
      background: #070b12;
      display: grid;
      grid-template-columns: minmax(290px, 350px) 1fr;
      transition: background-color 0.25s ease;
      overflow-x: hidden;
    }

    body[data-bg="dark"] { background: #070b12; }
    body[data-bg="light"] { background: #ffffff; color: #172033; }
    body[data-bg="neutral"] { background: #1e293b; }
    body[data-bg="checker"] {
      background-color: #181f2a;
      background-image: 
        linear-gradient(45deg, #111722 25%, transparent 25%),
        linear-gradient(-45deg, #111722 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #111722 75%),
        linear-gradient(-45deg, transparent 75%, #111722 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0px;
    }

    aside {
      padding: 20px;
      border-right: 1px solid var(--sk-border);
      background: var(--sk-sidebar);
      display: flex;
      flex-direction: column;
      gap: 14px;
      height: 100vh;
      overflow-y: auto;
      box-shadow: 6px 0 24px rgba(0, 0, 0, 0.4);
      z-index: 10;
    }

    .brand-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--sk-border);
    }
    .brand-title { display: flex; align-items: center; gap: 10px; }
    .brand-title img { width: 32px; height: 32px; object-fit: contain; }
    .brand-title h1 { margin: 0; font-size: 16px; font-weight: 800; color: #fff; }
    .badge-tag {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(0, 217, 255, 0.15);
      color: var(--sk-cyan);
      border: 1px solid rgba(0, 217, 255, 0.35);
      font-weight: 700;
      text-transform: uppercase;
    }
    .btn-back-app {
      color: var(--sk-muted);
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--sk-border);
      transition: all 0.2s;
    }
    .btn-back-app:hover { color: #fff; border-color: var(--sk-cyan); }

    .control-section { display: flex; flex-direction: column; gap: 6px; }
    .section-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--sk-muted);
      margin-bottom: 2px;
    }

    .btn-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(85px, 1fr));
      gap: 6px;
    }

    button.ctrl-btn {
      min-height: 34px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border);
      border-radius: 7px;
      background: var(--sk-card);
      color: #cbd5e1;
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    button.ctrl-btn:hover {
      border-color: var(--sk-cyan);
      color: #fff;
    }
    button.ctrl-btn.active {
      background: linear-gradient(135deg, var(--sk-primary), #0a3f9f);
      border-color: var(--sk-cyan);
      color: #fff;
      box-shadow: 0 0 10px rgba(0, 217, 255, 0.35);
    }
    button.ctrl-btn.btn-static {
      background: rgba(0, 217, 255, 0.12);
      border-color: var(--sk-cyan);
      color: #fff;
      font-weight: 800;
    }
    button.ctrl-btn.btn-reset {
      background: rgba(255, 64, 87, 0.15);
      border-color: rgba(255, 64, 87, 0.4);
      color: #ff8090;
    }
    button.ctrl-btn.btn-reset:hover {
      background: #ff4057;
      color: #fff;
      border-color: #ff4057;
    }

    .slider-row { display: flex; align-items: center; gap: 10px; }
    .slider-row input[type="range"] { flex: 1; accent-color: var(--sk-cyan); cursor: pointer; }
    .slider-val {
      font-size: 12px;
      font-weight: 800;
      color: var(--sk-cyan);
      min-width: 45px;
      text-align: right;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-radius: 7px;
      background: var(--sk-card);
      border: 1px solid var(--sk-border);
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }
    .toggle-row input { accent-color: var(--sk-cyan); width: 16px; height: 16px; cursor: pointer; }

    main {
      display: grid;
      place-items: center;
      padding: 24px;
      position: relative;
      overflow: hidden;
      min-height: 100vh;
    }

    .stage-glow {
      position: absolute;
      width: min(75vw, 620px);
      aspect-ratio: 1;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(0, 217, 255, 0.16) 0%, rgba(7, 86, 216, 0.08) 45%, transparent 70%);
      pointer-events: none;
      z-index: 1;
    }

    .stage-container {
      position: relative;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
    }

    .alignment-rig {
      --reference-opacity: 0.42;
      position: relative;
      display: grid;
      place-items: center;
      width: var(--skalito-size, 340px);
      height: var(--skalito-size, 340px);
      transition: width 0.2s ease, height 0.2s ease;
    }

    .reference-layer,
    .alignment-guides {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .reference-layer {
      display: none;
      z-index: 1;
      opacity: var(--reference-opacity);
      mix-blend-mode: screen;
    }

    body.show-reference .reference-layer {
      display: block;
    }

    .reference-layer img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .alignment-rig .mascot-holder {
      position: relative;
      z-index: 2;
    }

    .alignment-guides {
      display: none;
      z-index: 4;
    }

    body.show-guide .alignment-guides {
      display: block;
    }

    .alignment-guides::before,
    .alignment-guides::after {
      content: "";
      position: absolute;
      background: rgba(255, 64, 87, 0.72);
      box-shadow: 0 0 8px rgba(255, 64, 87, 0.8);
    }

    .alignment-guides::before {
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1.5px;
    }

    .alignment-guides::after {
      left: 0;
      right: 0;
      top: 50%;
      height: 1.5px;
    }

    .central-guide-line {
      position: absolute;
      top: 5%;
      bottom: 5%;
      left: 50%;
      width: 1.5px;
      background: rgba(255, 64, 87, 0.65);
      box-shadow: 0 0 8px rgba(255, 64, 87, 0.8);
      pointer-events: none;
      display: none;
      z-index: 20;
    }
    .central-guide-line::before {
      content: "EIXO CENTRAL (X: 495)";
      position: absolute;
      top: 4px;
      left: 6px;
      font-size: 10px;
      font-weight: 800;
      color: #ff8090;
      white-space: nowrap;
      background: rgba(13, 23, 38, 0.9);
      padding: 2px 6px;
      border-radius: 4px;
    }
    body.show-guide .central-guide-line {
      display: block;
    }

    .mascot-holder {
      width: var(--skalito-size, 340px);
      height: var(--skalito-size, 340px);
      transition: width 0.2s ease, height 0.2s ease;
    }

    .stage-footer {
      position: absolute;
      bottom: 16px;
      right: 20px;
      font-size: 12px;
      color: var(--sk-muted);
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(13, 23, 38, 0.85);
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--sk-border);
      backdrop-filter: blur(8px);
      z-index: 5;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #22c77a;
      box-shadow: 0 0 8px #22c77a;
    }

    @media (max-width: 860px) {
      body { grid-template-columns: 1fr; }
      aside { height: auto; border-right: 0; border-bottom: 1px solid var(--sk-border); }
      main { min-height: 60vh; }
    }
  </style>
</head>
<body>
  <aside>
    <div class="brand-header">
      <div class="brand-title">
        <img src="skalee-symbol-transparent.png" alt="Skalee">
        <div>
          <h1>Skalito SVG</h1>
          <span class="badge-tag">Anatomia & Rig</span>
        </div>
      </div>
      <a href="index.html" class="btn-back-app" title="Voltar ao Controle de Validade">← App</a>
    </div>

    <!-- MODO ANATÔMICO / ESTADOS -->
    <div class="control-section">
      <div class="section-title">Modo de Validação</div>
      <div class="btn-grid" style="grid-template-columns: 1fr 1fr;">
        <button class="ctrl-btn active btn-static" data-state="static">⏹ Estático (Puro)</button>
        <button class="ctrl-btn" data-state="idle">▶ Idle (Respiração)</button>
      </div>
      <div class="btn-grid" style="margin-top: 4px;">
        <button class="ctrl-btn" data-state="thinking">Thinking</button>
        <button class="ctrl-btn" data-state="talking">Talking</button>
        <button class="ctrl-btn" data-state="happy">Happy</button>
        <button class="ctrl-btn" data-state="alert">Alert</button>
      </div>
    </div>

    <!-- FUNDO DO PALCO -->
    <div class="control-section">
      <div class="section-title">Fundo do Palco</div>
      <div class="btn-grid">
        <button class="ctrl-btn active" data-bg-btn="dark">🌙 Escuro</button>
        <button class="ctrl-btn" data-bg-btn="light">☀ Claro</button>
        <button class="ctrl-btn" data-bg-btn="neutral">🌫 Neutro</button>
        <button class="ctrl-btn" data-bg-btn="checker">🏁 Xadrez</button>
      </div>
    </div>

    <!-- EVENTOS / AÇÕES -->
    <div class="control-section">
      <div class="section-title">Ações e Interações</div>
      <div class="btn-grid">
        <button class="ctrl-btn" data-event="blink">👁 Piscar</button>
        <button class="ctrl-btn" data-event="flapWings">🪽 Bater Asas</button>
        <button class="ctrl-btn" data-event="wave">👋 Acenar</button>
        <button class="ctrl-btn" data-event="point">👉 Apontar</button>
        <button class="ctrl-btn" data-event="celebrate">🎉 Celebrar</button>
      </div>
    </div>

    <!-- DIREÇÃO DO OLHAR -->
    <div class="control-section">
      <div class="section-title">Direção do Olhar</div>
      <div class="btn-grid">
        <button class="ctrl-btn active" data-look="center">Centro</button>
        <button class="ctrl-btn" data-look="left">Esquerda</button>
        <button class="ctrl-btn" data-look="right">Direita</button>
        <button class="ctrl-btn" data-look="up">Cima</button>
        <button class="ctrl-btn" data-look="down">Baixo</button>
      </div>
    </div>

    <!-- TAMANHO DO MASCOTE -->
    <div class="control-section">
      <div class="section-title">Tamanho do Mascote</div>
      <div class="btn-grid">
        <button class="ctrl-btn" data-preset-size="120">P (120px)</button>
        <button class="ctrl-btn" data-preset-size="220">M (220px)</button>
        <button class="ctrl-btn active" data-preset-size="340">G (340px)</button>
        <button class="ctrl-btn" data-preset-size="480">GG (480px)</button>
      </div>
      <div class="slider-row" style="margin-top: 6px;">
        <input id="sizeSlider" type="range" min="100" max="650" value="340">
        <span id="sizeVal" class="slider-val">340px</span>
      </div>
    </div>

    <!-- CONTROLES GERAIS, GUIA E DEBUG -->
    <div class="control-section" style="margin-top: auto;">
      <div class="section-title">Guias & Inspeção Anatômica</div>
      <label class="toggle-row">
        <span>Linha Guia Central (Simetria)</span>
        <input id="guideCheck" type="checkbox">
      </label>
      <label class="toggle-row" style="margin-top: 4px;">
        <span>Modo Debug Visual (Pivôs & Caixas)</span>
        <input id="debugCheck" type="checkbox">
      </label>
      <label class="toggle-row" style="margin-top: 4px;">
        <span>Sobrepor PNG Original</span>
        <input id="referenceCheck" type="checkbox" checked>
      </label>
      <div class="slider-row" style="margin-top: 6px;">
        <input id="referenceOpacitySlider" type="range" min="0" max="100" value="42">
        <span id="referenceOpacityVal" class="slider-val">42%</span>
      </div>
      <div class="btn-grid" style="margin-top: 6px;">
        <button id="btnReset" class="ctrl-btn btn-reset" style="grid-column: span 2;" title="Restaurar estado estático inicial">↺ Resetar para Estático Padrão</button>
      </div>
    </div>
  </aside>

  <main>
    <div class="stage-glow"></div>
    <div class="central-guide-line"></div>
    <div class="stage-container">
      <div id="alignmentRig" class="alignment-rig">
        <div class="reference-layer" aria-hidden="true">
          <img src="assets/skalito.jpg" alt="">
        </div>
        <div id="mascotWrapper" class="mascot-holder skalito-state-static skalito-look-center">
          ${standaloneSvg}
        </div>
        <div class="alignment-guides" aria-hidden="true"></div>
      </div>
    </div>

    <div class="stage-footer">
      <span><span class="status-dot"></span> 60 FPS GPU</span>
      <span id="currentStatus">Modo: Estático (Validação Anatômica)</span>
    </div>
  </main>

  <script>
    const wrapper = document.getElementById("mascotWrapper");
    const alignmentRig = document.getElementById("alignmentRig");
    const statusText = document.getElementById("currentStatus");
    let eventTimer = null;
    let currentState = "static";
    let currentLook = "center";
    let isPaused = false;

    function applyClasses() {
      wrapper.className = "mascot-holder";
      wrapper.classList.add("skalito-state-" + currentState);
      wrapper.classList.add("skalito-look-" + currentLook);
      if (isPaused) wrapper.classList.add("skalito-paused");
      if (document.getElementById("debugCheck").checked) wrapper.classList.add("skalito-debug-mode");
    }

    function runEvent(eventName, duration) {
      const className = "skalito-event-" + eventName;
      wrapper.classList.remove(className);
      void wrapper.offsetWidth;
      wrapper.classList.add(className);
      if (eventTimer) clearTimeout(eventTimer);
      eventTimer = setTimeout(() => wrapper.classList.remove(className), duration);
    }

    // Fundo
    document.querySelectorAll("[data-bg-btn]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-bg-btn]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.body.dataset.bg = btn.dataset.bgBtn;
      });
    });

    // Estados
    document.querySelectorAll("[data-state]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-state]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentState = btn.dataset.state;
        statusText.innerText = currentState === "static" ? "Modo: Estático (Validação Anatômica)" : "Estado: " + currentState;
        applyClasses();
      });
    });

    // Eventos
    document.querySelectorAll("[data-event]").forEach(btn => {
      btn.addEventListener("click", () => {
        const evt = btn.dataset.event;
        if (evt === "blink") runEvent("blink", 350);
        else if (evt === "flapWings") runEvent("wings", 1200);
        else if (evt === "wave") runEvent("wave", 1400);
        else if (evt === "point") runEvent("point", 1300);
        else if (evt === "celebrate") runEvent("celebrate", 950);
      });
    });

    // Olhar
    document.querySelectorAll("[data-look]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-look]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentLook = btn.dataset.look;
        applyClasses();
      });
    });

    // Tamanhos
    function setSize(sz) {
      wrapper.style.setProperty("--skalito-size", sz + "px");
      alignmentRig.style.setProperty("--skalito-size", sz + "px");
      document.getElementById("sizeSlider").value = sz;
      document.getElementById("sizeVal").innerText = sz + "px";
      document.querySelectorAll("[data-preset-size]").forEach(b => {
        b.classList.toggle("active", b.dataset.presetSize === String(sz));
      });
    }

    document.querySelectorAll("[data-preset-size]").forEach(btn => {
      btn.addEventListener("click", () => setSize(btn.dataset.presetSize));
    });

    document.getElementById("sizeSlider").addEventListener("input", (e) => setSize(e.target.value));

    // Linha Guia
    document.getElementById("guideCheck").addEventListener("change", (e) => {
      document.body.classList.toggle("show-guide", e.target.checked);
    });

    document.getElementById("referenceCheck").addEventListener("change", (e) => {
      document.body.classList.toggle("show-reference", e.target.checked);
    });

    document.getElementById("referenceOpacitySlider").addEventListener("input", (e) => {
      const pct = Number(e.target.value);
      alignmentRig.style.setProperty("--reference-opacity", String(pct / 100));
      document.getElementById("referenceOpacityVal").innerText = pct + "%";
    });

    // Reset
    document.getElementById("btnReset").addEventListener("click", () => {
      if (eventTimer) clearTimeout(eventTimer);
      currentState = "static";
      currentLook = "center";
      isPaused = false;
      document.querySelectorAll("[data-state]").forEach(b => b.classList.toggle("active", b.dataset.state === "static"));
      document.querySelectorAll("[data-look]").forEach(b => b.classList.toggle("active", b.dataset.look === "center"));
      document.getElementById("debugCheck").checked = false;
      document.getElementById("guideCheck").checked = false;
      document.getElementById("referenceCheck").checked = true;
      document.getElementById("referenceOpacitySlider").value = 42;
      document.getElementById("referenceOpacityVal").innerText = "42%";
      alignmentRig.style.setProperty("--reference-opacity", "0.42");
      document.body.classList.remove("show-guide");
      document.body.classList.add("show-reference");
      statusText.innerText = "Modo: Estático (Validação Anatômica)";
      applyClasses();
    });

    // Debug
    document.getElementById("debugCheck").addEventListener("change", applyClasses);
    document.body.classList.add("show-reference");
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, "skalito-standalone.html"), html, "utf8");
console.log("Rebuilt skalito-standalone.html with anatomy fixes!");
