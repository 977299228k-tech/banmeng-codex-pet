const TOOL_LABELS = [
  [/apply_patch|edit|write/i, ["正在编辑", "修改项目文件"]],
  [/shell|bash|command|exec/i, ["正在运行", "执行本地命令"]],
  [/web|search|browser|chrome/i, ["正在查找", "搜索和检查资料"]],
  [/image|view_image/i, ["处理图像", "生成或检查视觉素材"]],
  [/figma/i, ["整理设计", "同步设计内容"]],
  [/test|playwright/i, ["正在验证", "检查运行结果"]],
  [/request_user_input|permission/i, ["需要确认", "等待你的决定"]]
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function toolCopy(toolName = "") {
  const match = TOOL_LABELS.find(([pattern]) => pattern.test(toolName));
  return match ? match[1] : ["正在处理", toolName || "执行 Codex 工具"];
}

function truncate(value, max = 48) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function mapHookEvent(payload = {}) {
  const event = payload.hook_event_name || "Unknown";
  const base = { event, sessionId: payload.session_id || null, turnId: payload.turn_id || null };

  if (event === "SessionStart") return { ...base, mode: "idle", title: "已经上线", detail: "随时可以开始" };
  if (event === "UserPromptSubmit") return { ...base, mode: "running", title: "正在理解任务", detail: truncate(payload.prompt) || "读取你的要求", resetTask: true };
  if (event === "PreToolUse") {
    const [title, detail] = toolCopy(payload.tool_name);
    return { ...base, mode: "tool", title, detail, toolName: payload.tool_name || null, incrementTool: true };
  }
  if (event === "PermissionRequest") return { ...base, mode: "attention", title: "需要你的确认", detail: toolCopy(payload.tool_name)[1] };
  if (event === "PostToolUse") return { ...base, mode: "running", title: "继续处理", detail: `${toolCopy(payload.tool_name)[0]}已完成` };
  if (event === "PreCompact") return { ...base, mode: "thinking", title: "整理上下文", detail: "准备继续工作" };
  if (event === "PostCompact") return { ...base, mode: "running", title: "继续任务", detail: "上下文整理完成" };
  if (event === "SubagentStart") return { ...base, mode: "tool", title: "协同处理中", detail: payload.agent_type || "启动协作任务", incrementTool: true };
  if (event === "SubagentStop") return { ...base, mode: "running", title: "汇总结果", detail: "协作任务已返回" };
  if (event === "Stop") return { ...base, mode: "success", title: "任务完成", detail: "结果已经准备好", finishTask: true };
  if (event === "SessionEnd") return { ...base, mode: "idle", title: "回到待命", detail: "本次会话已结束", finishTask: true };
  return { ...base, mode: "running", title: "正在工作", detail: event };
}

function quotaSnapshot(result = {}) {
  const bucket = result.rateLimitsByLimitId?.codex || result.rateLimits || null;
  const primary = bucket?.primary || null;
  const secondary = bucket?.secondary || null;
  const usedPercent = primary?.usedPercent == null ? null : clamp(primary.usedPercent, 0, 100);
  const secondaryUsedPercent = secondary?.usedPercent == null ? null : clamp(secondary.usedPercent, 0, 100);
  return {
    connected: Boolean(bucket),
    limitId: bucket?.limitId || "codex",
    planType: bucket?.planType || result.planType || null,
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.round(100 - usedPercent),
    windowDurationMins: primary?.windowDurationMins ?? null,
    resetsAt: primary?.resetsAt ?? null,
    secondaryUsedPercent,
    secondaryRemainingPercent: secondaryUsedPercent == null ? null : Math.round(100 - secondaryUsedPercent),
    secondaryWindowDurationMins: secondary?.windowDurationMins ?? null,
    secondaryResetsAt: secondary?.resetsAt ?? null,
    reachedType: bucket?.rateLimitReachedType || null,
    resetCredits: result.rateLimitResetCredits?.availableCount ?? null
  };
}

module.exports = { mapHookEvent, quotaSnapshot, toolCopy, truncate };
