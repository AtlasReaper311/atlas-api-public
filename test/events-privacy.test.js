import assert from "node:assert/strict";
import test from "node:test";

import { isPublicEvent, publicEventProjection } from "../src/routes/events.js";

test("public event projection drops unknown repository identities", () => {
  assert.equal(
    isPublicEvent({
      dialect: "github",
      title: "Push to AtlasReaper311/owner-private-service",
      message: "internal change",
    }),
    false,
  );
});

test("public event projection keeps approved public repository events", () => {
  assert.equal(
    isPublicEvent({
      dialect: "github",
      title: "Push to AtlasReaper311/atlas-api-public",
      message: "public change",
    }),
    true,
  );
});

test("public event projection accepts only approved operational envelope classes", () => {
  assert.equal(
    isPublicEvent({
      dialect: "envelope",
      event: "reliability",
      title: "Public reliability state changed",
    }),
    true,
  );
  assert.equal(
    isPublicEvent({
      dialect: "envelope",
      event: "alert",
      title: "Internal service changed state",
    }),
    false,
  );
  assert.equal(
    isPublicEvent({
      dialect: "cloudflare",
      event: "cloudflare",
      title: "Account notification",
    }),
    false,
  );
});

test("public projection recalculates counts after filtering", () => {
  const result = publicEventProjection({
    events: [
      { level: "success", dialect: "github", title: "Push to AtlasReaper311/atlas-api-public", ts: "2026-07-20T00:00:00Z" },
      { level: "failure", dialect: "github", title: "Push to AtlasReaper311/owner-private-service", ts: "2026-07-20T00:01:00Z" },
      { level: "warning", dialect: "envelope", event: "alert", title: "Internal alert", ts: "2026-07-20T00:02:00Z" },
    ],
  });

  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.deepEqual(result.levelCounts, { success: 1 });
  assert.equal(result.events[0].title, "Push to AtlasReaper311/atlas-api-public");
});
