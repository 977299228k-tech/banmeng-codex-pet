const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const port = 47831;
const electron = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const installLock = path.join(root, ".banmeng-install.lock");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureDependencies() {
  if (fs.existsSync(electron)) return true;
  let lock;
  try {
    lock = fs.openSync(installLock, "wx");
  } catch {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (fs.existsSync(electron)) return true;
      await delay(1_000);
    }
    return false;
  }
  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd install --no-audit --no-fund"]
      : ["install", "--no-audit", "--no-fund"];
    const result = require("node:child_process").spawnSync(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: "ignore",
      timeout: 10 * 60 * 1_000
    });
    return result.status === 0 && fs.existsSync(electron);
  } finally {
    if (lock != null) fs.closeSync(lock);
    try { fs.unlinkSync(installLock); } catch {}
  }
}

function isRunning() {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
}

(async () => {
  if (await isRunning()) process.exit(0);
  if (!(await ensureDependencies())) {
    console.error("BANMENG Codex Pet could not install its runtime dependencies.");
    process.exit(1);
  }
  const child = spawn(electron, [path.join(root, "app", "main.cjs")], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
})();
