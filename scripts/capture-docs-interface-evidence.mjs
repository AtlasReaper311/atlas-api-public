import fs from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox } from "playwright";

const base = process.env.PREVIEW_URL;
if (!base) throw new Error("PREVIEW_URL is required");

const viewports = [
  ["320", { width: 320, height: 760 }],
  ["375", { width: 375, height: 812 }],
  ["768", { width: 768, height: 900 }],
  ["1024", { width: 1024, height: 900 }],
  ["1440", { width: 1440, height: 1000 }],
];
const browsers = [
  ["chrome", () => chromium.launch({ channel: "chrome", headless: true })],
  ["firefox", () => firefox.launch({ headless: true })],
];
const expectedRoutes = ["Work", "Writing", "Lab", "Systems", "About"];
const report = [];
const failures = [];

function summarizeViolation(item) {
  return {
    id: item.id,
    impact: item.impact,
    help: item.help,
    nodes: item.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  };
}

function writeReport() {
  fs.writeFileSync(
    "evidence.json",
    `${JSON.stringify({
      preview: base,
      commit: process.env.HEAD_SHA,
      fixture: "deterministic-unavailable",
      browsers: browsers.map(([name]) => name),
      viewports: viewports.map(([name]) => Number(name)),
      routes: report,
      failures,
    }, null, 2)}\n`,
  );
}

async function configureContext(context) {
  await context.addInitScript(() => {
    Object.defineProperty(window, "__ATLAS_EVIDENCE_MODE__", {
      value: "deterministic-unavailable",
      configurable: false,
      writable: false,
    });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin && ["/v1/stats", "/v1/search"].includes(url.pathname)) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ error: "deterministic preview fixture" }),
      });
      return;
    }
    await route.continue();
  });
}

async function openWithRetry(page) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await page.goto(new URL("/v1/docs", base).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "no response"}`);
      await page.waitForSelector(".api-global-header", { timeout: 15_000 });
      await page.waitForSelector("[data-estate-status][data-state='unknown']", { timeout: 15_000 });
      await page.evaluate(() => document.fonts?.ready || Promise.resolve());
      await page.waitForTimeout(500);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(attempt * 1_000);
    }
  }
  throw lastError;
}

async function inspectPage(page) {
  return page.evaluate(async () => {
    function selectorFor(element) {
      if (!element || element === document.documentElement) return "html";
      if (element.id) return `#${CSS.escape(element.id)}`;
      const classes = [...element.classList]
        .slice(0, 3)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      return `${element.tagName.toLowerCase()}${classes}`;
    }

    const width = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const overflow = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: selectorFor(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.left < -1 || item.right > width + 1)
      .sort((a, b) => b.width - a.width)
      .slice(0, 12);

    const bottomNav = document.querySelector(".api-bottom-nav");
    const bottomNavVisible = getComputedStyle(bottomNav).display !== "none";
    const bottomNavHeight = bottomNavVisible ? bottomNav.getBoundingClientRect().height : 0;
    const bodyPaddingBottom = Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const search = document.querySelector(".search-trigger");
    const focusStyle = getComputedStyle(search);
    const spec = await fetch("/v1/openapi.json").then((response) => response.json());
    const expectedEndpointCount = Object.entries(spec.paths)
      .flatMap(([path, item]) => ["get", "post", "put", "patch", "delete"]
        .filter((method) => item[method] && path !== "/v1" && path !== "/v1/docs"))
      .length;

    return {
      title: document.title,
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      fixtureMode: window.__ATLAS_EVIDENCE_MODE__ || null,
      width,
      scrollWidth,
      overflow,
      h1Count: document.querySelectorAll("h1").length,
      mainCount: document.querySelectorAll("main").length,
      primaryNavCount: document.querySelectorAll('nav[aria-label="Primary navigation"]').length,
      mobileNavCount: document.querySelectorAll('nav[aria-label="Mobile navigation"]').length,
      routes: [...document.querySelectorAll(".atlas-global-header__nav a")]
        .map((link) => link.textContent.trim()),
      productStrip: Boolean(document.querySelector(".api-product-strip")),
      aggregateState: document.querySelector("[data-estate-status]")?.dataset.state || null,
      aggregateLabel: document.querySelector("[data-estate-status-label]")?.textContent.trim() || null,
      bottomNavVisible,
      bottomNavHeight,
      bodyPaddingBottom,
      bottomRoutes: [...bottomNav.querySelectorAll("a")].map((link) => link.textContent.trim()),
      searchHeight: Math.round(search.getBoundingClientRect().height),
      searchFocused: document.activeElement === search,
      focusOutline: {
        style: focusStyle.outlineStyle,
        width: focusStyle.outlineWidth,
      },
      bodyFont: Number.parseFloat(getComputedStyle(document.body).fontSize),
      supportingFont: Number.parseFloat(getComputedStyle(document.querySelector(".endpoint p")).fontSize),
      metadataFont: Number.parseFloat(getComputedStyle(document.querySelector(".api-product-strip")).fontSize),
      endpointCount: document.querySelectorAll(".endpoint").length,
      expectedEndpointCount,
      interfaceStylesheet: document.querySelector('link[href="/v1/docs/assets/interface-kit.css"]')?.href || null,
    };
  });
}

