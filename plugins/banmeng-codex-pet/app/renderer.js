const shell = document.getElementById("petShell");
const statusKicker = document.getElementById("statusKicker");
const statusTitle = document.getElementById("statusTitle");
const statusDetail = document.getElementById("statusDetail");
const taskMeta = document.getElementById("taskMeta");
const quotaRing = document.getElementById("quotaRing");
const quotaValue = document.getElementById("quotaValue");
const resetTime = document.getElementById("resetTime");
const usageSummary = document.getElementById("usageSummary");
let latestState;
let timer;

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
  if (!task?.startedAt || task.mode === "idle" || task.mode === "success") return task?.toolCount ? `本次执行 ${task.toolCount} 个动作` : "没有进行中的任务";
  const seconds = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes ? `${minutes}分` : ""}${seconds % 60}秒 · ${task.toolCount || 0} 个动作`;
}

function render(state) {
  latestState = state;
  const task = state.task || {};
  const quota = state.quota || {};
  const summary = state.usage?.summary || {};
  shell.dataset.mode = task.mode || "idle";
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

quotaRing.addEventListener("click", () => window.petApi.refreshUsage());
window.petApi.onState(render);
window.petApi.onFacing((direction) => { shell.dataset.facing = direction; });
window.petApi.getState().then(render);
timer = setInterval(() => latestState && render(latestState), 30_000);
window.addEventListener("beforeunload", () => clearInterval(timer));
