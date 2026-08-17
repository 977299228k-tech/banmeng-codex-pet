const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { CodexClient } = require("./codex-client.cjs");
const { APP_ID, isTrustedLocalRequest, publicStateSnapshot, readJsonBody } = require("./local-api.cjs");
const { readJsonWithBackup, writeJsonAtomic } = require("./persistence.cjs");
const {
  advanceLife,
  applyCareAction,
  applyInteraction,
  applyWorkEvent,
  chooseAutonomousAction,
  normalizeLife,
  performAutonomousAction
} = require("./life.cjs");
const { advanceWalk, clamp, contentSizeNeedsCorrection, createWalkDecision, idleDelay } = require("./motion.cjs");
const { mapHookEvent } = require("./state.cjs");
const packageInfo = require("../package.json");

const PORT = 47831;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 555;
let win;
let server;
let client;
let motionTimer;
let lifeTimer;
let idleTimer;
let sizeCorrectionTimer;
let correctingWindowSize = false;
let lifeStatePath;
let nextAutonomyAt = Date.now() + 15_000;
let state = {
  task: { mode: "idle", title: "待命中", detail: "随时可以开始", toolCount: 0, startedAt: null, updatedAt: Date.now() },
  quota: { connected: false },
  usage: null,
  account: null,
  motion: { mode: "idle", direction: "left", hovered: false, dragging: false },
  life: normalizeLife()
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

function emitReaction(reaction) {
  if (!reaction || !win || win.isDestroyed()) return;
  state.motion = { ...state.motion, lastInteraction: { ...reaction, at: Date.now() } };
  win.webContents.send("pet:reaction", reaction);
}

function loadLifeState() {
  const directory = path.join(app.getPath("appData"), "BANMENG Codex Pet");
  lifeStatePath = path.join(directory, "life-state.json");
  try {
    fs.mkdirSync(directory, { recursive: true });
    const saved = readJsonWithBackup(lifeStatePath);
    state.life = saved ? advanceLife(saved, Date.now()) : normalizeLife({}, Date.now());
  } catch {
    state.life = normalizeLife({}, Date.now());
  }
}

function saveLifeState() {
  if (!lifeStatePath || !state.life) return;
  try {
    writeJsonAtomic(lifeStatePath, state.life);
  } catch {}
}

function performCare(action) {
  if (!new Set(["feed", "play", "rest"]).has(action)) {
    const error = new Error("Unsupported care action");
    error.statusCode = 400;
    throw error;
  }
  const now = Date.now();
  const result = applyCareAction(state.life, action, now);
  state.life = result.life;
  nextAutonomyAt = now + 35_000;
  pauseMotion(Math.max(1_600, state.life.activityUntil - now));
  emitReaction(result.reaction);
  saveLifeState();
  broadcast();
  return { ok: true, ...result.reaction, life: state.life };
}

function startLifeLoop() {
  clearInterval(lifeTimer);
  nextAutonomyAt = Date.now() + 12_000 + Math.floor(Math.random() * 10_000);
  lifeTimer = setInterval(() => {
    const now = Date.now();
    state.life = advanceLife(state.life, now, { working: state.task.mode !== "idle" });
    if (state.task.mode === "idle" && !motion.hovered && !motion.dragging && now >= nextAutonomyAt) {
      const action = chooseAutonomousAction(state.life);
      const result = performAutonomousAction(state.life, action, now);
      state.life = result.life;
      if (result.reaction) {
        if (action === "explore") {
          motion.pausedUntil = now + 900;
          motion.nextDecisionAt = now + 900;
          setMotionMode("idle");
        } else {
          pauseMotion(result.duration);
        }
        emitReaction(result.reaction);
      }
      nextAutonomyAt = now + 22_000 + Math.floor(Math.random() * 24_000);
      saveLifeState();
    }
    broadcast();
  }, 5_000);
}

function applyTaskEvent(payload) {
  const next = mapHookEvent(payload);
  const previous = state.task;
  state.life = applyWorkEvent(state.life, payload.hook_event_name, Date.now());
  state.task = {
    ...previous,
    ...next,
    toolCount: next.resetTask ? 0 : previous.toolCount + (next.incrementTool ? 1 : 0),
    startedAt: next.clearTiming ? null : next.resetTask ? Date.now() : previous.startedAt,
    finishedAt: next.clearTiming || next.resetTask ? null : previous.finishedAt,
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
  saveLifeState();
  broadcast();
}

function triggerInteraction(kind = "pet") {
  if (!new Set(["pet", "double"]).has(kind)) {
    const error = new Error("Unsupported interaction");
    error.statusCode = 400;
    throw error;
  }
  const phrases = kind === "double"
    ? ["呀，被发现啦！", "今天也一起加油吧！", "跳一下，灵感就来了！"]
    : ["嗯？我在这里。", "摸摸收到。", "要开始新任务吗？", "休息一下也很好。"];
  const text = phrases[Math.floor(Math.random() * phrases.length)];
  pauseMotion(kind === "double" ? 1800 : 1100);
  state.life = applyInteraction(state.life, kind, Date.now());
  nextAutonomyAt = Date.now() + 30_000;
  state.motion = { ...state.motion, lastInteraction: { kind, text, at: Date.now() } };
  saveLifeState();
  broadcast();
  return { kind, text };
}

async function handleLocalRequest(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!isTrustedLocalRequest(request, PORT)) {
      response.statusCode = 403;
      response.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify({ ok: true, app: APP_ID, version: packageInfo.version }));
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      response.end(JSON.stringify(publicStateSnapshot(state)));
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
          viewport: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            devicePixelRatio: window.devicePixelRatio,
            visualWidth: window.visualViewport?.width,
            visualHeight: window.visualViewport?.height
          },
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
        contentBounds: win.getContentBounds(),
        zoomFactor: win.webContents.getZoomFactor(),
        motion: { ...state.motion, targetX: motion.targetX, speed: motion.speed }
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/event") {
      try {
        const payload = await readJsonBody(request);
        if (!payload || typeof payload !== "object" || typeof payload.hook_event_name !== "string") {
          throw Object.assign(new Error("Invalid hook event"), { statusCode: 400 });
        }
        applyTaskEvent(payload);
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.statusCode = error.statusCode || 400;
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/interact") {
      try {
        const result = triggerInteraction((await readJsonBody(request)).kind);
        win?.webContents.send("pet:reaction", result);
        response.end(JSON.stringify({ ok: true, ...result }));
      } catch (error) {
        response.statusCode = error.statusCode || 400;
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/care") {
      try {
        response.end(JSON.stringify(performCare((await readJsonBody(request)).action)));
      } catch (error) {
        response.statusCode = error.statusCode || 400;
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
}

function startLocalServer() {
  server = http.createServer((request, response) => {
    handleLocalRequest(request, response).catch((error) => {
      if (response.headersSent || response.writableEnded) return;
      response.statusCode = error.statusCode || 500;
      response.end(JSON.stringify({ ok: false, error: "Local API request failed" }));
    });
  });
  server.on("error", (error) => {
    console.error(`BANMENG local server failed: ${error.message}`);
    app.quit();
  });
  server.listen(PORT, "127.0.0.1");
}

function placeWindow(display = screen.getPrimaryDisplay()) {
  const area = display.workArea;
  const [width, height] = win.getSize();
  win.setPosition(area.x + area.width - width - 20, area.y + area.height - height, false);
}

function enforceWindowSize() {
  if (!win || win.isDestroyed() || correctingWindowSize) return;
  const [width, height] = win.getContentSize();
  if (!contentSizeNeedsCorrection(width, height, WINDOW_WIDTH, WINDOW_HEIGHT)) return;

  correctingWindowSize = true;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  win.setContentSize(WINDOW_WIDTH, WINDOW_HEIGHT, false);
  const [correctedWidth, correctedHeight] = win.getSize();
  win.setPosition(
    Math.round(clamp(bounds.x, area.x, area.x + area.width - correctedWidth)),
    Math.round(clamp(bounds.y, area.y, area.y + area.height - correctedHeight)),
    false
  );
  clearTimeout(sizeCorrectionTimer);
  sizeCorrectionTimer = setTimeout(() => { correctingWindowSize = false; }, 100);
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
    useContentSize: true,
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
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on("resize", enforceWindowSize);
  win.once("ready-to-show", () => {
    enforceWindowSize();
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
ipcMain.handle("pet:care", (_event, action) => performCare(action));
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
  const [width, height] = win.getSize();
  const x = clamp(Math.round(point.screenX - motion.dragOffset.x), area.x, area.x + area.width - width);
  const y = clamp(Math.round(point.screenY - motion.dragOffset.y), area.y, area.y + area.height - height);
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
    loadLifeState();
    createWindow();
    startLocalServer();
    startLifeLoop();
    client = new CodexClient();
    client.on("state", (value) => {
      state = { ...state, ...value, motion: state.motion, life: state.life };
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
  clearInterval(lifeTimer);
  clearTimeout(sizeCorrectionTimer);
  clearTimeout(idleTimer);
  saveLifeState();
  server?.close();
  client?.stop();
});
