import { DOCS_ICONS } from "./docs-icons.generated.js";
import {
  DOCS_INTERFACE_FONT_ASSETS,
  DOCS_INTERFACE_FONT_STYLESHEET,
  DOCS_INTERFACE_STYLESHEET,
} from "./docs-interface.generated.js";

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const DOCS_SHELL_JS = String.raw`
(() => {
  "use strict";
  const statusUrl = "/v1/stats";
  const searchUrl = "/v1/search";
  const owned = new Set(["api.atlas-systems.uk", "atlas-systems.uk", "cv.atlas-systems.uk", "ramone.atlas-systems.uk", "status.atlas-systems.uk"]);
  const statusLabels = Object.freeze({
    checking: "Checking",
    operational: "Operational",
    degraded: "Degraded",
    unavailable: "Unavailable",
    unknown: "Unknown",
  });
  const chip = document.querySelector("[data-estate-status]");
  let searchUi = null;
  let request = null;
  let debounce = null;
  let previousFocus = null;

  function setStatus(state, detail) {
    if (!chip) return;
    const label = statusLabels[state] || statusLabels.unknown;
    chip.dataset.state = state;
    chip.querySelector("[data-estate-status-label]").textContent = label;
    chip.setAttribute("aria-label", "Atlas Systems status: " + label);
    chip.title = detail;
  }

  function mapStatus(data) {
    const estate = data && data.estate;
    const operational = Number(estate && estate.operational);
    const total = Number(estate && estate.total_components);
    const checked = Date.parse(estate && estate.checked_at);
    if (!Number.isFinite(operational) || !Number.isFinite(total) || total <= 0 || operational < 0 || operational > total || !Number.isFinite(checked)) {
      return ["unknown", "Status evidence is unavailable."];
    }
    const age = Date.now() - checked;
    if (age < 0 || age > 1200000) return ["unknown", "Status evidence is stale."];
    const detail = operational + " of " + total + " monitored components operational.";
    if (operational === total) return ["operational", detail];
    if (operational > total / 2) return ["degraded", detail];
    return ["unavailable", detail];
  }

  async function refreshStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(statusUrl, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error();
      const [state, detail] = mapStatus(await response.json());
      setStatus(state, detail);
    } catch {
      setStatus("unknown", "Status evidence could not be loaded.");
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeLink(anchor) {
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
    const raw = anchor.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
    let url;
    try { url = new URL(anchor.href, location.href); } catch { return; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (owned.has(url.hostname)) {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    } else {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
  }

  function normalizeLinks(root = document) {
    root.querySelectorAll("a[href]").forEach(normalizeLink);
  }

  function resultHref(hit) {
    const repository = String(hit.source_repo || hit.repo || "");
    const path = String(hit.file_path || hit.path || "");
    if (repository === "atlas-systems" && /\.html?$/i.test(path)) {
      return "https://atlas-systems.uk/" + path.replace(/^\/+/, "").replace(/index\.html?$/i, "");
    }
    if (repository && path) {
      return "https://github.com/AtlasReaper311/" + encodeURIComponent(repository) + "/blob/main/" + path.split("/").map(encodeURIComponent).join("/");
    }
    return null;
  }

  function excerpt(value) {
    const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
    return text.length > 220 ? text.slice(0, 220).replace(/\s+\S*$/, "") + "…" : text;
  }

  function buildSearch() {
    const root = document.createElement("div");
    root.className = "docs-search-root";
    root.hidden = true;
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "docs-search-scrim";
    scrim.setAttribute("aria-label", "Close estate search");
    const panel = document.createElement("section");
    panel.className = "docs-search-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Search the Atlas Systems estate");
    const heading = document.createElement("p");
    heading.className = "docs-search-heading";
    heading.textContent = "ATLAS ESTATE // search";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "docs-search-input";
    input.maxLength = 500;
    input.placeholder = "search the estate…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search query");
    const status = document.createElement("p");
    status.className = "docs-search-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = "type at least two characters";
    const results = document.createElement("ol");
    results.className = "docs-search-results";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "docs-search-close";
    close.textContent = "Close";
    panel.append(heading, input, status, results, close);
    root.append(scrim, panel);
    document.body.appendChild(root);
    return { root, scrim, panel, input, status, results, close };
  }

  function renderResults(data) {
    searchUi.results.replaceChildren();
    const hits = Array.isArray(data && data.hits) ? data.hits.slice(0, 5) : [];
    if (!hits.length) {
      searchUi.status.textContent = "no matches in the public estate corpus";
      return;
    }
    for (const hit of hits) {
      const item = document.createElement("li");
      const destination = resultHref(hit);
      const main = document.createElement(destination ? "a" : "div");
      main.className = "docs-search-result";
      if (destination) {
        main.href = destination;
        if (!new URL(destination).hostname.endsWith("atlas-systems.uk")) {
          main.target = "_blank";
          main.rel = "noopener noreferrer";
        }
      }
      const label = document.createElement("strong");
      label.textContent = String(hit.source_repo || hit.repo || "estate") + "/" + String(hit.file_path || hit.path || "document");
      const text = document.createElement("span");
      text.textContent = excerpt(hit.text || hit.excerpt || "");
      main.append(label, text);
      item.appendChild(main);
      searchUi.results.appendChild(item);
    }
    searchUi.status.textContent = hits.length + (hits.length === 1 ? " result" : " results");
  }

  async function runSearch(query) {
    if (request) request.abort();
    request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 8000);
    searchUi.status.textContent = "searching…";
    try {
      const url = new URL(searchUrl, location.origin);
      url.searchParams.set("q", query);
      url.searchParams.set("top_k", "5");
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" }, signal: request.signal });
      if (response.status === 429) {
        searchUi.results.replaceChildren();
        searchUi.status.textContent = "search rate limit reached; try again shortly";
        return;
      }
      if (!response.ok) throw new Error();
      renderResults(await response.json());
    } catch (error) {
      if (error && error.name === "AbortError") return;
      searchUi.results.replaceChildren();
      searchUi.status.textContent = "estate search unavailable";
    } finally {
      clearTimeout(timeout);
    }
  }

  function openSearch(trigger) {
    previousFocus = trigger || document.activeElement;
    searchUi.root.hidden = false;
    document.body.classList.add("docs-search-open");
    searchUi.input.focus();
    searchUi.input.select();
  }

  function closeSearch() {
    if (request) request.abort();
    searchUi.root.hidden = true;
    document.body.classList.remove("docs-search-open");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  function trapFocus(event) {
    const controls = Array.from(searchUi.panel.querySelectorAll("a[href],button,input")).filter((node) => !node.disabled);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  searchUi = buildSearch();
  document.querySelectorAll("[data-estate-search-open]").forEach((trigger) => trigger.addEventListener("click", () => openSearch(trigger)));
  searchUi.scrim.addEventListener("click", closeSearch);
  searchUi.close.addEventListener("click", closeSearch);
  searchUi.panel.addEventListener("keydown", (event) => { if (event.key === "Tab") trapFocus(event); });
  searchUi.input.addEventListener("input", () => {
    const query = searchUi.input.value.trim();
    if (debounce) clearTimeout(debounce);
    if (query.length < 2) {
      if (request) request.abort();
      searchUi.results.replaceChildren();
      searchUi.status.textContent = query ? "keep typing…" : "type at least two characters";
      return;
    }
    debounce = setTimeout(() => void runSearch(query), 250);
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "k") {
      event.preventDefault();
      openSearch(document.activeElement);
    } else if (key === "escape" && !searchUi.root.hidden) {
      closeSearch();
    }
  });

  normalizeLinks();
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) normalizeLinks(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
  void refreshStatus();
})();
`;

