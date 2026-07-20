import manifest from "../../data/estate.manifest.json" with { type: "json" };
import repositoryInventory from "../../data/public-repositories.json" with { type: "json" };
import { json, errorResponse } from "../lib/http.js";

const PUBLIC_IDENTITIES = new Set([
  ...(repositoryInventory.repositories || [])
    .filter((repository) => repository?.visibility === "public")
    .map((repository) => repository.name),
  ...(manifest.components || [])
    .map((component) => component?.name)
    .filter((name) => typeof name === "string"),
  "atlas-systems.uk",
  "status.atlas-systems.uk",
  "cv.atlas-systems.uk",
]);

function candidates(event) {
  const values = [event?.title, event?.message, event?.event, event?.repo]
    .filter((value) => typeof value === "string")
    .join(" ");
  const found = new Set();

  for (const match of values.matchAll(/AtlasReaper311\/([A-Za-z0-9._-]+)/g)) {
    found.add(match[1]);
  }

  for (const pattern of [
    /(?:Deployed|Deploy failed|Blocked):\s*([A-Za-z0-9._-]+)/gi,
    /Push to\s+(?:AtlasReaper311\/)?([A-Za-z0-9._-]+)/gi,
    /(?:Dependabot alert|Secret scanning|Issue|PR|Review requested)[^:]*:\s*(?:AtlasReaper311\/)?([A-Za-z0-9._-]+)/gi,
  ]) {
    for (const match of values.matchAll(pattern)) found.add(match[1]);
  }

  if (typeof event?.repo === "string") found.add(event.repo.replace(/^AtlasReaper311\//, ""));
  return [...found];
}

export function isPublicEvent(event) {
  const identities = candidates(event);
  if (identities.length > 0) {
    return identities.every((identity) => PUBLIC_IDENTITIES.has(identity));
  }

  const dialect = String(event?.dialect || "").toLowerCase();
  if (dialect === "github") return false;

  const text = `${event?.title || ""} ${event?.message || ""}`;
  if (/github\.com\/AtlasReaper311\//i.test(text)) return false;

  return true;
}

function sanitizeEvent(event) {
  return {
    ts: event?.ts ?? null,
    level: event?.level ?? "info",
    dialect: event?.dialect ?? "event",
    event: event?.event ?? "event",
    title: event?.title ?? "",
    message: event?.message ?? "",
  };
}

export function publicEventProjection(document, limit = 50, levels = []) {
  const allowedLevels = new Set(levels);
  const events = (Array.isArray(document?.events) ? document.events : [])
    .filter(isPublicEvent)
    .filter((event) => allowedLevels.size === 0 || allowedLevels.has(event.level))
    .map(sanitizeEvent);
  const sliced = events.slice(0, limit);
  const levelCounts = {};
  for (const event of events) {
    levelCounts[event.level] = (levelCounts[event.level] || 0) + 1;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    total: events.length,
    returned: sliced.length,
    levelCounts,
    events: sliced,
    projection: "public-only",
  };
}

export async function handlePublicEvents(request, env) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") || 10);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(50, Math.floor(requested)))
    : 10;
  const levels = url.searchParams
    .getAll("level")
    .filter((level) => ["success", "info", "warning", "failure"].includes(level));

  let upstream;
  try {
    upstream = await env.ATLAS_NOTIFY.fetch(
      `https://atlas-notify/notify/recent?limit=50`,
      { signal: AbortSignal.timeout(5000) },
    );
  } catch {
    return errorResponse(502, "event upstream unreachable");
  }

  if (!upstream.ok) {
    return errorResponse(502, `event upstream answered ${upstream.status}`);
  }

  const document = await upstream.json();
  return json(publicEventProjection(document, limit, levels), 200, {
    "cache-control": "public, max-age=60",
  });
}
