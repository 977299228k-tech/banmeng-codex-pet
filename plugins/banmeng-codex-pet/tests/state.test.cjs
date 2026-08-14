const test = require("node:test");
const assert = require("node:assert/strict");
const { mapHookEvent, quotaSnapshot } = require("../app/state.cjs");

test("maps tool activity to a visible task state", () => {
  const result = mapHookEvent({ hook_event_name: "PreToolUse", tool_name: "apply_patch", turn_id: "turn-1" });
  assert.equal(result.mode, "tool");
  assert.equal(result.title, "正在编辑");
  assert.equal(result.incrementTool, true);
});

test("maps permission requests to attention", () => {
  const result = mapHookEvent({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
  assert.equal(result.mode, "attention");
  assert.equal(result.title, "需要你的确认");
});

test("computes remaining quota from the Codex bucket", () => {
  const result = quotaSnapshot({ rateLimitsByLimitId: { codex: { limitId: "codex", primary: { usedPercent: 8, resetsAt: 123 } } } });
  assert.equal(result.remainingPercent, 92);
  assert.equal(result.resetsAt, 123);
});
