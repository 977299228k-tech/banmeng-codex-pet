const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  isTrustedLocalRequest,
  publicStateSnapshot,
  readJsonBody
} = require("../app/local-api.cjs");

function requestStub({ address = "127.0.0.1", host = "127.0.0.1:47831", headers = {} } = {}) {
  return { socket: { remoteAddress: address }, headers: { host, ...headers } };
}

test("local API accepts scripts but rejects browser cross-site requests", () => {
  assert.equal(isTrustedLocalRequest(requestStub(), 47831), true);
  assert.equal(isTrustedLocalRequest(requestStub({ headers: { origin: "https://example.com" } }), 47831), false);
  assert.equal(isTrustedLocalRequest(requestStub({ headers: { "sec-fetch-site": "cross-site" } }), 47831), false);
  assert.equal(isTrustedLocalRequest(requestStub({ host: "example.com" }), 47831), false);
  assert.equal(isTrustedLocalRequest(requestStub({ address: "192.168.1.5" }), 47831), false);
});

test("public state omits account email, prompt detail, and session identifiers", () => {
  const snapshot = publicStateSnapshot({
    task: { mode: "running", title: "正在理解任务", detail: "private prompt", sessionId: "secret", toolCount: 2 },
    account: { type: "chatgpt", planType: "plus", email: "private@example.com" },
    quota: { connected: true },
    usage: { summary: { lifetimeTokens: 5 } }
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.account.planType, "plus");
  assert.equal(snapshot.task.toolCount, 2);
  assert.doesNotMatch(serialized, /private|secret|email/i);
});

test("JSON body reader parses valid payloads and limits oversized bodies", async () => {
  const valid = Readable.from([Buffer.from('{"action":"feed"}')]);
  assert.deepEqual(await readJsonBody(valid), { action: "feed" });

  const oversized = Readable.from([Buffer.alloc(32)]);
  await assert.rejects(readJsonBody(oversized, 8), (error) => error.statusCode === 413);
});
