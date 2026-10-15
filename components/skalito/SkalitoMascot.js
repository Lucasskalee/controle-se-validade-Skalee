/**
 * SkalitoMascot - Web Component para o Mascote Oficial Cyber Spirit / Chama Skalito
 * Suporta animações GPU a 60 FPS, estados (idle, talking, thinking, happy, alert, static),
 * eventos (wave, blink, wings, point, celebrate), direção do olhar (lookAt) e calibração precisa.
 */

const VALID_STATES = new Set(["static", "idle", "thinking", "talking", "happy", "alert"]);
const VALID_LOOKS = new Set(["center", "left", "right", "up", "down"]);
const TEMPORARY_EVENTS = new Set(["wave", "blink", "wings", "point", "celebrate"]);

const DEFAULT_STATE = "idle";
const DEFAULT_LOOK = "center";
const DEFAULT_SIZE = 340;

const moduleUrl = new URL(import.meta.url);
const rootUrl = new URL("../../", moduleUrl);
const assetUrl = (file) => new URL(`assets/mascot/${file}`, rootUrl).href;

const ASSET_PATHS = {
  wingLeft: assetUrl("left-wing.png"),
  wingRight: assetUrl("right-wing.png"),
  body: assetUrl("body.png"),
  armLeft: assetUrl("left-arm.png"),
  armRight: assetUrl("right-arm.png"),
  head: assetUrl("head.png"),
  eyeLeft: assetUrl("eyes-neutral-left.png"),
  eyeRight: assetUrl("eyes-neutral-right.png"),
  eyeBlinkLeft: assetUrl("eyes-blink-left.png"),
  eyeBlinkRight: assetUrl("eyes-blink-right.png"),
  eyeAlertLeft: assetUrl("eyes-alert-left.png"),
  eyeAlertRight: assetUrl("eyes-alert-right.png")
};

const PARTS = [
  {
    id: "wing-left",
    className: "piece-wing-left",
    part: "left-wing",
    label: "Asa Esquerda",
    asset: ASSET_PATHS.wingLeft,
    x: 3,
    y: 362,
    width: 172,
    height: 170,
    pivot: { x: 162, y: 388 }
  },
  {
    id: "wing-right",
    className: "piece-wing-right",
    part: "right-wing",
    label: "Asa Direita",
    asset: ASSET_PATHS.wingRight,
    x: 325,
    y: 362,
    width: 172,
    height: 170,
    pivot: { x: 338, y: 388 }
  },
  {
    id: "body",
    className: "piece-body",
    part: "torso-tail",
    label: "Corpo e Cauda",
    asset: ASSET_PATHS.body,
    // Production header: 251×327 body at 0.9 scale, relative to a 288px head.
    // Map its proportions and neck placement to this rig's 284px head.
    x: 138.62,
    y: 387.11,
    width: 222.76,
    height: 290.21,
    pivot: { x: 250, y: 460 }
  },
  {
    id: "arm-left",
    className: "piece-arm-left",
    part: "left-arm",
    label: "Braço Esquerdo",
    asset: ASSET_PATHS.armLeft,
    x: 112,
    y: 375,
    width: 98,
    height: 128,
    pivot: { x: 180, y: 390 }
  },
  {
    id: "arm-right",
    className: "piece-arm-right",
    part: "right-arm",
    label: "Braço Direito",
    asset: ASSET_PATHS.armRight,
    x: 290,
    y: 375,
    width: 98,
    height: 128,
    pivot: { x: 320, y: 390 }
  },
  {
    id: "head",
    className: "piece-head",
    part: "head",
    label: "Cabeça Chama",
    asset: ASSET_PATHS.head,
    x: 108,
    y: 15,
    width: 284,
    height: 422,
    pivot: { x: 250, y: 370 }
  },
  {
    id: "eye-left",
    className: "piece-eye-left",
    part: "left-eye",
    label: "Olho Esquerdo",
    asset: ASSET_PATHS.eyeLeft,
    x: 154,
    y: 242,
    width: 72,
    height: 98,
    pivot: { x: 190, y: 291 }
  },
  {
    id: "eye-right",
    className: "piece-eye-right",
    part: "right-eye",
    label: "Olho Direito",
    asset: ASSET_PATHS.eyeRight,
    x: 274,
    y: 240,
    width: 72,
    height: 98,
    pivot: { x: 310, y: 289 }
  }
];

export class SkalitoMascot extends HTMLElement {
  static get observedAttributes() {
    return ["state", "look", "size", "debug", "paused", "label"];
  }

