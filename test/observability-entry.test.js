import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  augmentStatsPayload,
  probeDora,
} from "../src/observability-entry.js";

function statsFixture() {
  return {
    ok: true,
    estate: {
      operational: 2,
      total_components: 2,
      components: {
        registry: true,
        notify: true,
      },
      component_details: {
        registry: {
          status: "healthy",
          detail: "http 200",
          latency_ms: 10,
          evidence_source: "service-binding:atlas-api-index/_meta",
          measured_at: "2026-07-25T12:00:00.000Z",
        },
        notify: {
          status: "healthy",
          detail: "http 200",
          latency_ms: 11,
          evidence_source: "service-binding:atlas-notify/health",
          measured_at: "2026-07-25T12:00:00.000Z",
        },
      },
    },
    uptime: {
      components: {
        registry: 100,
        notify: 100,
      },
    },
  };
}

test("probeDora records a healthy service-binding response", async () => {
  const result = await probeDora({
    ATLAS_DORA: {
      fetch: async (url) => {
        assert.equal(url, "https://atlas-dora/dora/health");
        return Response.json({
          ok: true,
          service: "atlas-dora",
          at: "2026-07-25T12:01:00.000Z",
        });
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "healthy");
  assert.equal(result.measured_at, "2026-07-25T12:01:00.000Z");
  assert.equal(result.evidence_source, "service-binding:atlas-dora/dora/health");
  assert.ok(Number.isFinite(result.latency_ms));
});

test("probeDora fails closed when the binding is absent", async () => {
  const result = await probeDora({});
  assert.equal(result.ok, false);
  assert.equal(result.status, "unknown");
  assert.equal(result.detail, "binding missing");
  assert.equal(result.measured_at, null);
});

test("augmentStatsPayload adds DORA without disturbing existing evidence", () => {
  const payload = statsFixture();
  const result = augmentStatsPayload(payload, {
    ok: true,
    status: "healthy",
    detail: "health contract reports ok",
    evidence_source: "service-binding:atlas-dora/dora/health",
    measured_at: "2026-07-25T12:01:00.000Z",
    latency_ms: 12,
  });

  assert.equal(result.estate.components.atlas_dora, true);
  assert.deepEqual(result.estate.component_details.atlas_dora, {
    status: "healthy",
    detail: "health contract reports ok",
    latency_ms: 12,
    evidence_source: "service-binding:atlas-dora/dora/health",
    measured_at: "2026-07-25T12:01:00.000Z",
  });
  assert.equal(result.estate.operational, 3);
  assert.equal(result.estate.total_components, 3);
  assert.equal(result.uptime.components.atlas_dora, null);
  assert.equal(result.estate.component_details.registry.detail, "http 200");
});

test("Wrangler delegates through the composition entry and binds atlas-dora", () => {
  const wrangler = readFileSync("wrangler.toml", "utf8");
  assert.match(wrangler, /main = "src\/observability-entry\.js"/);
  assert.match(wrangler, /binding = "ATLAS_DORA"\nservice = "atlas-dora"/);
});
