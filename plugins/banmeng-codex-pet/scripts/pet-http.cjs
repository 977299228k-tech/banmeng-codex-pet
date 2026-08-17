const http = require("node:http");
const { APP_ID } = require("../app/local-api.cjs");

const PORT = 47831;

function requestPet(pathname, method = "GET", payload = null, timeout = 800) {
  return new Promise((resolve) => {
    const body = payload == null ? null : JSON.stringify(payload);
    const headers = body == null
      ? {}
      : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) };
    const request = http.request({ hostname: "127.0.0.1", port: PORT, path: pathname, method, timeout, headers }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 64 * 1024) chunks.push(chunk);
        else {
          response.destroy();
          resolve({ ok: false, statusCode: response.statusCode, data: null });
        }
      });
      response.on("aborted", () => resolve({ ok: false, statusCode: response.statusCode, data: null }));
      response.on("error", () => resolve({ ok: false, statusCode: response.statusCode, data: null }));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        resolve({ ok: response.statusCode === 200, statusCode: response.statusCode, data });
      });
    });
    request.on("error", () => resolve({ ok: false, statusCode: null, data: null }));
    request.on("timeout", () => { request.destroy(); resolve({ ok: false, statusCode: null, data: null }); });
    if (body != null) request.write(body);
    request.end();
  });
}

function isPetHealth(result) {
  return Boolean(result?.ok && result.data?.ok && result.data?.app === APP_ID);
}

function isLegacyPetHealth(result) {
  const data = result?.data;
  if (!result?.ok || !data?.ok || data.app != null) return false;
  if (!Object.keys(data).every((key) => key === "ok" || key === "version")) return false;
  return /^0\.[0-3]\.\d+(?:\+[-.\w]+)?$/.test(String(data.version || ""));
}

function petHealthKind(result) {
  if (isPetHealth(result)) return "current";
  if (isLegacyPetHealth(result)) return "legacy";
  return null;
}

module.exports = { PORT, isLegacyPetHealth, isPetHealth, petHealthKind, requestPet };