  constructor() {
    super();
    this._state = DEFAULT_STATE;
    this._look = DEFAULT_LOOK;
    this._size = DEFAULT_SIZE;
    this._debug = false;
    this._paused = false;
    this._activeTimers = new Set();
    this._autoBlinkTimer = null;
  }

  connectedCallback() {
    if (!this.querySelector(".skalito-container")) {
      this.render();
    }
    this.syncAll();
    this.startNaturalBlinkLoop();
  }

  disconnectedCallback() {
    this.clearAllTimers();
    if (this._autoBlinkTimer) {
      clearInterval(this._autoBlinkTimer);
      this._autoBlinkTimer = null;
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "state") this.setState(newValue || DEFAULT_STATE);
    if (name === "look") this.lookAt(newValue || DEFAULT_LOOK);
    if (name === "size") this.setSize(newValue || DEFAULT_SIZE);
    if (name === "debug") this.setDebug(newValue !== null && newValue !== "false");
    if (name === "paused") this.setPaused(newValue !== null && newValue !== "false");
  }

  get state() { return this._state; }
  set state(value) { this.setState(value); }

  get look() { return this._look; }
  set look(value) { this.lookAt(value); }

  get size() { return this._size; }
  set size(value) { this.setSize(value); }

  get debug() { return this._debug; }
  set debug(value) { this.setDebug(value); }

  get paused() { return this._paused; }
  set paused(value) { this.setPaused(value); }

  setState(nextState) {
    const s = String(nextState || "").toLowerCase();
    const resolved = VALID_STATES.has(s) ? s : DEFAULT_STATE;
    this._state = resolved;
    if (this.getAttribute("state") !== resolved) {
      this.setAttribute("state", resolved);
    }
    this.dataset.state = resolved;
    this.classList.remove(
      "skalito-state-static",
      "skalito-state-idle",
      "skalito-state-thinking",
      "skalito-state-talking",
      "skalito-state-happy",
      "skalito-state-alert"
    );
    this.classList.add(`skalito-state-${resolved}`);

    // Expressão dos olhos conforme estado
    const leftEye = this.querySelector("#eye-left image");
    const rightEye = this.querySelector("#eye-right image");
    if (leftEye && rightEye) {
      if (resolved === "alert") {
        leftEye.setAttribute("href", ASSET_PATHS.eyeAlertLeft);
        rightEye.setAttribute("href", ASSET_PATHS.eyeAlertRight);
      } else {
        leftEye.setAttribute("href", ASSET_PATHS.eyeLeft);
        rightEye.setAttribute("href", ASSET_PATHS.eyeRight);
      }
    }
  }

  lookAt(direction) {
    const d = String(direction || "").toLowerCase();
    const resolved = VALID_LOOKS.has(d) ? d : DEFAULT_LOOK;
    this._look = resolved;
    if (this.getAttribute("look") !== resolved) {
      this.setAttribute("look", resolved);
    }
    this.dataset.look = resolved;
    this.classList.remove(
      "skalito-look-center",
      "skalito-look-left",
      "skalito-look-right",
      "skalito-look-up",
      "skalito-look-down"
    );
    this.classList.add(`skalito-look-${resolved}`);
  }

  setSize(sizeValue) {
    const num = Number(sizeValue);
    const validNum = Number.isFinite(num) && num > 0 ? num : DEFAULT_SIZE;
    this._size = validNum;
    this.style.setProperty("--skalito-size", `${validNum}px`);
  }

  setDebug(isDebug) {
    this._debug = Boolean(isDebug);
    this.classList.toggle("skalito-debug-mode", this._debug);
  }

  setPaused(isPaused) {
    this._paused = Boolean(isPaused);
    this.classList.toggle("skalito-paused", this._paused);
  }

  // Eventos de Ação
  triggerEvent(eventName, durationMs = 1200) {
    if (this._paused) return;
    const evtClass = `skalito-event-${eventName}`;
    this.classList.add(evtClass);
    const timer = setTimeout(() => {
      this.classList.remove(evtClass);
      this._activeTimers.delete(timer);
    }, durationMs);
    this._activeTimers.add(timer);
  }

  wave() {
    this.triggerEvent("wave", 1400);
  }

  blink() {
    const leftEye = this.querySelector("#eye-left image");
    const rightEye = this.querySelector("#eye-right image");
    if (leftEye && rightEye) {
      leftEye.setAttribute("href", ASSET_PATHS.eyeBlinkLeft);
      rightEye.setAttribute("href", ASSET_PATHS.eyeBlinkRight);
      setTimeout(() => {
        if (this._state === "alert") {
          leftEye.setAttribute("href", ASSET_PATHS.eyeAlertLeft);
          rightEye.setAttribute("href", ASSET_PATHS.eyeAlertRight);
        } else {
          leftEye.setAttribute("href", ASSET_PATHS.eyeLeft);
          rightEye.setAttribute("href", ASSET_PATHS.eyeRight);
        }
      }, 220);
    }
    this.triggerEvent("blink", 450);
  }