export function handleDocsAsset(pathname) {
  if (pathname === "/v1/docs/assets/fonts.css") {
    return new Response(decodeBase64(DOCS_INTERFACE_FONT_STYLESHEET.base64), {
      headers: {
        "content-type": DOCS_INTERFACE_FONT_STYLESHEET.contentType,
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
        "x-atlas-interface-sha256": DOCS_INTERFACE_FONT_STYLESHEET.sha256,
      },
    });
  }

  if (pathname === "/v1/docs/assets/interface-kit.css") {
    return new Response(decodeBase64(DOCS_INTERFACE_STYLESHEET.base64), {
      headers: {
        "content-type": DOCS_INTERFACE_STYLESHEET.contentType,
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
        "x-atlas-interface-sha256": DOCS_INTERFACE_STYLESHEET.sha256,
      },
    });
  }

  if (pathname === "/v1/docs/assets/shell.js") {
    return new Response(DOCS_SHELL_JS, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const font = DOCS_INTERFACE_FONT_ASSETS[pathname];
  if (font) {
    return new Response(decodeBase64(font.base64), {
      headers: {
        "content-type": font.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "x-atlas-interface-sha256": font.sha256,
      },
    });
  }

  const icon = DOCS_ICONS[pathname];
  if (!icon) return null;
  return new Response(decodeBase64(icon.base64), {
    headers: {
      "content-type": icon.contentType,
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    },
  });
}
