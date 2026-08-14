const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { CodexClient } = require("./codex-client.cjs");
const { advanceWalk, clamp, createWalkDecision, idleDelay } = require("./motion.cjs");
const { mapHookEvent } = require("./state.cjs");
const packageInfo = require("../package.json");

const PORT = 47831;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 500;
let win;
let server;
let client;
let motionTimer;
let idleTimer;
let state = {
  task: { mode: "idle", title: "待命中", detail: "随时可以开始", toolCount: 0, startedAt: null, updatedAt: Date.now() },
  quota: { connected: false },
  usage: null,
  account: null,
  motion: { mode: "idle", direction: "left", hovered: false, dragging: false }
};

const motion = {
  mode: "idle",
  direction: "left",
  targetX: null,
  speed: 0,
  nextDecisionAt: Date.now() + 2200,
  lastTick: Date.now(),
  hovered: false,
  dragging: false,
  pausedUntil: 0,
  dragOffset: null
};

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("pet:state", state);
}

function publishMotion(force = false) {
  const next = {
    mode: motion.mode,
    direction: motion.direction,
    hovered: motion.hovered,
    dragging: motion.dragging
  };
  const changed = force || Object.keys(next).some((key) => state.motion?.[key] !== next[key]);
  if (!changed) return;
  state.motion = { ...state.motion, ...next, updatedAt: Date.now() };
  if (win && !win.isDestroyed()) {
    win.webContents.send("pet:motion", state.motion);
    win.webContents.send("pet:facing", motion.direction);
  }
}

function setMotionMode(mode, direction = motion.direction) {
  motion.mode = mode;
  motion.direction = direction;
  publishMotion();
}

function pauseMotion(duration = 900) {
  motion.pausedUntil = Math.max(motion.pausedUntil, Date.now() + duration);
  motion.targetX = null;
  setMotionMode("paused");
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

function triggerInteraction(kind = "pet") {
  const phrases = kind === "double"
    ? ["呀，被发现啦！", "今天也一起加油吧！", "跳一下，灵感就来了！"]
    : ["嗯？我在这里。", "摸摸收到。", "要开始新任务吗？", "休息一下也很好。"];
  const text = phrases[Math.floor(Math.random() * phrases.length)];
  pauseMotion(kind === "double" ? 1800 : 1100);
  state.motion = { ...state.motion, lastInteraction: { kind, text, at: Date.now() } };
  return { kind, text };
}

function startLocalServer() {
  server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify({ ok: true, version: packageInfo.version }));
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
      if (!win || win.isDestroyed()) {
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false, error: "Pet window is unavailable" }));
        return;
      }
      const diagnostics = await win.webContents.executeJavaScript(`(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const bounds = element?.getBoundingClientRect();
          return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
        };
        const image = document.querySelector('.character');
        const shell = document.querySelector('.pet-shell');
        return {
          readyState: document.readyState,
          text: document.body.innerText,
          shell: rect('.pet-shell'),
          panel: rect('.status-panel'),
          characterWrap: rect('.character-wrap'),
          character: rect('.character'),
          reaction: rect('.reaction-bubble'),
          dataset: { ...shell?.dataset },
          image: { complete: image?.complete, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, src: image?.currentSrc }
        };
      })()`, true);
      response.end(JSON.stringify({
        ...diagnostics,
        windowBounds: win.getBounds(),
        motion: { ...state.motion, targetX: motion.targetX, speed: motion.speed }
      }));
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
    if (request.method === "POST" && request.url === "/interact") {
      try {
        const result = triggerInteraction((await readBody(request)).kind);
        win?.webContents.send("pet:reaction", result);
        response.end(JSON.stringify({ ok: true, ...result }));
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
    if (request.method === "POST" && request.url === "/show") {
      response.end(JSON.stringify({ ok: revealWindow(true), windowBounds: win?.getBounds() || null }));
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

function placeWindow(display = screen.getPrimaryDisplay()) {
  const area = display.workArea;
  win.setPosition(area.x + area.width - WINDOW_WIDTH - 20, area.y + area.height - WINDOW_HEIGHT, false);
}

function revealWindow(reposition = false) {
  if (!win || win.isDestroyed()) return false;
  pauseMotion(8_000);
  motion.nextDecisionAt = motion.pausedUntil + idleDelay();
  if (reposition) placeWindow(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true, "floating");
  win.show();
  win.moveTop();
  win.focus();
  const reaction = { kind: "pet", text: "我在这里！" };
  state.motion = { ...state.motion, lastInteraction: { ...reaction, at: Date.now() } };
  win.webContents.send("pet:reaction", reaction);
  return win.isVisible();
}

function startMotionLoop() {
  clearInterval(motionTimer);
  motion.lastTick = Date.now();
  motionTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const deltaMs = now - motion.lastTick;
    motion.lastTick = now;

    if (state.task.mode !== "idle" || motion.hovered || motion.dragging || now < motion.pausedUntil) {
      if (!motion.dragging) setMotionMode("paused");
      return;
    }

    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const minX = area.x;
    const maxX = area.x + area.width - bounds.width;
    const safeY = clamp(bounds.y, area.y, area.y + area.height - bounds.height);

    if (motion.mode === "walking" && motion.targetX != null) {
      const step = advanceWalk({ x: bounds.x, targetX: motion.targetX, speed: motion.speed, deltaMs });
      win.setPosition(Math.round(clamp(step.x, minX, maxX)), Math.round(safeY), false);
      if (step.reached || step.x <= minX || step.x >= maxX) {
        motion.targetX = null;
        motion.nextDecisionAt = now + idleDelay();
        setMotionMode("idle");
      }
      return;
    }

    if (now >= motion.nextDecisionAt) {
      const decision = createWalkDecision({ x: bounds.x, minX, maxX });
      motion.targetX = decision.targetX;
      motion.speed = decision.speed;
      setMotionMode("walking", decision.direction);
    } else if (motion.mode !== "idle") {
      setMotionMode("idle");
    }
  }, 50);
}

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
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
  win.once("ready-to-show", () => {
    placeWindow();
    win.showInactive();
    publishMotion(true);
    startMotionLoop();
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      { label: "刷新额度", click: () => client?.refresh() },
      { label: "回到右下角", click: () => placeWindow(screen.getDisplayMatching(win.getBounds())) },
      { type: "separator" },
      { label: "退出桌宠", click: () => app.quit() }
    ]).popup({ window: win });
  });
}

