import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const version = "0.1.1";
const bundle = path.join(root, "assets", "docs-interface", `v${version}`);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
const expectedFiles = new Set([
  "atlas-interface-kit.css",
  "components.json",
  "tokens.json",
]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

requireValue(manifest.schema_version === "atlas-interface-kit/bundle/v1", "unsupported interface manifest");
requireValue(manifest.version === version, "unexpected interface version");
requireValue(manifest.contract_version === "2.0.0", "unexpected interface contract version");
requireValue(manifest.component_role_count === 25, "unexpected component role count");
requireValue(
  JSON.stringify(Object.keys(manifest.files || {}).sort()) === JSON.stringify([...expectedFiles].sort()),
  "interface bundle file set drifted",
);

const actualFiles = new Set(
  fs.readdirSync(bundle).filter((filename) => filename !== "manifest.json"),
);
requireValue(
  JSON.stringify([...actualFiles].sort()) === JSON.stringify([...expectedFiles].sort()),
  "vendored interface directory contains drift",
);

for (const [filename, record] of Object.entries(manifest.files)) {
  const buffer = fs.readFileSync(path.join(bundle, filename));
  requireValue(buffer.byteLength === record.bytes, `byte count mismatch: ${filename}`);
  requireValue(sha256(buffer) === record.sha256, `SHA-256 mismatch: ${filename}`);
  if (filename.endsWith(".json")) JSON.parse(buffer.toString("utf8"));
}

const css = fs.readFileSync(path.join(bundle, "atlas-interface-kit.css"), "utf8");
requireValue(!css.includes("http://") && !css.includes("https://"), "interface CSS has a remote dependency");
requireValue(css.includes(":focus-visible"), "interface CSS is missing visible focus");
requireValue(css.includes("prefers-reduced-motion"), "interface CSS is missing reduced-motion handling");

const components = JSON.parse(fs.readFileSync(path.join(bundle, "components.json"), "utf8"));
requireValue(
  Array.isArray(components.roles) && components.roles.length === manifest.component_role_count,
  "component role count does not match manifest",
);
requireValue(
  new Set(components.roles.map((item) => item.role)).size === components.roles.length,
  "component roles are not unique",
);

const tokens = JSON.parse(fs.readFileSync(path.join(bundle, "tokens.json"), "utf8"));
requireValue(tokens.version === version, "token version does not match manifest");
requireValue(tokens.contract_version === manifest.contract_version, "token contract version drifted");
requireValue(tokens.colour?.text_faint === "#888894", "accessible faint-text token drifted");

console.log(`Atlas interface bundle verified: v${version} / contract ${manifest.contract_version}`);
