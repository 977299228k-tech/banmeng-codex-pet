const test = require("node:test");
const assert = require("node:assert/strict");
const { isLegacyPetHealth, isPetHealth, petHealthKind } = require("../scripts/pet-http.cjs");

test("launcher only trusts a BANMENG health response", () => {
  assert.equal(isPetHealth({ ok: true, data: { ok: true, app: "banmeng-codex-pet" } }), true);
  assert.equal(isPetHealth({ ok: true, data: { ok: true, app: "another-service" } }), false);
  assert.equal(isPetHealth({ ok: false, data: null }), false);
});

test("launcher recognizes only the exact legacy BANMENG health shape", () => {
  const legacy = { ok: true, data: { ok: true, version: "0.3.0" } };
  assert.equal(isLegacyPetHealth(legacy), true);
  assert.equal(petHealthKind(legacy), "legacy");
  assert.equal(isLegacyPetHealth({ ok: true, data: { ok: true, version: "1.0.0" } }), false);
  assert.equal(isLegacyPetHealth({ ok: true, data: { ok: true, version: "0.3.0", service: "other" } }), false);
});
