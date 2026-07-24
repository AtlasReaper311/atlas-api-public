import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const version = "0.2.0";
const bundle = path.join(root, "assets", "docs-interface", `v${version}`);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
const expectedFiles = new Set([
  "atlas-fonts.css",
  "atlas-interface-kit.css",
  "components.json",
  "fonts/dm-serif-display-400-italic.woff2",
  "fonts/dm-serif-display-400.woff2",
  "fonts/ibm-plex-mono-400.woff2",
  "fonts/ibm-plex-mono-500.woff2",
  "licenses/DM-Serif-Display-OFL.txt",
  "licenses/IBM-Plex-Mono-OFL.txt",
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

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

const actualFiles = new Set(
  listFiles(bundle).filter((filename) => filename !== "manifest.json"),
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
const fontsCss = fs.readFileSync(path.join(bundle, "atlas-fonts.css"), "utf8");
requireValue(fontsCss.includes("@font-face"), "font CSS is missing local font faces");
requireValue(!fontsCss.includes("https://"), "font CSS has a remote runtime dependency");

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
