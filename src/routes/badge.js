/**
 * /v1/badge/status: a shields-flat SVG, generated not fetched.
 *
 * Geometry follows the shields flat template: Verdana 11px metrics via
 * a character width table, the scale(.1) text trick, and textLength
 * pinning so approximation error never misaligns the render. Colours
 * are shields-native (green, amber, red) because this badge lives in
 * GitHub READMEs next to other shields badges; brand tokens belong on
 * the site, native grammar belongs here.
 *
 * Sixty seconds of cache both in the Cache API and the Cache-Control
 * header; GitHub's camo proxy respects the latter.
 */

import { CORS_HEADERS } from "../lib/http.js";
import { readEstate, badgeStatus } from "../lib/status.js";

// Approximate Verdana 11px advance widths. Sparse table plus a default:
// textLength pins the final geometry, so close is good enough.
const CHAR_WIDTHS = {
  " ": 3.9, "/": 3.9, ".": 4, ",": 4, ":": 4, "-": 4.6,
  i: 3.1, j: 3.1, l: 3.1, f: 3.9, t: 4.3, r: 4.6,
  m: 10.7, w: 9.3, W: 10.9, M: 10, "0": 7, "1": 7, "2": 7,
  "3": 7, "4": 7, "5": 7, "6": 7, "7": 7, "8": 7, "9": 7,
};
const DEFAULT_WIDTH = 6.9;

function textWidth(text) {
  let width = 0;
  for (const ch of text) width += CHAR_WIDTHS[ch] ?? DEFAULT_WIDTH;
  return Math.round(width);
}

function escapeXml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderBadge(label, message, color) {
  const pad = 10;
  const labelW = textWidth(label) + pad;
  const messageW = textWidth(message) + pad;
  const total = labelW + messageW;
  const l = escapeXml(label);
  const m = escapeXml(message);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${l}: ${m}">` +
    `<title>${l}: ${m}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${labelW}" height="20" fill="#555"/>` +
    `<rect x="${labelW}" width="${messageW}" height="20" fill="${color}"/>` +
    `<rect width="${total}" height="20" fill="url(#s)"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    `<text aria-hidden="true" x="${labelW * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - pad) * 10}">${l}</text>` +
    `<text x="${labelW * 5}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelW - pad) * 10}">${l}</text>` +
    `<text aria-hidden="true" x="${(labelW + messageW / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageW - pad) * 10}">${m}</text>` +
    `<text x="${(labelW + messageW / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageW - pad) * 10}">${m}</text>` +
    `</g>` +
    `</svg>`
  );
}

export async function handleBadge(_request, env, ctx) {
  const cache = globalThis.caches ? globalThis.caches.default : null;
  const cacheKey = new Request("https://atlas-api-public.internal/v1/badge/status");
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const snapshot = await readEstate(env);
  const status = badgeStatus(snapshot);
  const svg = renderBadge("atlas systems", status.message, status.color);

  const response = new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
      ...CORS_HEADERS,
    },
  });
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