function semanticFailures(evidence, browserName, viewportName) {
  const prefix = `${browserName}/${viewportName}/docs`;
  const values = [];
  if (evidence.title !== "Public API // Atlas Systems") values.push(`${prefix}: incorrect title`);
  if (evidence.canonical !== "https://api.atlas-systems.uk/v1/docs") values.push(`${prefix}: incorrect canonical URL`);
  if (evidence.fixtureMode !== "deterministic-unavailable") values.push(`${prefix}: deterministic fixture mode is missing`);
  if (evidence.h1Count !== 1) values.push(`${prefix}: expected one h1, found ${evidence.h1Count}`);
  if (evidence.mainCount !== 1) values.push(`${prefix}: expected one main, found ${evidence.mainCount}`);
  if (evidence.primaryNavCount !== 1) values.push(`${prefix}: expected one primary navigation`);
  if (evidence.mobileNavCount !== 1) values.push(`${prefix}: expected one mobile navigation`);
  if (JSON.stringify(evidence.routes) !== JSON.stringify(expectedRoutes)) values.push(`${prefix}: desktop route order drifted`);
  if (JSON.stringify(evidence.bottomRoutes) !== JSON.stringify(expectedRoutes)) values.push(`${prefix}: mobile route order drifted`);
  if (!evidence.productStrip) values.push(`${prefix}: Public API product identity is missing`);
  if (evidence.aggregateState !== "unknown" || evidence.aggregateLabel !== "Unknown") {
    values.push(`${prefix}: unavailable fixture did not fail closed to Unknown`);
  }
  if (evidence.endpointCount !== evidence.expectedEndpointCount) {
    values.push(`${prefix}: docs endpoint count ${evidence.endpointCount} differs from OpenAPI ${evidence.expectedEndpointCount}`);
  }
  if (!evidence.interfaceStylesheet?.endsWith("/v1/docs/assets/interface-kit.css")) {
    values.push(`${prefix}: repository-local interface stylesheet is missing`);
  }
  if (evidence.scrollWidth > evidence.width + 1) {
    values.push(`${prefix}: horizontal overflow ${evidence.scrollWidth} > ${evidence.width}; ${JSON.stringify(evidence.overflow)}`);
  }
  const mobileExpected = Number(viewportName) < 768;
  if (mobileExpected !== evidence.bottomNavVisible) values.push(`${prefix}: bottom navigation visibility is incorrect`);
  if (mobileExpected && evidence.bodyPaddingBottom + 1 < evidence.bottomNavHeight) {
    values.push(`${prefix}: bottom navigation can obscure content or focus`);
  }
  if (mobileExpected && evidence.searchHeight < 44) values.push(`${prefix}: search touch target is under 44px`);
  if (!evidence.searchFocused) values.push(`${prefix}: keyboard Tab did not reach estate search`);
  if (evidence.focusOutline.style !== "solid" || Number.parseFloat(evidence.focusOutline.width) < 2) {
    values.push(`${prefix}: visible focus is missing`);
  }
  if (evidence.bodyFont < 15) values.push(`${prefix}: body copy is below 15px`);
  if (evidence.supportingFont < 13) values.push(`${prefix}: supporting copy is below 13px`);
  if (evidence.metadataFont < 11) values.push(`${prefix}: metadata is below 11px`);
  return values;
}