  flapWings() {
    this.triggerEvent("wings", 1100);
  }

  point() {
    this.triggerEvent("point", 1600);
  }

  celebrate() {
    this.triggerEvent("celebrate", 2200);
  }

  reset() {
    this.clearAllTimers();
    TEMPORARY_EVENTS.forEach((evt) => this.classList.remove(`skalito-event-${evt}`));
    this.setState(DEFAULT_STATE);
    this.lookAt(DEFAULT_LOOK);
    this.setSize(DEFAULT_SIZE);
  }

  clearAllTimers() {
    this._activeTimers.forEach((timer) => clearTimeout(timer));
    this._activeTimers.clear();
  }

  startNaturalBlinkLoop() {
    if (this._autoBlinkTimer) clearInterval(this._autoBlinkTimer);
    this._autoBlinkTimer = setInterval(() => {
      if (!this._paused && this._state !== "static" && Math.random() > 0.3) {
        this.blink();
      }
    }, 4500);
  }

  syncAll() {
    this.setState(this.getAttribute("state") || this._state);
    this.lookAt(this.getAttribute("look") || this._look);
    this.setSize(this.getAttribute("size") || this._size);
    this.setDebug(this.hasAttribute("debug") ? this.getAttribute("debug") !== "false" : this._debug);
    this.setPaused(this.hasAttribute("paused") ? this.getAttribute("paused") !== "false" : this._paused);
  }

