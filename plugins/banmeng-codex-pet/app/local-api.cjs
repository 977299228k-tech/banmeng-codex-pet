const APP_ID = "banmeng-codex-pet";
const { usageSnapshot } = require("./state.cjs");

function isLoopback(address = "") {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isTrustedLocalRequest(request, port) {
  if (!isLoopback(request.socket?.remoteAddress)) return false;
  const host = String(request.headers?.host || "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  if (request.headers?.origin) return false;
  const fetchSite = String(request.headers?.["sec-fetch-site"] || "").toLowerCase();
  return !fetchSite || fetchSite === "none" || fetchSite === "same-origin";
}

function publicStateSnapshot(state = {}) {
  const task = state.task || {};
  return {
    task: {
      mode: task.mode || "idle",
      title: task.title || "",
      toolCount: Number(task.toolCount) || 0,
      startedAt: Number(task.startedAt) || null,
      finishedAt: Number(task.finishedAt) || null,
      updatedAt: Number(task.updatedAt) || null
    },
    quota: state.quota || { connected: false },
    usage: usageSnapshot(state.usage),
    account: state.account
      ? { type: state.account.type || null, planType: state.account.planType || null }
      : null,
    motion: state.motion || null,
    life: state.life || null
  };
}

function readJsonBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error("Request body is too large");
        error.statusCode = 413;
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", fail);
  });
}

module.exports = { APP_ID, isLoopback, isTrustedLocalRequest, publicStateSnapshot, readJsonBody };
