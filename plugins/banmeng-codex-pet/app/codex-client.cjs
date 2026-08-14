const { EventEmitter } = require("node:events");
const { execFileSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { quotaSnapshot } = require("./state.cjs");

function findNativeCodex(appData) {
  if (process.platform !== "win32") return null;
  const explicit = process.env.CODEX_BIN;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const packageName = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const vendorRoot = path.join(
    appData,
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    packageName,
    "vendor",
    target
  );
  const candidates = [
    path.join(vendorRoot, "bin", "codex.exe"),
    path.join(vendorRoot, "codex", "codex.exe")
  ];
  const bundled = candidates.find((executable) => fs.existsSync(executable));
  if (bundled) return bundled;
  try {
    const discovered = execFileSync("where.exe", ["codex.exe"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\r?\n/).map((value) => value.trim()).find((value) => value && fs.existsSync(value));
    return discovered || null;
  } catch {
    return null;
  }
}

class CodexClient extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.buffer = "";
    this.requestId = 20;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.stopping = false;
    this.account = null;
    this.usage = null;
    this.quota = { connected: false };
  }

  start() {
    if (this.child) return;
    this.stopping = false;
    clearTimeout(this.reconnectTimer);
    const appData = process.env.APPDATA || "";
    const candidate = path.join(appData, "npm", "codex.cmd");
    const codexJs = path.join(path.dirname(candidate), "node_modules", "@openai", "codex", "bin", "codex.js");
    const nativeCodex = findNativeCodex(appData);
    const executable = nativeCodex || (fs.existsSync(codexJs) ? process.execPath : (process.env.ComSpec || "cmd.exe"));
    const args = nativeCodex
      ? ["app-server", "--stdio"]
      : fs.existsSync(codexJs)
        ? [codexJs, "app-server", "--stdio"]
      : ["/d", "/c", `${fs.existsSync(candidate) ? candidate : "codex.cmd"} app-server --stdio`];
    this.child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.on("data", (chunk) => this.emit("debug", chunk.toString("utf8")));
    this.child.on("error", (error) => this.emit("error", error));
    this.child.on("exit", () => {
      this.child = null;
      clearInterval(this.pollTimer);
      this.emit("offline");
      if (!this.stopping) this.reconnectTimer = setTimeout(() => this.start(), 2_000);
    });

    this.send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: { name: "banmeng_codex_pet", title: "BANMENG Codex Pet", version: "0.3.0" },
        capabilities: { experimentalApi: true }
      }
    });
  }

  send(message) {
    if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  consume(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handle(JSON.parse(line));
      } catch (error) {
        this.emit("debug", `Invalid app-server line: ${error.message}`);
      }
    }
  }

  handle(message) {
    if (message.id === 0 && message.result) {
      this.send({ method: "initialized", params: {} });
      this.refresh();
      this.pollTimer = setInterval(() => this.refresh(), 60_000);
      return;
    }
    if (message.id === 1) {
      this.account = message.result?.account || null;
      this.emitState();
      return;
    }
    if (message.id === 2) {
      this.quota = message.error ? { connected: false, error: message.error.message } : quotaSnapshot(message.result);
      this.emitState();
      return;
    }
    if (message.id === 3) {
      this.usage = message.result || null;
      this.emitState();
      return;
    }
    if (message.method === "account/rateLimits/updated") {
      this.refreshQuota();
    }
  }

  refresh() {
    this.send({ method: "account/read", id: 1, params: { refreshToken: false } });
    this.refreshQuota();
    this.send({ method: "account/usage/read", id: 3, params: {} });
  }

  refreshQuota() {
    this.send({ method: "account/rateLimits/read", id: 2, params: {} });
  }

  emitState() {
    this.emit("state", { account: this.account, quota: this.quota, usage: this.usage });
  }

  stop() {
    this.stopping = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnectTimer);
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { CodexClient, findNativeCodex };
