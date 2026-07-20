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

test("public projection recalculates counts after filtering", () => {
  const result = publicEventProjection({
    events: [
      { level: "success", dialect: "github", title: "Push to AtlasReaper311/atlas-api-public", ts: "2026-07-20T00:00:00Z" },
      { level: "failure", dialect: "github", title: "Push to AtlasReaper311/owner-private-service", ts: "2026-07-20T00:01:00Z" },
    ],
  });

  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.deepEqual(result.levelCounts, { success: 1 });
  assert.equal(result.events[0].title, "Push to AtlasReaper311/atlas-api-public");
});
