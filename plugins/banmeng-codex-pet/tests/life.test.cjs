const test = require("node:test");
const assert = require("node:assert/strict");
const {
  advanceLife,
  applyCareAction,
  applyInteraction,
  applyWorkEvent,
  chooseAutonomousAction,
  normalizeLife,
  performAutonomousAction
} = require("../app/life.cjs");

test("life needs decay over elapsed offline time", () => {
  const start = 1_000_000;
  const life = normalizeLife({ satiety: 80, mood: 70, energy: 50, lastUpdatedAt: start }, start);
  const next = advanceLife(life, start + 2 * 60 * 60 * 1_000);
  assert.equal(next.satiety, 77.3);
  assert.ok(next.mood < 70);
  assert.ok(next.energy > 50);
});

test("feeding and petting update persistent needs", () => {
  const now = 2_000_000;
  const initial = normalizeLife({ satiety: 40, mood: 40, energy: 60, lastUpdatedAt: now }, now);
  const fed = applyCareAction(initial, "feed", now).life;
  const petted = applyInteraction(fed, "pet", now);
  assert.equal(fed.satiety, 62);
  assert.equal(petted.mood, 45);
  assert.equal(petted.bond, 2);
});

test("autonomy prioritizes the strongest unmet need", () => {
  assert.equal(chooseAutonomousAction({ satiety: 5, mood: 80, energy: 80 }, () => 0), "snack");
  assert.equal(chooseAutonomousAction({ satiety: 90, mood: 80, energy: 5 }, () => 0), "rest");
  assert.equal(chooseAutonomousAction({ satiety: 90, mood: 5, energy: 90 }, () => 0), "seek-attention");
});

test("autonomous actions modify stats and expose a visible reaction", () => {
  const now = 3_000_000;
  const initial = normalizeLife({ satiety: 10, mood: 50, energy: 60, lastUpdatedAt: now }, now);
  const result = performAutonomousAction(initial, "snack", now);
  assert.equal(result.life.activity, "eat");
  assert.equal(result.life.satiety, 24);
  assert.equal(result.reaction.kind, "eat");
  assert.ok(result.duration > 0);
});

test("completed Codex work improves mood while consuming energy", () => {
  const now = 4_000_000;
  const initial = normalizeLife({ satiety: 70, mood: 50, energy: 70, lastUpdatedAt: now }, now);
  const completed = applyWorkEvent(initial, "Stop", now);
  assert.equal(completed.mood, 54);
  assert.equal(completed.energy, 68.5);
  assert.equal(completed.bond, 1);
});
