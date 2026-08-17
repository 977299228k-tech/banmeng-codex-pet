const test = require("node:test");
const assert = require("node:assert/strict");
const { accountSnapshot, mapHookEvent, quotaSnapshot, usageSnapshot } = require("../app/state.cjs");

test("new sessions clear stale task timing", () => {
  const result = mapHookEvent({ hook_event_name: "SessionStart", session_id: "session-2" });
  assert.equal(result.resetTask, true);
  assert.equal(result.clearTiming, true);
});

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

test("account and usage snapshots keep only display-safe fields", () => {
  assert.deepEqual(accountSnapshot({ type: "chatgpt", planType: "plus", email: "private@example.com", token: "secret" }), {
    type: "chatgpt",
    planType: "plus"
  });
  const usage = usageSnapshot({
    summary: { lifetimeTokens: "12", secret: "hidden" },
    dailyUsageBuckets: [{ startDate: "2026-08-17", tokens: 4, accountId: "hidden" }]
  });
  assert.equal(usage.summary.lifetimeTokens, 12);
  assert.deepEqual(usage.dailyUsageBuckets, [{ startDate: "2026-08-17", tokens: 4 }]);
  assert.doesNotMatch(JSON.stringify(usage), /secret|accountId|hidden/);
});
