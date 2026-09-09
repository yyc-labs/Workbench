export type GesturePoint = { x: number; y: number }

export type CircleFit = {
  centerX: number
  centerY: number
  meanRadius: number
  radiusStd: number
}

export type TrajectoryStats = {
  netDistance: number
  pathLength: number
  straightness: number
}

export const GESTURE_ACTIVATE_DISTANCE = 8
export const GESTURE_SAMPLE_MIN_DISTANCE = 4
export const GESTURE_MAX_POINTS = 128
export const GESTURE_HORIZONTAL_THRESHOLD = 72
export const GESTURE_VERTICAL_DOWN_THRESHOLD = 72
export const GESTURE_VERTICAL_UP_THRESHOLD = 72
export const GESTURE_ANGLE_RATIO = 1.25
export const GESTURE_JITTER_LOCK_DISTANCE = 3
export const SWIPE_MIN_STRAIGHTNESS = 0.72
export const SCRIBBLE_MIN_PATH_LENGTH = 120
export const SCRIBBLE_MAX_STRAIGHTNESS = 0.45

export const CIRCLE_MIN_POINTS = 16
export const CIRCLE_MIN_DIAMETER = 44
export const CIRCLE_MAX_ASPECT_RATIO = 1.8
export const CIRCLE_MIN_RADIUS = 16
export const CIRCLE_MAX_RADIUS_STD_RATIO = 0.42
export const CIRCLE_CLOSURE_RATIO = 0.9
export const CIRCLE_MIN_SWEEP_RAD = Math.PI * 1.45
export const CIRCLE_MIN_PATH_RATIO = 0.65
export const CIRCLE_MAX_PATH_RATIO = 2.25

const CIRCLE_TRIM_FRACTIONS = [0, 0.1, 0.2, 0.3, 0.4]

/**
 * Kasa algebraic circle fit (least squares). Solves x² + y² = 2a·x + 2b·y + c
 * via the 3×3 normal equations. Returns null when the points are
 * (near-)collinear or the fit degenerates.
 */
export function fitCircle(points: GesturePoint[]): CircleFit | null {
  if (points.length < 3) return null

  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  let sxz = 0
  let syz = 0
  let sz = 0
  for (const point of points) {
    const z = point.x * point.x + point.y * point.y
    sx += point.x
    sy += point.y
    sxx += point.x * point.x
    syy += point.y * point.y
    sxy += point.x * point.y
    sxz += point.x * z
    syz += point.y * z
    sz += z
  }

  // Normal equations for unknowns [a, b, c]:
  // [ Sxx Sxy Sx ] [a]   [Sxz]
  // [ Sxy Syy Sy ] [b] = [Syz]
  // [ Sx  Sy  n  ] [c]   [Sz ]
  const solution = solveLinear3x3([sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length], [sxz, syz, sz])
  if (!solution) return null
  // The unknowns are (2a, 2b, c) for center (a, b), so halve the first two.
  const centerX = solution[0] / 2
  const centerY = solution[1] / 2
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null

  const radii = points.map((point) => Math.hypot(point.x - centerX, point.y - centerY))
  const meanRadius = radii.reduce((sum, value) => sum + value, 0) / radii.length
  if (!Number.isFinite(meanRadius) || meanRadius <= 0) return null

  const variance =
    radii.reduce((sum, value) => {
      const delta = value - meanRadius
      return sum + delta * delta
    }, 0) / radii.length

  return {
    centerX,
    centerY,
    meanRadius,
    radiusStd: Math.sqrt(variance),
  }
}

