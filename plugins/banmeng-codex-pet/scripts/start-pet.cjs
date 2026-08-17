const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { isPetHealth, petHealthKind, requestPet } = require("./pet-http.cjs");
const packageInfo = require("../package.json");

const root = path.resolve(__dirname, "..");
const electronRoot = path.join(root, "node_modules", "electron");
const installLock = path.join(root, ".banmeng-install.lock");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findElectronExecutable() {
  try {
    const expectedVersion = String(packageInfo.dependencies.electron);
    const installedPackage = JSON.parse(fs.readFileSync(path.join(electronRoot, "package.json"), "utf8"));
    const relativePath = fs.readFileSync(path.join(electronRoot, "path.txt"), "utf8").trim();
    const executable = path.join(electronRoot, "dist", relativePath);
    const runtimeVersion = fs.readFileSync(path.join(electronRoot, "dist", "version"), "utf8").trim().replace(/^v/, "");
    return installedPackage.version === expectedVersion && runtimeVersion === expectedVersion && fs.existsSync(executable)
      ? executable
      : null;
  } catch {
    return null;
  }
}

async function ensureDependencies() {
  const existing = findElectronExecutable();
  if (existing) return existing;
  let lock;
  try {
    lock = fs.openSync(installLock, "wx");
    fs.writeFileSync(lock, String(Date.now()), "utf8");
  } catch {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const executable = findElectronExecutable();
      if (executable) return executable;
      if (!fs.existsSync(installLock)) return ensureDependencies();
      try {
        if (Date.now() - fs.statSync(installLock).mtimeMs > 12 * 60 * 1_000) {
          fs.unlinkSync(installLock);
          return ensureDependencies();
        }
      } catch {}
      await delay(1_000);
    }
    return null;
  }
  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd install --no-audit --no-fund"]
      : ["install", "--no-audit", "--no-fund"];
    const installPackages = require("node:child_process").spawnSync(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: "ignore",
      timeout: 10 * 60 * 1_000
    });
    if (installPackages.status !== 0) return null;
    if (!findElectronExecutable()) {
      const installScript = path.join(electronRoot, "install.js");
      const options = { cwd: root, windowsHide: true, stdio: "ignore", timeout: 10 * 60 * 1_000 };
      let installRuntime = require("node:child_process").spawnSync(process.execPath, [installScript], options);
      if (installRuntime.status !== 0 && !process.env.ELECTRON_MIRROR) {
        installRuntime = require("node:child_process").spawnSync(process.execPath, [installScript], {
          ...options,
          env: { ...process.env, ELECTRON_MIRROR: "https://npmmirror.com/mirrors/electron/" }
        });
      }
      if (installRuntime.status !== 0) return null;
    }
    return findElectronExecutable();
  } finally {
    if (lock != null) fs.closeSync(lock);
    try { fs.unlinkSync(installLock); } catch {}
  }
}

(async () => {
  const existing = await requestPet("/health");
  const existingKind = petHealthKind(existing);
  if (existingKind === "current" && existing.data.version === packageInfo.version) {
    await requestPet("/show", "POST");
    process.exit(0);
  }
  if (existingKind === "legacy" || existingKind === "current") {
    await requestPet("/quit", "POST");
    let stopped = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(100);
      if ((await requestPet("/health", "GET", null, 150)).statusCode == null) {
        stopped = true;
        break;
      }
    }
    if (!stopped) {
      console.error("The previous BANMENG Codex Pet process did not stop in time.");
      process.exit(1);
    }
  } else if (existing.statusCode != null) {
    console.error("Port 47831 is already used by another local application.");
    process.exit(1);
  }
  const electron = await ensureDependencies();
  if (!electron) {
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    if (isPetHealth(await requestPet("/health"))) process.exit(0);
  }
  console.error("BANMENG Codex Pet did not become ready in time.");
  process.exit(1);
})();