function validPoint(point) {
  return Number.isFinite(point?.screenX) && Number.isFinite(point?.screenY);
}

ipcMain.handle("pet:get-state", () => state);
ipcMain.handle("pet:refresh-usage", () => { client?.refresh(); return true; });
ipcMain.handle("pet:interact", (_event, kind) => triggerInteraction(kind));
ipcMain.on("pet:hover", (_event, hovered) => {
  motion.hovered = Boolean(hovered);
  if (motion.hovered) pauseMotion(300);
  else {
    motion.pausedUntil = Date.now() + 650;
    motion.nextDecisionAt = motion.pausedUntil + idleDelay();
    setMotionMode("idle");
  }
  publishMotion();
});
ipcMain.on("pet:drag-start", (_event, point) => {
  if (!validPoint(point) || !win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  motion.dragOffset = { x: point.screenX - x, y: point.screenY - y };
  motion.dragging = true;
  motion.targetX = null;
  setMotionMode("dragging");
});
ipcMain.on("pet:drag-move", (_event, point) => {
  if (!motion.dragging || !motion.dragOffset || !validPoint(point) || !win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(point.screenX), y: Math.round(point.screenY) });
  const area = display.workArea;
  const x = clamp(Math.round(point.screenX - motion.dragOffset.x), area.x, area.x + area.width - WINDOW_WIDTH);
  const y = clamp(Math.round(point.screenY - motion.dragOffset.y), area.y, area.y + area.height - WINDOW_HEIGHT);
  win.setPosition(x, y, false);
});
ipcMain.on("pet:drag-end", () => {
  if (!motion.dragging) return;
  motion.dragging = false;
  motion.dragOffset = null;
  motion.pausedUntil = Date.now() + 900;
  motion.nextDecisionAt = motion.pausedUntil + idleDelay();
  setMotionMode("idle");
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => revealWindow(true));
  app.whenReady().then(() => {
    createWindow();
    startLocalServer();
    client = new CodexClient();
    client.on("state", (value) => {
      state = { ...state, ...value, motion: state.motion };
      broadcast();
    });
    client.on("offline", () => {
      state.quota = { connected: false, error: "Codex App Server 已断开" };
      broadcast();
    });
    client.start();
  });
}

app.on("before-quit", () => {
  clearInterval(motionTimer);
  clearTimeout(idleTimer);
  server?.close();
  client?.stop();
});
