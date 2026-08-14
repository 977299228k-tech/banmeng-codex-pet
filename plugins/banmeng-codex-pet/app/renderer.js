const shell = document.getElementById("petShell");
const statusKicker = document.getElementById("statusKicker");
const statusTitle = document.getElementById("statusTitle");
const statusDetail = document.getElementById("statusDetail");
const taskMeta = document.getElementById("taskMeta");
const quotaRing = document.getElementById("quotaRing");
const quotaValue = document.getElementById("quotaValue");
const resetTime = document.getElementById("resetTime");
const usageSummary = document.getElementById("usageSummary");
const characterWrap = document.getElementById("characterWrap");
const characterFlip = document.getElementById("characterFlip");
const reactionBubble = document.getElementById("reactionBubble");
let latestState;
let timer;
let reactionTimer;
let clickTimer;
let pointerStart;
let dragged = false;

function relativeReset(timestamp) {
  if (!timestamp) return "等待额度数据";
  const seconds = Math.max(0, Number(timestamp) - Math.floor(Date.now() / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}小时${minutes}分后重置` : `${Math.max(1, minutes)}分钟后重置`;
}

function compactNumber(value) {
  if (value == null) return "";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function elapsed(task) {
  if (!task?.startedAt || task.mode === "idle" || task.mode === "success") {
    return task?.toolCount ? `本次执行 ${task.toolCount} 个动作` : "没有进行中的任务";
  }
  const seconds = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes ? `${minutes}分` : ""}${seconds % 60}秒 · ${task.toolCount || 0} 个动作`;
}

function applyMotion(motion = {}) {
  shell.dataset.motion = motion.mode || "idle";
  shell.dataset.facing = motion.direction || shell.dataset.facing || "left";
  shell.dataset.dragging = String(Boolean(motion.dragging));
}

function render(state) {
  latestState = state;
  const task = state.task || {};
  const quota = state.quota || {};
  const summary = state.usage?.summary || {};
  shell.dataset.mode = task.mode || "idle";
  applyMotion(state.motion);
  statusKicker.textContent = `CODEX · ${(task.mode || "idle").toUpperCase()}`;
  statusTitle.textContent = task.title || "待命中";
  statusDetail.textContent = task.detail || "随时可以开始";
  taskMeta.textContent = elapsed(task);

  if (quota.connected && quota.remainingPercent != null) {
    quotaRing.style.setProperty("--remaining", quota.remainingPercent);
    quotaValue.textContent = `${quota.remainingPercent}%`;
    resetTime.textContent = relativeReset(quota.resetsAt);
  } else {
    quotaRing.style.setProperty("--remaining", 0);
    quotaValue.textContent = "--";
    resetTime.textContent = quota.error || "正在连接额度";
  }
  const plan = state.account?.planType || quota.planType || "ChatGPT";
  usageSummary.textContent = summary.lifetimeTokens ? `${plan} · ${compactNumber(summary.lifetimeTokens)} tokens` : plan;
}

function showReaction({ kind = "pet", text = "嗯？" } = {}) {
  clearTimeout(reactionTimer);
  shell.dataset.reaction = "";
  void shell.offsetWidth;
  reactionBubble.textContent = text;
  reactionBubble.classList.add("is-visible");
  shell.dataset.reaction = kind;
  reactionTimer = setTimeout(() => {
    reactionBubble.classList.remove("is-visible");
    shell.dataset.reaction = "";
  }, kind === "double" ? 1900 : 1400);
}

function screenPoint(event) {
  return { screenX: event.screenX, screenY: event.screenY };
}

async function react(kind) {
  showReaction(await window.petApi.interact(kind));
}

quotaRing.addEventListener("click", () => window.petApi.refreshUsage());
characterWrap.addEventListener("pointerenter", () => window.petApi.setHovered(true));
characterWrap.addEventListener("pointerleave", () => {
  if (!pointerStart) window.petApi.setHovered(false);
  characterFlip.style.setProperty("--look-x", "0px");
  characterFlip.style.setProperty("--look-angle", "0deg");
});
characterWrap.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerStart = { x: event.screenX, y: event.screenY, pointerId: event.pointerId };
  dragged = false;
  characterWrap.setPointerCapture(event.pointerId);
  window.petApi.beginDrag(screenPoint(event));
});
characterWrap.addEventListener("pointermove", (event) => {
  if (pointerStart) {
    if (Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 4) dragged = true;
    if (dragged) window.petApi.dragMove(screenPoint(event));
    return;
  }
  const bounds = characterWrap.getBoundingClientRect();
  const ratio = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
  characterFlip.style.setProperty("--look-x", `${(ratio * 3).toFixed(1)}px`);
  characterFlip.style.setProperty("--look-angle", `${(ratio * 0.8).toFixed(2)}deg`);
});

function finishPointer(event) {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
  const wasDragged = dragged;
  pointerStart = null;
  dragged = false;
  window.petApi.endDrag();
  window.petApi.setHovered(characterWrap.matches(":hover"));
  if (!wasDragged) {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => react("pet"), 230);
  }
}

characterWrap.addEventListener("pointerup", finishPointer);
characterWrap.addEventListener("pointercancel", finishPointer);
characterWrap.addEventListener("dblclick", () => {
  clearTimeout(clickTimer);
  react("double");
});

window.petApi.onState(render);
window.petApi.onFacing((direction) => { shell.dataset.facing = direction; });
window.petApi.onMotion(applyMotion);
window.petApi.onReaction(showReaction);
window.petApi.getState().then(render);
timer = setInterval(() => latestState && render(latestState), 30_000);
window.addEventListener("beforeunload", () => {
  clearInterval(timer);
  clearTimeout(reactionTimer);
  clearTimeout(clickTimer);
});
