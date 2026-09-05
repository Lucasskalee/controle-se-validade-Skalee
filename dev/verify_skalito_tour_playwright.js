const { chromium } = require("playwright");

async function prepare(page) {
  await page.goto("http://localhost:3334/index.html", { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.skaleeSkalitoTour), null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    document.body.classList.remove("auth-loading", "auth-anonymous");
    document.body.classList.add("auth-authenticated");
    const authScreen = document.getElementById("authScreen");
    if (authScreen) authScreen.style.display = "none";
    const protectedApp = document.getElementById("protectedApp");
    if (protectedApp) protectedApp.style.display = "block";
    document.getElementById("protectedApp")?.setAttribute("aria-hidden", "false");
    document.getElementById("reportTab")?.removeAttribute("hidden");
    document.querySelector('[data-page="register"]')?.removeAttribute("hidden");
    localStorage.removeItem("skalee_tour_concluido");
    localStorage.removeItem("skalee_tour_version");
    localStorage.removeItem("skalee_tour_prompt_dismissed");
    localStorage.removeItem("skalee_tour_prompt_dispensado");
    window.dispatchEvent(new Event("skalee:authenticated"));
  });
  await page.waitForSelector(".skalito-tour-prompt:not([hidden])", { state: "visible" });
}

async function startPromptTour(page) {
  const isMobile = page.viewportSize()?.width <= 620;
  if (isMobile) {
    await page.locator('[data-tour-prompt="expand"]').click();
    await page.waitForSelector(".skalito-tour-prompt.is-expanded [data-tour-prompt=\"start\"]", { state: "visible" });
  }
  await page.locator('[data-tour-prompt="start"]').click({ force: true });
}

async function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function next(page, count) {
  for (let i = 0; i < count; i += 1) {
    await page.locator('[data-tour-action="next"]').click();
    await page.waitForTimeout(720);
  }
}

async function run() {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await prepare(page);
  await startPromptTour(page);
  await page.waitForSelector(".skalito-tour-root:not([hidden])");
  await expect(await page.locator(".skalito-tour-root .skalito-spirit").isVisible(), "Skalito not visible");
  await expect((await page.locator(".skalito-speech-text").innerText()).includes("Dashboard"), "Dashboard step did not start");

  await next(page, 7);
  await expect((await page.locator("#report").getAttribute("class")).includes("active"), "Report page not active");
  await expect((await page.locator(".skalito-speech-text").innerText()).includes("Relatórios"), "Report message missing");

  await next(page, 7);
  await expect((await page.locator("#register").getAttribute("class")).includes("active"), "Register page not active");
  await expect(await page.locator("#barcode").inputValue() === "7891000000016", "Demo barcode not filled");

  await next(page, 7);
  await page.waitForSelector("#personalPanel:not([hidden])");
  await expect((await page.locator(".skalito-speech-text").innerText()).includes("Configurações"), "Settings message missing");
  await page.screenshot({ path: "dev/skalito-tour-desktop.png", fullPage: true });

  for (let i = 0; i < 8 && await page.locator(".skalito-tour-root").isVisible(); i += 1) {
    await page.locator('[data-tour-action="next"]').click();
    await page.waitForTimeout(90);
  }
  await expect(await page.evaluate(() => localStorage.getItem("skalee_tour_concluido")) === "true", "Tour completion was not persisted");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await prepare(mobile);
  await startPromptTour(mobile);
  await mobile.waitForSelector(".skalito-tour-root:not([hidden])");
  await mobile.waitForFunction(() => {
    const text = document.querySelector(".skalito-speech-text")?.textContent || "";
    const speech = document.querySelector(".skalito-tour-speech");
    return text.includes("Dashboard") && speech && getComputedStyle(speech).opacity === "1";
  });
  const box = await mobile.locator(".skalito-tour-speech").boundingBox();
  await expect(box.x >= 0 && box.x + box.width <= 390, "Mobile speech is outside the viewport");
  await mobile.screenshot({ path: "dev/skalito-tour-mobile.png", fullPage: true });

  await browser.close();
  const relevantErrors = errors.filter((text) => !text.includes("Failed to load resource"));
  const unexpectedErrors = relevantErrors.filter((text) => !text.includes("Auth session missing"));
  if (unexpectedErrors.length) throw new Error(`Console errors: ${unexpectedErrors.join(" | ")}`);
  console.log("Skalito tour verified on desktop and mobile.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
