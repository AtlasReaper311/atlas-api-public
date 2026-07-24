import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

test("public API serves the canonical Atlas Systems security contact", async () => {
  const response = await worker.fetch(
    new Request("https://api.atlas-systems.uk/.well-known/security.txt"),
    {},
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  const body = await response.text();
  assert.match(body, /^Contact: mailto:atlas@atlas-systems\.uk$/m);
  assert.match(body, /^Expires: 2027-07-24T23:59:59Z$/m);
  assert.match(body, /^Preferred-Languages: en$/m);
  assert.match(body, /^Canonical: https:\/\/api\.atlas-systems\.uk\/\.well-known\/security\.txt$/m);
});