async function verifySearchDialog(page, browserName, viewportName) {
  await page.locator(".search-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ state: "visible" });
  const input = page.locator(".docs-search-input");
  const inputFocused = await input.evaluate((element) => document.activeElement === element);
  if (!inputFocused) failures.push(`${browserName}/${viewportName}/docs: search did not move focus into the dialog`);
  await input.fill("atlas");
  await page.locator(".docs-search-status").filter({ hasText: "estate search unavailable" }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const focusReturned = await page.locator(".search-trigger").evaluate(
    (button) => document.activeElement === button,
  );
  if (!focusReturned) failures.push(`${browserName}/${viewportName}/docs: search did not restore trigger focus`);
}

async function focusSearchWithKeyboard(page) {
  await page.locator(".wordmark").focus();
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    const reached = await page.locator(".search-trigger").evaluate(
      (button) => document.activeElement === button,
    );
    if (reached) return;
  }
}

async function capture(context, browserName, viewportName) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await openWithRetry(page);
    const stylesheet = await context.request.get(new URL("/v1/docs/assets/interface-kit.css", base).toString());
    if (!stylesheet.ok()) failures.push(`${browserName}/${viewportName}/docs: interface stylesheet HTTP ${stylesheet.status()}`);
    if (stylesheet.headers()["x-atlas-interface-sha256"] !== "b2f97652efc8a10b075594b0622b1cceb46d114ee36cf862eca685ce9201b935") {
      failures.push(`${browserName}/${viewportName}/docs: interface stylesheet fingerprint drifted`);
    }
    await verifySearchDialog(page, browserName, viewportName);
    await focusSearchWithKeyboard(page);
    const semantics = await inspectPage(page);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const violations = accessibility.violations.map(summarizeViolation);
    const blocking = violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    );
    const pageFailures = semanticFailures(semantics, browserName, viewportName);
    if (pageErrors.length) pageFailures.push(`${browserName}/${viewportName}/docs: page errors ${JSON.stringify(pageErrors)}`);
    if (blocking.length) pageFailures.push(`${browserName}/${viewportName}/docs: serious accessibility findings ${JSON.stringify(blocking)}`);
    failures.push(...pageFailures);

    await page.evaluate(() => document.activeElement?.blur());
    const fullPage = `screenshots/${browserName}-${viewportName}-docs-full.png`;
    await page.screenshot({ path: fullPage, fullPage: true });
    const viewport = `screenshots/${browserName}-${viewportName}-docs-viewport.png`;
    await page.screenshot({ path: viewport, fullPage: false });
    report.push({
      browser: browserName,
      viewport: viewportName,
      route: "/v1/docs",
      semantics,
      pageErrors,
      accessibilityViolations: violations,
      failures: pageFailures,
      screenshots: { fullPage, viewport },
    });
  } catch (error) {
    const message = `${browserName}/${viewportName}/docs: ${error.stack || error.message}`;
    failures.push(message);
    report.push({ browser: browserName, viewport: viewportName, route: "/v1/docs", failures: [message] });
  } finally {
    writeReport();
    await page.close();
  }
}

async function run() {
  fs.mkdirSync("screenshots", { recursive: true });
  for (const [browserName, launch] of browsers) {
    const browser = await launch();
    try {
      for (const [viewportName, viewport] of viewports) {
        const context = await browser.newContext({
          viewport,
          reducedMotion: "reduce",
          serviceWorkers: "block",
        });
        await configureContext(context);
        try {
          await capture(context, browserName, viewportName);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  writeReport();
  if (failures.length) {
    throw new Error(`Interface evidence failed with ${failures.length} findings:\n${failures.join("\n")}`);
  }
}

try {
  await run();
} catch (error) {
  fs.writeFileSync("capture-error.txt", `${error.stack || error.message}\n`);
  process.exitCode = 1;
}
