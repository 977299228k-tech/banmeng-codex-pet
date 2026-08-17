const test = require("node:test");
const assert = require("node:assert/strict");
const { advanceWalk, contentSizeNeedsCorrection, createWalkDecision, idleDelay } = require("../app/motion.cjs");

test("walk decisions turn inward at either screen edge", () => {
  assert.equal(createWalkDecision({ x: 0, minX: 0, maxX: 1_000 }, () => 0).direction, "right");
  assert.equal(createWalkDecision({ x: 1_000, minX: 0, maxX: 1_000 }, () => 0.99).direction, "left");
});

test("walking advances smoothly without overshooting the target", () => {
  assert.deepEqual(advanceWalk({ x: 10, targetX: 20, speed: 50, deltaMs: 100 }), { x: 15, reached: false });
  assert.deepEqual(advanceWalk({ x: 18, targetX: 20, speed: 50, deltaMs: 100 }), { x: 20, reached: true });
});

test("idle pauses stay within the intended natural range", () => {
  assert.equal(idleDelay(() => 0), 2_400);
  assert.equal(idleDelay(() => 0.999), 7_195);
});

test("window correction ignores DPI rounding but repairs layout-breaking growth", () => {
  assert.equal(contentSizeNeedsCorrection(342, 558, 340, 555), false);
  assert.equal(contentSizeNeedsCorrection(422, 560, 340, 555), true);
  assert.equal(contentSizeNeedsCorrection(340, 555, 340, 555), false);
});
