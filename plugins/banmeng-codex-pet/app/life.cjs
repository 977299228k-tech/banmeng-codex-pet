const HOUR = 60 * 60 * 1_000;

const DEFAULT_TRAITS = Object.freeze({
  curiosity: 72,
  playfulness: 78,
  independence: 64
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value) {
  return Math.round(clamp(value) * 10_000) / 10_000;
}

function moodFrom(life) {
  if (life.satiety <= 20) return { key: "hungry", label: "饿了" };
  if (life.energy <= 18) return { key: "sleepy", label: "困倦" };
  if (life.mood <= 25) return { key: "lonely", label: "想陪伴" };
  if (life.mood >= 88) return { key: "delighted", label: "超开心" };
  if (life.mood >= 68) return { key: "happy", label: "开心" };
  if (life.mood >= 42) return { key: "calm", label: "平静" };
  return { key: "bored", label: "有点无聊" };
}

function normalizeLife(value = {}, now = Date.now()) {
  const traits = { ...DEFAULT_TRAITS, ...(value.traits || {}) };
  const life = {
    satiety: round(value.satiety ?? 76),
    mood: round(value.mood ?? 78),
    energy: round(value.energy ?? 72),
    bond: Math.max(0, Math.round(Number(value.bond) || 0)),
    traits: {
      curiosity: round(traits.curiosity),
      playfulness: round(traits.playfulness),
      independence: round(traits.independence)
    },
    activity: value.activity || "idle",
    activityUntil: Number(value.activityUntil) || 0,
    lastAction: value.lastAction || null,
    lastCareAt: Number(value.lastCareAt) || null,
    lastAutonomyAt: Number(value.lastAutonomyAt) || null,
    lastUpdatedAt: Number(value.lastUpdatedAt) || now
  };
  if (life.activityUntil <= now) {
    life.activity = "idle";
    life.activityUntil = 0;
  }
  return { ...life, ...moodFrom(life) };
}

function applyDelta(value, delta = {}, now = Date.now()) {
  const life = normalizeLife(value, now);
  return normalizeLife({
    ...life,
    satiety: life.satiety + (delta.satiety || 0),
    mood: life.mood + (delta.mood || 0),
    energy: life.energy + (delta.energy || 0),
    bond: life.bond + (delta.bond || 0),
    activity: delta.activity ?? life.activity,
    activityUntil: delta.activityUntil ?? life.activityUntil,
    lastAction: delta.lastAction ?? life.lastAction,
    lastCareAt: delta.lastCareAt ?? life.lastCareAt,
    lastAutonomyAt: delta.lastAutonomyAt ?? life.lastAutonomyAt,
    lastUpdatedAt: now
  }, now);
}

function advanceLife(value, now = Date.now(), { working = false } = {}) {
  const life = normalizeLife(value, now);
  const elapsedHours = Math.min(72, Math.max(0, now - life.lastUpdatedAt) / HOUR);
  if (!elapsedHours) return life;

  const hungerMoodPenalty = life.satiety < 35 ? (35 - life.satiety) * 0.018 : 0;
  const tiredMoodPenalty = life.energy < 25 ? (25 - life.energy) * 0.012 : 0;
  return applyDelta(life, {
    satiety: -1.35 * elapsedHours,
    mood: -(0.22 + hungerMoodPenalty + tiredMoodPenalty) * elapsedHours,
    energy: (working ? -1.5 : 0.85) * elapsedHours
  }, now);
}

function applyCareAction(value, action, now = Date.now()) {
  const life = advanceLife(value, now);
  if (action === "feed") {
    if (life.satiety >= 97) return { life, reaction: { kind: "eat", text: "已经很饱啦，留着晚点吃。" } };
    return {
      life: applyDelta(life, { satiety: 22, mood: 3, energy: 2, bond: 1, activity: "eat", activityUntil: now + 2_800, lastAction: "feed", lastCareAt: now }, now),
      reaction: { kind: "eat", text: "这个很好吃，谢谢你。" }
    };
  }
  if (action === "play") {
    if (life.energy <= 12) return { life, reaction: { kind: "sleep", text: "有点困啦，先让我缓一缓。" } };
    return {
      life: applyDelta(life, { satiety: -3, mood: 14, energy: -7, bond: 2, activity: "play", activityUntil: now + 3_200, lastAction: "play", lastCareAt: now }, now),
      reaction: { kind: "play", text: "好呀，一起玩一会儿！" }
    };
  }
  if (action === "rest") {
    return {
      life: applyDelta(life, { satiety: -1, mood: 2, energy: 20, activity: "sleep", activityUntil: now + 8_000, lastAction: "rest", lastCareAt: now }, now),
      reaction: { kind: "sleep", text: "那我眯一小会儿。" }
    };
  }
  return { life, reaction: { kind: "pet", text: "嗯？" } };
}

function applyInteraction(value, kind, now = Date.now()) {
  const delta = kind === "double"
    ? { mood: 4, energy: -1, bond: 2, lastAction: "double-pet", lastCareAt: now }
    : { mood: 2, bond: 1, lastAction: "pet", lastCareAt: now };
  return applyDelta(advanceLife(value, now), delta, now);
}

function applyWorkEvent(value, event, now = Date.now()) {
  const deltas = {
    UserPromptSubmit: { satiety: -0.3, mood: 0.5, energy: -1 },
    PreToolUse: { satiety: -0.08, energy: -0.25 },
    PermissionRequest: { mood: -0.5 },
    Stop: { satiety: -0.4, mood: 4, energy: -1.5, bond: 1 },
    SessionEnd: { mood: 1, energy: 1 }
  };
  return applyDelta(advanceLife(value, now, { working: event !== "SessionEnd" }), deltas[event] || {}, now);
}

function chooseAutonomousAction(value, random = Math.random) {
  const life = normalizeLife(value);
  const jitter = () => random() * 14;
  const scores = {
    idle: 18 + jitter(),
    snack: life.satiety < 48 ? (55 - life.satiety) * 2.2 + life.traits.independence * 0.18 + jitter() : -1,
    rest: life.energy < 48 ? (55 - life.energy) * 2 + jitter() : -1,
    "seek-attention": life.mood < 56 ? (62 - life.mood) * 1.9 + (100 - life.traits.independence) * 0.2 + jitter() : -1,
    explore: life.satiety > 28 && life.energy > 28 ? life.traits.curiosity * 0.48 + jitter() : -1,
    play: life.satiety > 30 && life.energy > 34 ? life.traits.playfulness * 0.42 + (100 - life.mood) * 0.22 + jitter() : -1,
    stretch: 14 + life.energy * 0.12 + jitter()
  };
  if (life.lastAction && scores[life.lastAction] != null) scores[life.lastAction] -= 18;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function performAutonomousAction(value, action, now = Date.now()) {
  const life = advanceLife(value, now);
  const actions = {
    snack: { delta: { satiety: 14, mood: 2, energy: 1 }, kind: "eat", text: "有点饿，我自己找了块小饼干。", duration: 3_000 },
    rest: { delta: { satiety: -1, mood: 1, energy: 14 }, kind: "sleep", text: "我要眯一会儿，等下再出发。", duration: 9_000 },
    "seek-attention": { delta: { mood: 1 }, kind: "attention", text: "忙完的话，可以陪我一会儿吗？", duration: 4_000 },
    explore: { delta: { satiety: -1, mood: 3, energy: -3 }, kind: "explore", text: "那边好像有点新鲜，我去看看。", duration: 2_600 },
    play: { delta: { satiety: -1, mood: 4, energy: -4 }, kind: "play", text: "突然想活动一下！", duration: 3_200 },
    stretch: { delta: { mood: 1, energy: 2 }, kind: "stretch", text: "伸个懒腰，精神多了。", duration: 2_400 }
  };
  if (!actions[action]) {
    return { life: applyDelta(life, { lastAction: "idle", lastAutonomyAt: now }, now), reaction: null, duration: 0 };
  }
  const choice = actions[action];
  return {
    life: applyDelta(life, {
      ...choice.delta,
      activity: choice.kind,
      activityUntil: now + choice.duration,
      lastAction: action,
      lastAutonomyAt: now
    }, now),
    reaction: { kind: choice.kind, text: choice.text },
    duration: choice.duration
  };
}

module.exports = {
  advanceLife,
  applyCareAction,
  applyInteraction,
  applyWorkEvent,
  chooseAutonomousAction,
  moodFrom,
  normalizeLife,
  performAutonomousAction
};
