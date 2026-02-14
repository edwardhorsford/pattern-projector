export type PatternScaleAction =
  | { type: "delta"; delta: number }
  | { type: "set"; scale: string };

const MIN_PATTERN_SCALE = 0.25;
const MAX_PATTERN_SCALE = 10;
const BASE_DELTA_STEP = 0.1;
const SNAP_POINTS = [1, 2, 4];

function clampPatternScale(scale: number): number {
  return Math.max(MIN_PATTERN_SCALE, Math.min(MAX_PATTERN_SCALE, scale));
}

function getStepSize(scale: number): number {
  if (scale < 1) {
    return 0.05;
  }
  if (scale < 2) {
    return 0.1;
  }
  if (scale < 4) {
    return 0.25;
  }
  return 0.5;
}

export function applyPatternScaleDelta(
  currentScaleRaw: number,
  deltaRaw: number,
): number {
  if (!Number.isFinite(currentScaleRaw) || !Number.isFinite(deltaRaw)) {
    return clampPatternScale(currentScaleRaw);
  }

  if (deltaRaw === 0) {
    return clampPatternScale(currentScaleRaw);
  }

  const direction = Math.sign(deltaRaw);
  const stepCount = Math.max(
    1,
    Math.round(Math.abs(deltaRaw) / BASE_DELTA_STEP),
  );

  let nextScale = clampPatternScale(currentScaleRaw);

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const stepSize = getStepSize(nextScale);
    let stepped = nextScale + direction * stepSize;

    for (const snapPoint of SNAP_POINTS) {
      if (direction > 0 && nextScale < snapPoint && stepped > snapPoint) {
        stepped = snapPoint;
      }
      if (direction < 0 && nextScale > snapPoint && stepped < snapPoint) {
        stepped = snapPoint;
      }
    }

    nextScale = clampPatternScale(stepped);
  }

  return nextScale;
}

export default function PatternScaleReducer(
  patternScale: string,
  action: PatternScaleAction,
): string {
  switch (action.type) {
    case "set": {
      const next = Number(action.scale);
      if (!Number.isFinite(next) || action.scale.trim() === "") {
        return action.scale;
      }
      return clampPatternScale(next).toFixed(2);
    }
    case "delta": {
      const currentScale = Number(patternScale);
      if (!Number.isFinite(currentScale)) {
        return patternScale;
      }
      return applyPatternScaleDelta(currentScale, action.delta).toFixed(2);
    }
  }
}