  render() {
    const partsMarkup = PARTS.map((part) => `
      <g id="${part.id}"
         class="skalito-piece ${part.className}"
         data-part="${part.part}"
         data-pivot-x="${part.pivot.x}"
         data-pivot-y="${part.pivot.y}"
         style="transform-origin: ${part.pivot.x}px ${part.pivot.y}px;">
        <image href="${part.asset}"
               x="${part.x}"
               y="${part.y}"
               width="${part.width}"
               height="${part.height}"
               preserveAspectRatio="xMidYMid meet" />
        <circle class="skalito-pivot-marker"
                cx="${part.pivot.x}"
                cy="${part.pivot.y}"
                r="4"
                fill="#ff4057"
                stroke="#ffffff"
                stroke-width="1.5" />
      </g>
    `).join("");

    this.innerHTML = `
      <div class="skalito-container" role="img" aria-label="${this.getAttribute("label") || "Skalito Mascote Oficial"}">
        <svg xmlns="http://www.w3.org/2000/svg"
             viewBox="0 0 500 720"
             class="skalito-svg-root"
             width="100%"
             height="100%">
          <defs>
            <filter id="skalito-glow-${Math.random().toString(36).slice(2, 7)}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#00d9ff" flood-opacity="0.35"/>
            </filter>
          </defs>
          <g id="skalito" class="skalito-root" style="transform-origin: 250px 420px;">
            ${partsMarkup}
          </g>
        </svg>
      </div>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("skalito-mascot")) {
  customElements.define("skalito-mascot", SkalitoMascot);
  customElements.define("skalito-animated", class extends SkalitoMascot {});
}

export function spiritMascotMarkup(label = "Skalito") {
  return `
    <div class="mascot is-floating skalito-tour-mascot" role="img" aria-label="${label}">
      <div class="mascot-float-container">
        <!-- Kinetic Energy Aura (Faíscas Luminosas Cinéticas) -->
        <div class="kinetic-energy-aura" aria-hidden="true">
          <span class="kinetic-spark" style="--spark-x: 18%; --spark-y: 52%; --spark-size: 5px; --spark-drift-x: -22px; --spark-drift-y: -36px; --spark-delay: 0s; --spark-duration: 2.8s; --spark-color: #00f0ff;"></span>
          <span class="kinetic-spark" style="--spark-x: 82%; --spark-y: 48%; --spark-size: 6px; --spark-drift-x: 24px; --spark-drift-y: -40px; --spark-delay: 0.7s; --spark-duration: 3.1s; --spark-color: #00d9ff;"></span>
          <span class="kinetic-spark" style="--spark-x: 48%; --spark-y: 82%; --spark-size: 4px; --spark-drift-x: -12px; --spark-drift-y: -48px; --spark-delay: 1.3s; --spark-duration: 2.6s; --spark-color: #0088ff;"></span>
          <span class="kinetic-spark" style="--spark-x: 54%; --spark-y: 75%; --spark-size: 5px; --spark-drift-x: 16px; --spark-drift-y: -44px; --spark-delay: 1.9s; --spark-duration: 3.3s; --spark-color: #b44aff;"></span>
          <span class="kinetic-spark" style="--spark-x: 26%; --spark-y: 35%; --spark-size: 4px; --spark-drift-x: -18px; --spark-drift-y: -32px; --spark-delay: 0.4s; --spark-duration: 2.9s; --spark-color: #00f0ff;"></span>
          <span class="kinetic-spark" style="--spark-x: 74%; --spark-y: 32%; --spark-size: 5px; --spark-drift-x: 20px; --spark-drift-y: -34px; --spark-delay: 2.2s; --spark-duration: 3.0s; --spark-color: #00e5ff;"></span>
          <span class="kinetic-spark" style="--spark-x: 50%; --spark-y: 92%; --spark-size: 7px; --spark-drift-x: 8px; --spark-drift-y: -52px; --spark-delay: 2.7s; --spark-duration: 3.4s; --spark-color: #00ffff;"></span>
          <span class="kinetic-spark" style="--spark-x: 35%; --spark-y: 65%; --spark-size: 3.5px; --spark-drift-x: -14px; --spark-drift-y: -28px; --spark-delay: 1.0s; --spark-duration: 2.5s; --spark-color: #7b61ff;"></span>
        </div>
        <!-- Layer 1: Holographic Wings (Behind Body) -->
        <div class="mascot-part part-wing-left" data-part="leftWing" style="left: -63px; top: 339px; transform-origin: 91.4% 10.9%; transform: scale(0.75) rotate(24deg);">
          <div class="anim-wrapper anim-wing-left">
            <img class="wing wing-left" src="${ASSET_PATHS.wingLeft}" alt="" aria-hidden="true">
          </div>
        </div>
        <div class="mascot-part part-wing-right" data-part="rightWing" style="left: 268px; top: 331px; transform-origin: 8.2% 10.9%; transform: scale(0.75) rotate(-24deg);">
          <div class="anim-wrapper anim-wing-right">
            <img class="wing wing-right" src="${ASSET_PATHS.wingRight}" alt="" aria-hidden="true">
          </div>
        </div>

        <!-- Layer 2: Arms (Behind Body) -->
        <div class="mascot-part part-arm-left" data-part="leftArm" style="left: 72px; top: 351px; transform-origin: 79.4% 9.6%; transform: scale(0.75) rotate(0deg);">
          <div class="anim-wrapper anim-arm-left">
            <img class="arm arm-left" src="${ASSET_PATHS.armLeft}" alt="" aria-hidden="true">
          </div>
        </div>
        <div class="mascot-part part-arm-right" data-part="rightArm" style="left: 237px; top: 350px; transform-origin: 19.5% 9.6%; transform: scale(0.75) rotate(0deg);">
          <div class="anim-wrapper anim-arm-right">
            <img class="arm arm-right" src="${ASSET_PATHS.armRight}" alt="" aria-hidden="true">
          </div>
        </div>

        <!-- Layer 3: Main Torso & Ghost Tail -->
        <div class="mascot-part part-body" data-part="body" style="left: 87px; top: 316px; transform-origin: 50% 50%; transform: scale(0.9) rotate(0deg);">
          <div class="anim-wrapper anim-body">
            <img class="body" src="${ASSET_PATHS.body}" alt="" aria-hidden="true">
          </div>
        </div>

        <!-- Layer 4: Flame Head -->
        <div class="mascot-part part-head" data-part="head" style="left: 66px; top: -45px; transform-origin: 50% 90%; transform: scale(1.0) rotate(-1deg);">
          <div class="anim-wrapper anim-head">
            <img class="head" src="${ASSET_PATHS.head}" alt="" aria-hidden="true">
          </div>
        </div>

        <!-- Layer 5: Luminescent Eyes -->
        <div class="mascot-part part-eye-left" data-part="leftEye" style="left: 111px; top: 223px; transform-origin: 50% 50%; transform: scale(1.0) rotate(-20deg);">
          <div class="anim-wrapper anim-eye-left anim-eye">
            <img class="eye eye-left" src="${ASSET_PATHS.eyeLeft}" alt="" aria-hidden="true">
          </div>
        </div>
        <div class="mascot-part part-eye-right" data-part="rightEye" style="left: 222px; top: 221px; transform-origin: 50% 50%; transform: scale(1.04) rotate(11deg);">
          <div class="anim-wrapper anim-eye-right anim-eye">
            <img class="eye eye-right" src="${ASSET_PATHS.eyeRight}" alt="" aria-hidden="true">
          </div>
        </div>
      </div>
    </div>
  `;
}