function solveLinear3x3(row0: [number, number, number], row1: [number, number, number], row2: [number, number, number], rhs: [number, number, number]): [number, number, number] | null {
  const m = [
    [row0[0], row0[1], row0[2], rhs[0]],
    [row1[0], row1[1], row1[2], rhs[1]],
    [row2[0], row2[1], row2[2], rhs[2]],
  ] as Array<[number, number, number, number]>

  for (let col = 0; col < 3; col++) {
    let pivotRow = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(m[pivotRow][col]) < 1e-9) return null
    if (pivotRow !== col) {
      const temp = m[col]
      m[col] = m[pivotRow]
      m[pivotRow] = temp
    }
    for (let row = col + 1; row < 3; row++) {
      const factor = m[row][col] / m[col][col]
      for (let k = col; k < 4; k++) {
        m[row][k] -= factor * m[col][k]
      }
    }
  }

  const result: [number, number, number] = [0, 0, 0]
  for (let row = 2; row >= 0; row--) {
    let sum = m[row][3]
    for (let col = row + 1; col < 3; col++) {
      sum -= m[row][col] * result[col]
    }
    result[row] = sum / m[row][row]
  }
  return result
}

export function computeTrajectoryStats(points: GesturePoint[]): TrajectoryStats {
  if (points.length < 2) {
    return { netDistance: 0, pathLength: 0, straightness: 1 }
  }

  let pathLength = 0
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  const netDistance = Math.hypot(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y)

  return {
    netDistance,
    pathLength,
    straightness: pathLength > 0 ? netDistance / pathLength : 1,
  }
}

export function isStraightSwipe(stats: TrajectoryStats): boolean {
  return stats.straightness >= SWIPE_MIN_STRAIGHTNESS
}

export function isScribble(stats: TrajectoryStats): boolean {
  return stats.pathLength >= SCRIBBLE_MIN_PATH_LENGTH && stats.straightness < SCRIBBLE_MAX_STRAIGHTNESS
}

function detectCircleOnSubset(points: GesturePoint[]): boolean {
  if (points.length < CIRCLE_MIN_POINTS) return false

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  const width = maxX - minX
  const height = maxY - minY
  if (width < CIRCLE_MIN_DIAMETER || height < CIRCLE_MIN_DIAMETER) return false

  const aspectRatio = width > height ? width / height : height / width
  if (aspectRatio > CIRCLE_MAX_ASPECT_RATIO) return false

  const fit = fitCircle(points)
  if (!fit) return false
  if (fit.meanRadius < CIRCLE_MIN_RADIUS) return false
  if (fit.radiusStd / fit.meanRadius > CIRCLE_MAX_RADIUS_STD_RATIO) return false

  const first = points[0]
  const last = points[points.length - 1]
  const closureDistance = Math.hypot(last.x - first.x, last.y - first.y)
  if (closureDistance > Math.max(CIRCLE_MIN_RADIUS, fit.meanRadius) * CIRCLE_CLOSURE_RATIO) {
    return false
  }

  let sweep = 0
  let previousAngle = Math.atan2(first.y - fit.centerY, first.x - fit.centerX)
  for (let i = 1; i < points.length; i++) {
    const current = points[i]
    const angle = Math.atan2(current.y - fit.centerY, current.x - fit.centerX)
    sweep += normalizeDeltaAngle(angle - previousAngle)
    previousAngle = angle
  }
  if (Math.abs(sweep) < CIRCLE_MIN_SWEEP_RAD) return false

  let pathLength = 0
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  const expectedCircumference = Math.PI * 2 * fit.meanRadius
  const pathRatio = pathLength / Math.max(expectedCircumference, 1)
  if (pathRatio < CIRCLE_MIN_PATH_RATIO || pathRatio > CIRCLE_MAX_PATH_RATIO) return false

  return true
}

/**
 * Detects a circle gesture. The trajectory may include a leading approach
 * segment before the actual loop, so the detection retries on head-trimmed
 * suffixes of the path.
 */
export function detectCircleGesture(points: GesturePoint[]): boolean {
  if (points.length < CIRCLE_MIN_POINTS) return false
  for (const fraction of CIRCLE_TRIM_FRACTIONS) {
    const start = Math.floor(points.length * fraction)
    if (points.length - start < CIRCLE_MIN_POINTS) break
    if (detectCircleOnSubset(points.slice(start))) return true
  }
  return false
}

function normalizeDeltaAngle(value: number): number {
  let result = value
  const fullTurn = Math.PI * 2
  while (result > Math.PI) result -= fullTurn
  while (result < -Math.PI) result += fullTurn
  return result
}
