const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("plugin hooks resolve scripts from the installed plugin root", () => {
  const source = fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8");
  const hooks = JSON.parse(source);
  assert.ok(hooks.hooks.SessionStart);
  assert.match(source, /\$\{PLUGIN_ROOT\}/);
  assert.doesNotMatch(source, /[A-Z]:[\\/]Users[\\/]/i);
});

test("plugin manifest and required assets are publishable", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "banmeng-codex-pet");
  assert.equal(manifest.version, "0.2.0");
  assert.ok(fs.existsSync(path.join(root, "app", "motion.cjs")));
  assert.ok(fs.existsSync(path.join(root, "assets", "codex-pet.png")));
  assert.ok(fs.existsSync(path.join(root, "scripts", "start-pet.cjs")));
});
