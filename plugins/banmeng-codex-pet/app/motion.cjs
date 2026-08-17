function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function idleDelay(random = Math.random) {
  return 2_400 + Math.floor(random() * 4_800);
}

function contentSizeNeedsCorrection(width, height, targetWidth, targetHeight, tolerance = 4) {
  return Math.abs(Number(width) - targetWidth) > tolerance
    || Math.abs(Number(height) - targetHeight) > tolerance;
}

function createWalkDecision({ x, minX, maxX }, random = Math.random) {
  const left = Math.min(minX, maxX);
  const right = Math.max(minX, maxX);
  const span = right - left;
  if (span < 2) return { targetX: left, direction: "left", speed: 0 };

  let direction = random() < 0.5 ? -1 : 1;
  const edgePadding = Math.min(90, span * 0.18);
  if (x <= left + edgePadding) direction = 1;
  if (x >= right - edgePadding) direction = -1;

  const distance = Math.max(80, span * (0.18 + random() * 0.34));
  const targetX = clamp(x + direction * distance, left, right);
  return {
    targetX,
    direction: direction > 0 ? "right" : "left",
    speed: 32 + random() * 28
  };
}

function advanceWalk({ x, targetX, speed, deltaMs }) {
  const distance = targetX - x;
  const step = Math.max(0, speed) * Math.max(0, Math.min(deltaMs, 120)) / 1_000;
  if (Math.abs(distance) <= step || step === 0) {
    return { x: step === 0 ? x : targetX, reached: step !== 0 };
  }
  return { x: x + Math.sign(distance) * step, reached: false };
}

module.exports = { advanceWalk, clamp, contentSizeNeedsCorrection, createWalkDecision, idleDelay };
