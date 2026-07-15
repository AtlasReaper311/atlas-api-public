import assert from "node:assert/strict";
import test from "node:test";

import {
  handleEvidenceGet,
  handleEvidenceIndex,
  handleEvidenceReport,
} from "../src/routes/evidence.js";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

async function fingerprint(document) {
  const canonical = JSON.stringify(sortValue(document));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function conformanceReport() {
  const report = {
    schema: "atlas-estate-conformance-report/v1",
    generated_at: "2026-07-15T12:00:00Z",
    policy_version: "2.0.0",
    source: { repository: "AtlasReaper311/atlas-infra", commit: "abc" },
    summary: {
      repositories_scanned: 34,
      repositories_scored: 34,
      estate_score: 92.1,
      errors: 0,
      warnings: 8,
      unknown: 0,
      passing: 26,
    },
    rules: [],
    repositories: [],
    findings: [],
    scoring: {},
  };
  report.fingerprint = await fingerprint(report);
  return report;
}

test("report route stores and serves validated evidence", async () => {
  const env = { ATLAS_PUBLIC_KV: new MemoryKv(), EVIDENCE_REPORT_KEY: "secret" };
  const report = await conformanceReport();
  const request = new Request("https://api.atlas/v1/evidence/conformance/report", {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(report),
  });
  const stored = await handleEvidenceReport(request, env, "conformance");
  assert.equal(stored.status, 200);
  assert.equal((await stored.json()).changed, true);

  const read = await handleEvidenceGet(
    new Request("https://api.atlas/v1/evidence/conformance"),
    env,
    "conformance",
  );
  assert.equal(read.status, 200);
  const payload = await read.json();
  assert.equal(payload.report.summary.estate_score, 92.1);
});

test("duplicate report is idempotent", async () => {
  const env = { ATLAS_PUBLIC_KV: new MemoryKv(), EVIDENCE_REPORT_KEY: "secret" };
  const report = await conformanceReport();
  for (let index = 0; index < 2; index += 1) {
    const response = await handleEvidenceReport(
      new Request("https://api.atlas/v1/evidence/conformance/report", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify(report),
      }),
      env,
      "conformance",
    );
    const body = await response.json();
    assert.equal(body.changed, index === 0);
  }
});

test("wrong bearer is rejected", async () => {
  const env = { ATLAS_PUBLIC_KV: new MemoryKv(), EVIDENCE_REPORT_KEY: "secret" };
  const report = await conformanceReport();
  const response = await handleEvidenceReport(
    new Request("https://api.atlas/v1/evidence/conformance/report", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify(report),
    }),
    env,
    "conformance",
  );
  assert.equal(response.status, 401);
});

test("index describes missing evidence without inventing data", async () => {
  const env = { ATLAS_PUBLIC_KV: new MemoryKv() };
  const response = await handleEvidenceIndex(new Request("https://api.atlas/v1/evidence"), env);
  const body = await response.json();
  assert.equal(body.evidence.conformance, null);
  assert.equal(body.evidence.chaos, null);
});
