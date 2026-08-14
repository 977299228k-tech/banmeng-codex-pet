const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { CodexClient } = require("./codex-client.cjs");
const { mapHookEvent } = require("./state.cjs");

const PORT = 47831;
let win;
let server;
let client;
let walkTimer;
let idleTimer;
let state = {
  task: { mode: "idle", title: "待命中", detail: "随时可以开始", toolCount: 0, startedAt: null, updatedAt: Date.now() },
  quota: { connected: false },
  usage: null,
  account: null
};

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("pet:state", state);
}

function applyTaskEvent(payload) {
  const next = mapHookEvent(payload);
  const previous = state.task;
  state.task = {
    ...previous,
    ...next,
    toolCount: next.resetTask ? 0 : previous.toolCount + (next.incrementTool ? 1 : 0),
    startedAt: next.resetTask ? Date.now() : previous.startedAt,
    updatedAt: Date.now()
  };
  if (next.finishTask) state.task.finishedAt = Date.now();
  clearTimeout(idleTimer);
  if (next.mode === "success") {
    idleTimer = setTimeout(() => {
      state.task = { ...state.task, mode: "idle", title: "待命中", detail: "任务已经完成", updatedAt: Date.now() };
      broadcast();
    }, 12_000);
  }
  broadcast();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function startLocalServer() {
  server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify({ ok: true, version: app.getVersion() }));
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      response.end(JSON.stringify(state));
      return;
    }
    if (request.method === "GET" && request.url === "/snapshot") {
      if (!win || win.isDestroyed()) {
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false, error: "Pet window is unavailable" }));
        return;
      }
      const image = await win.webContents.capturePage();
      response.setHeader("Content-Type", "image/png");
      response.end(image.toPNG());
      return;
    }
    if (request.method === "GET" && request.url === "/diagnostics") {
      const diagnostics = await win.webContents.executeJavaScript(`(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const bounds = element?.getBoundingClientRect();
          return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
        };
        const image = document.querySelector('.character');
        return {
          readyState: document.readyState,
          text: document.body.innerText,
          shell: rect('.pet-shell'),
          panel: rect('.status-panel'),
          characterWrap: rect('.character-wrap'),
          character: rect('.character'),
          image: { complete: image?.complete, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, src: image?.currentSrc }
        };
      })()`, true);
      response.end(JSON.stringify(diagnostics));
      return;
    }
    if (request.method === "POST" && request.url === "/event") {
      try {
        applyTaskEvent(await readBody(request));
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/refresh") {
      client?.refresh();
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && request.url === "/quit") {
      response.end(JSON.stringify({ ok: true }));
      setTimeout(() => app.quit(), 50);
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });
  server.listen(PORT, "127.0.0.1");
}

function placeWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - 360, area.y + area.height - 530, false);
}

function startWalking() {
  clearInterval(walkTimer);
  let direction = -1;
  walkTimer = setInterval(() => {
    if (!win || win.isDestroyed() || state.task.mode === "attention") return;
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const [x, y] = win.getPosition();
    const target = Math.max(area.x, Math.min(area.x + area.width - 340, x + direction * 34));
    win.webContents.send("pet:facing", direction > 0 ? "right" : "left");
    win.setPosition(target, y, true);
    direction *= -1;
  }, 24_000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 500,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "index.html"));
  win.once("ready-to-show", () => { placeWindow(); win.showInactive(); });
  win.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      { label: "刷新额度", click: () => client?.refresh() },
      { label: "回到右下角", click: placeWindow },
      { type: "separator" },
      { label: "退出桌宠", click: () => app.quit() }
    ]).popup({ window: win });
  });
  startWalking();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => win?.showInactive());
  app.whenReady().then(() => {
    createWindow();
    startLocalServer();
    client = new CodexClient();
    client.on("state", (value) => {
      state = { ...state, ...value };
      broadcast();
    });
    client.on("offline", () => {
      state.quota = { connected: false, error: "Codex App Server 已断开" };
      broadcast();
    });
    client.start();
  });
}

ipcMain.handle("pet:get-state", () => state);
ipcMain.handle("pet:refresh-usage", () => { client?.refresh(); return true; });

app.on("before-quit", () => {
  clearInterval(walkTimer);
  clearTimeout(idleTimer);
  server?.close();
  client?.stop();
});
