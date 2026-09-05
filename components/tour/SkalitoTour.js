import { skalitoTourSteps } from "./skalitoTourSteps.js";
import { spiritMascotMarkup } from "../skalito/SkalitoMascot.js";

const SKALITO_TOUR_VERSION = 2;
const SKALITO_TOUR_STORAGE = {
  completed: "skalee_tour_concluido",
  version: "skalee_tour_versao",
  dismissedPrompt: "skalee_tour_prompt_dismissed"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class SkalitoTour {
  constructor(steps = []) {
    this.steps = steps;
    this.index = 0;
    this.active = false;
    this.isTransitioning = false;
    this.currentTarget = null;
    this.promptDismissedThisSession = false;
    this.openedSettingsByTour = false;
    this.demoTouched = false;
    this.autoBlinkInterval = null;

    this.resizeHandler = () => this.positionCurrentStep();
    this.keyHandler = (event) => this.handleKey(event);
  }

  init() {
    this.ensureDom();
    this.bindEvents();
    this.maybeShowPrompt();
  }

  ensureDom() {
    if (this.root && document.body.contains(this.root)) return;

    this.root = document.createElement("div");
    this.root.className = "skalito-tour-root";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="skalito-tour-scrim" aria-hidden="true"></div>
      <div class="skalito-tour-spotlight" aria-hidden="true"></div>
      <div class="skalito-tour-guide" role="dialog" aria-modal="true" aria-live="polite" aria-label="Tour guiado com Skalito">
        <div class="skalito-mascot-container">
          ${spiritMascotMarkup("Skalito acompanhando o tour")}
        </div>
        <div class="skalito-tour-speech" data-position="left">
          <button class="skalito-tour-close" type="button" data-tour-action="skip" aria-label="Fechar tour" title="Fechar tour">×</button>
          <p class="skalito-speech-text"></p>
          <div class="skalito-tour-meta">
            <span class="skalito-tour-progress">1 / 20</span>
          </div>
          <div class="skalito-tour-actions">
            <button class="ghost" type="button" data-tour-action="skip" title="Sair do tour">Pular</button>
            <button class="ghost" type="button" data-tour-action="back" title="Voltar etapa anterior">Voltar</button>
            <button class="primary" type="button" data-tour-action="next" title="Avançar para próxima etapa">Próximo</button>
          </div>
        </div>
      </div>
    `;

    this.prompt = document.createElement("aside");
    this.prompt.className = "skalito-tour-prompt";
    this.prompt.hidden = true;
    this.prompt.setAttribute("aria-label", "Tour guiado");
    this.prompt.innerHTML = `
      <button class="skalito-prompt-close" type="button" data-tour-prompt="dismiss" aria-label="Fechar" title="Fechar">×</button>
      <div class="skalito-prompt-copy" role="button" tabindex="0" data-tour-prompt="start" aria-label="Fazer tour">
        <strong>Conhecer?</strong>
        <p>Veja o sistema</p>
      </div>
      <div class="skalito-prompt-avatar" data-tour-prompt="start" style="cursor: pointer;">
        ${spiritMascotMarkup("Skalito")}
      </div>
    `;

    document.body.append(this.root);
    const userArea = document.querySelector("#protectedApp > header .user-area");
    const profileButton = userArea?.querySelector("#headerProfileButton");
    if (userArea && profileButton) {
      userArea.insertBefore(this.prompt, profileButton);
    } else {
      document.body.append(this.prompt);
    }

    this.guide = this.root.querySelector(".skalito-tour-guide");
    this.mascot = this.root.querySelector(".mascot");
    this.speech = this.root.querySelector(".skalito-tour-speech");
    this.speechText = this.speech.querySelector(".skalito-speech-text");
    this.progress = this.speech.querySelector(".skalito-tour-progress");
    this.spotlight = this.root.querySelector(".skalito-tour-spotlight");
    this.btnBack = this.root.querySelector('[data-tour-action="back"]');
    this.btnNext = this.root.querySelector('[data-tour-action="next"]');
  }

  bindEvents() {
    document.addEventListener("click", (event) => {
      const start = event.target.closest("[data-skalito-tour-start]") || event.target.closest("#personalTourButton");
      if (start) {
        event.preventDefault();
        event.stopPropagation();
        const personalPanel = document.getElementById("personalPanel");
        if (personalPanel && !personalPanel.hidden) {
          document.getElementById("personalClose")?.click();
          personalPanel.classList.remove("show");
          personalPanel.hidden = true;
          const overlay = document.getElementById("personalOverlay");
          if (overlay) {
            overlay.classList.remove("show");
            overlay.hidden = true;
          }
        }
        setTimeout(() => this.start(), 60);
        return;
      }

      const action = event.target.closest("[data-tour-action]")?.dataset.tourAction;
      if (action === "next") this.next();
      if (action === "back") this.back();
      if (action === "skip") this.skip();

      const promptAction = event.target.closest("[data-tour-prompt]")?.dataset.tourPrompt;
      if (promptAction === "start") this.start();
      if (promptAction === "dismiss") this.dismissPrompt();
    });

    window.addEventListener("skalee:authenticated", () => this.maybeShowPrompt());
    window.addEventListener("skalee:signed-out", () => {
      if (this.prompt) this.prompt.hidden = true;
      if (this.active) this.finish(false);
    });

    // Observa mudanças de autenticação no body
    try {
      const observer = new MutationObserver(() => {
        if (document.body.classList.contains("auth-authenticated")) {
          this.maybeShowPrompt();
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } catch (_) {}
  }

  maybeShowPrompt() {
    if (!document.getElementById("protectedApp") || this.active) return;
    if (this.promptDismissedThisSession) {
      if (this.prompt) this.prompt.hidden = true;
      return;
    }
    const userArea = document.querySelector("#protectedApp > header .user-area");
    const profileButton = userArea?.querySelector("#headerProfileButton");
    if (userArea && profileButton && this.prompt && this.prompt.parentElement !== userArea) {
      userArea.insertBefore(this.prompt, profileButton);
    }
    const checkAndShow = () => {
      if (!this.active && !this.promptDismissedThisSession && (document.body.classList.contains("auth-authenticated") || document.getElementById("protectedApp")?.getAttribute("aria-hidden") === "false")) {
        if (this.prompt) {
          this.prompt.hidden = false;
          this.triggerPromptSparkle();
        }
      }
    };
    checkAndShow();
    setTimeout(checkAndShow, 350);
  }

  dismissPrompt() {
    this.promptDismissedThisSession = true;
    if (this.prompt) this.prompt.hidden = true;
  }

  async start(startIndex = 0) {
    this.ensureDom();
    this.active = true;
    this.isTransitioning = false;
    this.index = startIndex;
    this.root.hidden = false;
    
    // Fecha o painel de configurações se estiver aberto
    const personalPanel = document.getElementById("personalPanel");
    if (personalPanel) {
      personalPanel.classList.remove("show");
      personalPanel.hidden = true;
    }
    const overlay = document.getElementById("personalOverlay");
    if (overlay) {
      overlay.classList.remove("show");
      overlay.hidden = true;
    }

    // Reseta propriedades visuais que poderiam ter sido alteradas no voo final
    if (this.guide) {
      this.guide.classList.remove("is-flying-to-logo", "is-routing");
      this.guide.style.transform = "";
      this.guide.style.filter = "";
      this.guide.style.opacity = "1";
    }
    if (this.speech) {
      this.speech.style.opacity = "1";
      this.speech.style.transform = "";
      this.speech.style.pointerEvents = "auto";
    }
    if (this.spotlight) {
      this.spotlight.style.opacity = "1";
    }

    document.body.classList.add("skalito-tour-active");
    window.removeEventListener("resize", this.resizeHandler);
    window.removeEventListener("scroll", this.resizeHandler);
    window.addEventListener("resize", this.resizeHandler, { passive: true });
    window.addEventListener("scroll", this.resizeHandler, { passive: true });
    document.removeEventListener("keydown", this.keyHandler);
    document.addEventListener("keydown", this.keyHandler);
    
    this.guide.classList.add("is-entering");
    setTimeout(() => this.guide?.classList.remove("is-entering"), 520);
    setTimeout(() => this.triggerSpiritEvent("sparkle"), 180);
    
    this.startNaturalBlinkLoop();
    await this.showStep();
  }

  startNaturalBlinkLoop() {
    if (this.autoBlinkInterval) clearInterval(this.autoBlinkInterval);
    this.autoBlinkInterval = setInterval(() => {
      if (this.active && !reducedMotion() && Math.random() > 0.25) {
        this.triggerBlink();
      }
    }, 3200);
  }

  triggerBlink() {
    if (!this.mascot) return;
    const eyes = this.mascot.querySelectorAll(".eye");
    eyes.forEach((eye) => {
      eye.classList.remove("is-blinking");
      void eye.offsetWidth;
      eye.classList.add("is-blinking");
    });
    setTimeout(() => {
      eyes.forEach((eye) => eye.classList.remove("is-blinking"));
    }, 240);
  }

  async next() {
    if (this.isTransitioning) return;
    await this.runAfter();
    if (this.index >= this.steps.length - 1) {
      this.complete();
      return;
    }
    this.index += 1;
    this.triggerBlink();
    await this.showStep();
  }

  async back() {
    if (this.isTransitioning || this.index <= 0) return;
    await this.runAfter();
    this.index -= 1;
    this.triggerBlink();
    await this.showStep();
  }

  skip() {
    this.finish(false);
  }

  complete() {
    localStorage.setItem(SKALITO_TOUR_STORAGE.completed, "true");
    localStorage.setItem(SKALITO_TOUR_STORAGE.version, String(SKALITO_TOUR_VERSION));
    localStorage.setItem(SKALITO_TOUR_STORAGE.dismissedPrompt, String(SKALITO_TOUR_VERSION));
    this.promptDismissedThisSession = true;
    if (this.prompt) this.prompt.hidden = true;
    this.flyToLogoAndDisappear();
  }

  flyToLogoAndDisappear() {
    this.clearHighlight();
    this.clearDemoRegister();
    if (this.openedSettingsByTour && !document.getElementById("personalPanel")?.hidden) {
      document.getElementById("personalClose")?.click();
    }
    this.openedSettingsByTour = false;

    // Encontra a logo no cabeçalho
    const logo = document.querySelector(".app-header-logo") || document.querySelector(".app-brand img") || document.querySelector("header img");
    const logoRect = logo ? logo.getBoundingClientRect() : { left: 24, top: 16, width: 36, height: 36 };

    const targetX = logoRect.left + logoRect.width / 2 - 65;
    const targetY = logoRect.top + logoRect.height / 2 - 94;

    this.speech.style.opacity = "0";
    this.speech.style.pointerEvents = "none";
    this.spotlight.style.opacity = "0";
    this.triggerSpiritEvent("sparkle");

    if (reducedMotion()) {
      this.finish(false);
      return;
    }

    this.guide.classList.add("is-flying-to-logo");
    this.guide.style.transform = `translate3d(${Math.round(targetX)}px, ${Math.round(targetY)}px, 0) scale(0.18) rotate(-12deg)`;
    this.guide.style.filter = "drop-shadow(0 0 25px #00d9ff) brightness(1.6)";
    this.guide.style.opacity = "0";

    setTimeout(() => {
      if (logo) {
        logo.classList.remove("logo-absorbed-sparkle");
        void logo.offsetWidth;
        logo.classList.add("logo-absorbed-sparkle");
        setTimeout(() => logo.classList.remove("logo-absorbed-sparkle"), 1000);
      }
      this.finish(false);
      this.guide.classList.remove("is-flying-to-logo");
      this.guide.style.transform = "";
      this.guide.style.filter = "";
      this.guide.style.opacity = "1";
      this.spotlight.style.opacity = "1";
      this.speech.style.pointerEvents = "auto";
    }, 1150);
  }

  finish(celebrated) {
    if (this.autoBlinkInterval) {
      clearInterval(this.autoBlinkInterval);
      this.autoBlinkInterval = null;
    }
    if (celebrated) this.triggerSpiritEvent("celebrate");
    this.clearHighlight();
    this.clearDemoRegister();
    if (this.openedSettingsByTour && !document.getElementById("personalPanel")?.hidden) {
      document.getElementById("personalClose")?.click();
    }
    this.openedSettingsByTour = false;
    this.active = false;
    document.body.classList.remove("skalito-tour-active");
    window.removeEventListener("resize", this.resizeHandler);
    window.removeEventListener("scroll", this.resizeHandler);
    document.removeEventListener("keydown", this.keyHandler);
    if (this.observer) this.observer.disconnect();
    
    setTimeout(() => {
      if (!this.active) {
        this.root.hidden = true;
        if (this.guide) {
          this.guide.classList.remove("is-flying-to-logo", "is-routing");
          this.guide.style.transform = "";
          this.guide.style.filter = "";
          this.guide.style.opacity = "1";
        }
      }
    }, celebrated ? 950 : 150);
  }

  async showStep() {
    this.isTransitioning = true;
    const step = this.steps[this.index];
    
    // Suaviza a transição
    this.speech.style.opacity = "0";
    this.speech.style.transform = "scale(0.95)";
    this.guide.classList.add("is-routing");
    
    await this.activatePage(step.page);
    await this.runBefore(step);
    
    const target = await this.waitForTarget(step.target);
    this.clearHighlight();
    this.currentTarget = target;
    
    if (this.currentTarget && this.currentTarget !== document.body) {
      this.currentTarget.classList.add("skalito-tour-highlight");
      // Scroll suave para visualização do alvo
      this.currentTarget.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
    }
    
    this.configureMascot(step);
    this.speechText.textContent = step.message;
    this.progress.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.speech.dataset.position = step.speechPosition || "left";
    this.btnBack.disabled = this.index === 0;
    this.btnNext.textContent = this.index === this.steps.length - 1 ? "Começar a usar" : "Próximo";
    
    this.positionCurrentStep();
    
    await sleep(reducedMotion() ? 50 : 280);
    this.speech.style.opacity = "1";
    this.speech.style.transform = "scale(1)";
    this.guide.classList.remove("is-routing");
    this.isTransitioning = false;
  }

  async activatePage(page) {
    if (page === "settings") {
      const activePage = document.querySelector(".page.active")?.id;
      if (activePage !== "products") {
        document.querySelector('[data-page="products"]')?.click();
      }
      if (document.getElementById("personalPanel")?.hidden) {
        this.openedSettingsByTour = true;
        document.getElementById("personalSettingsButton")?.click();
      }
      await sleep(reducedMotion() ? 50 : 250);
      return;
    }

    if (!document.getElementById("personalPanel")?.hidden) {
      document.getElementById("personalClose")?.click();
    }
    
    const tab = document.querySelector(`[data-page="${page}"]`);
    if (tab && !tab.hidden && !document.getElementById(page)?.classList.contains("active")) {
      tab.click();
      await sleep(reducedMotion() ? 50 : 250);
    }
  }

  waitForTarget(selector, timeout = 3500) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      const start = Date.now();
      const interval = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve(document.body);
        }
      }, 100);
    });
  }

  clearHighlight() {
    if (this.currentTarget && this.currentTarget !== document.body) {
      this.currentTarget.classList.remove("skalito-tour-highlight");
    }
  }

  configureMascot(step) {
    if (!this.mascot) return;
    const look = step.look || "right";
    let headX = "0px", headY = "0px", headRot = "0deg", eyesX = "0px", eyesY = "0px";
    if (look === "left") {
      headX = "-2px"; headY = "0px"; headRot = "-1.8deg"; eyesX = "-3px"; eyesY = "0px";
    } else if (look === "right") {
      headX = "2px"; headY = "0px"; headRot = "1.8deg"; eyesX = "3px"; eyesY = "0px";
    } else if (look === "up") {
      headX = "0px"; headY = "-3px"; eyesX = "0px"; eyesY = "-3px";
    } else if (look === "down") {
      headX = "0px"; headY = "3px"; eyesX = "0px"; eyesY = "3px";
    }
    this.mascot.style.setProperty("--look-head-x", headX);
    this.mascot.style.setProperty("--look-head-y", headY);
    this.mascot.style.setProperty("--look-head-rot", headRot);
    this.mascot.style.setProperty("--look-eyes-x", eyesX);
    this.mascot.style.setProperty("--look-eyes-y", eyesY);

    const state = step.action || step.mascotAnimation || "idle";
    this.mascot.classList.remove("is-active-idle", "is-active-talking", "is-active-thinking", "is-active-happy", "is-active-alert");
    if (state === "talking") this.mascot.classList.add("is-active-talking");
    else if (state === "thinking") this.mascot.classList.add("is-active-thinking");
    else if (state === "happy") this.mascot.classList.add("is-active-happy");
    else if (state === "alert") this.mascot.classList.add("is-active-alert");
    else this.mascot.classList.add("is-active-idle");
  }

  positionCurrentStep() {
    if (!this.currentTarget || !this.active) return;
    const step = this.steps[this.index];
    const rect = this.currentTarget.getBoundingClientRect();
    
    // Atualiza o spotlight
    if (this.currentTarget === document.body) {
      this.spotlight.style.opacity = "0";
    } else {
      this.spotlight.style.opacity = "1";
      this.spotlight.style.left = `${Math.max(0, rect.left - 6)}px`;
      this.spotlight.style.top = `${Math.max(0, rect.top - 6)}px`;
      this.spotlight.style.width = `${rect.width + 12}px`;
      this.spotlight.style.height = `${rect.height + 12}px`;
    }

    const estimatedWidth = 140;
    const estimatedHeight = 200;
    const speechWidth = window.innerWidth <= 480 ? window.innerWidth - 32 : 360;
    const totalGuideWidth = estimatedWidth + speechWidth + 20;

    const position = step.mascotPosition || "bottom-right";
    let x = rect.right + 16;
    let y = rect.bottom - estimatedHeight + 10;

    if (position === "top-right") {
      x = rect.right + 16;
      y = rect.top - 20;
    } else if (position === "top-left") {
      x = rect.left - totalGuideWidth - 16;
      y = rect.top - 20;
    } else if (position === "bottom-left") {
      x = rect.left - totalGuideWidth - 16;
      y = rect.bottom - estimatedHeight + 10;
    } else if (position === "center") {
      x = (window.innerWidth - totalGuideWidth) / 2;
      y = (window.innerHeight - estimatedHeight) / 2;
    }

    // Bounds check
    x = Math.max(12, Math.min(x, window.innerWidth - totalGuideWidth - 12));
    y = Math.max(12, Math.min(y, window.innerHeight - estimatedHeight - 24));

    if (window.innerWidth <= 768) {
      x = 12;
      y = Math.min(rect.bottom + 16, window.innerHeight - 280);
      if (y < 80) y = 80;
    }

    this.guide.style.setProperty("--skalito-tour-x", `${Math.round(x)}px`);
    this.guide.style.setProperty("--skalito-tour-y", `${Math.round(y)}px`);
  }

  triggerSpiritEvent(action = "idle") {
    if (!this.mascot) return;
    this.mascot.classList.remove("is-sparkling", "is-waving", "is-celebrating", "is-flapping", "is-pointing");
    void this.mascot.offsetWidth;

    if (action === "sparkle") this.mascot.classList.add("is-sparkling");
    if (action === "wave") this.mascot.classList.add("is-waving");
    if (action === "celebrate") this.mascot.classList.add("is-celebrating");
    if (action === "flap" || action === "wings") this.mascot.classList.add("is-flapping");
    if (action === "point") this.mascot.classList.add("is-pointing");
    if (action === "blink") this.triggerBlink();

    setTimeout(() => {
      this.mascot?.classList.remove("is-sparkling", "is-waving", "is-celebrating", "is-flapping", "is-pointing");
    }, 1400);
  }

  triggerPromptSparkle() {
    const avatar = this.prompt?.querySelector(".mascot");
    if (!avatar) return;
    avatar.classList.add("is-sparkling");
    setTimeout(() => avatar.classList.remove("is-sparkling"), 1200);
  }

  async runBefore(step) {
    if (step.id === "register-form") {
      this.mockRegisterForm();
    }
  }

  async runAfter() {
    const step = this.steps[this.index];
    if (step?.id === "register-form") {
      this.clearDemoRegister();
    }
  }

  mockRegisterForm() {
    const barcode = document.getElementById("barcode");
    const qty = document.getElementById("qty");
    const expiry = document.getElementById("expiry");
    const found = document.getElementById("found");
    if (barcode) barcode.value = "7891000100103";
    if (qty) qty.value = "24";
    if (found) {
      found.innerHTML = `<strong>Produto de Exemplo:</strong> Leite Integral 1L (Demonstração do Skalito)`;
      found.classList.add("show", "skalito-tour-demo-found");
    }
    if (expiry) {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      expiry.value = date.toISOString().slice(0, 10);
    }
    this.demoTouched = true;
  }

  clearDemoRegister() {
    if (!this.demoTouched) return;
    ["barcode", "qty", "expiry", "photo"].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = "";
    });
    const found = document.getElementById("found");
    if (found?.classList.contains("skalito-tour-demo-found")) {
      found.classList.remove("show", "skalito-tour-demo-found");
      found.innerHTML = "";
    }
    const preview = document.getElementById("preview");
    if (preview) preview.textContent = "Sem foto";
    const offer = document.getElementById("offer");
    if (offer) offer.checked = false;
    this.demoTouched = false;
  }

  handleKey(event) {
    if (!this.active) return;
    if (event.key === "Escape") this.skip();
    if (event.key === "ArrowRight") this.next();
    if (event.key === "ArrowLeft") this.back();
  }
}

// Inicialização automática e exportação global
if (typeof window !== "undefined") {
  const initTour = () => {
    if (!window.skaleeSkalitoTour) {
      window.skaleeSkalitoTour = new SkalitoTour(skalitoTourSteps);
      window.skaleeSkalitoTour.init();
    }
  };

  window.startSkalitoTour = () => {
    if (!window.skaleeSkalitoTour) initTour();
    window.skaleeSkalitoTour.start();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTour);
  } else {
    initTour();
  }
}
