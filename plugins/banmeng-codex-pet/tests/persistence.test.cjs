const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readJsonWithBackup, writeJsonAtomic } = require("../app/persistence.cjs");

test("life state writes atomically and recovers from a valid backup", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "banmeng-pet-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "life-state.json");

  writeJsonAtomic(filePath, { bond: 2 });
  writeJsonAtomic(filePath, { bond: 3 });
  assert.deepEqual(readJsonWithBackup(filePath), { bond: 3 });

  fs.writeFileSync(filePath, "{broken", "utf8");
  assert.deepEqual(readJsonWithBackup(filePath), { bond: 2 });
});
