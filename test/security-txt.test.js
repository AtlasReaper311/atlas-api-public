import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  SECURITY_PATH,
  SECURITY_TEXT,
  handleSecurityTxt,
} from "../src/security-txt.js";
import { secureResponse } from "../src/lib/http.js";

const expected = [
  "Contact: mailto:atlas@atlas-systems.uk",
  "Expires: 2027-07-24T23:59:59Z",
  "Preferred-Languages: en",
  "Canonical: https://api.atlas-systems.uk/.well-known/security.txt",
];

test("Public API serves the exact security contact route and content", async () => {
  const response = handleSecurityTxt(SECURITY_PATH);
  assert.ok(response instanceof Response);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.deepEqual((await response.text()).trim().split("\n"), expected);
  assert.deepEqual(SECURITY_TEXT.trim().split("\n"), expected);
  assert.equal(handleSecurityTxt("/v1/docs"), null);
});

test("Public API security metadata receives the normal response boundary", () => {
  const response = secureResponse(handleSecurityTxt(SECURITY_PATH));
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("Wrangler declares only the exact standards route outside existing API paths", () => {
  const wrangler = fs.readFileSync("wrangler.toml", "utf8");
  assert.match(
    wrangler,
    /pattern = "api\.atlas-systems\.uk\/\.well-known\/security\.txt"/,
  );
  assert.doesNotMatch(wrangler, /pattern = "api\.atlas-systems\.uk\/\*"/);
});
