import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { computeTrajectoryStats, detectCircleGesture, fitCircle, isScribble, isStraightSwipe } = loadTsModule('src/core/renderer/lib/mouseGestureRecognition.ts')

function circlePoints(centerX, centerY, radius, startAngle = 0, endAngle = Math.PI * 2, steps = 36) {
  const points = []
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps)
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    })
  }
  return points
}

function linePoints(x0, y0, x1, y1, steps = 20) {
  const points = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })
  }
  return points
}

function zigzagPoints(stepX, amplitude, count) {
  const points = [{ x: 0, y: 0 }]
  for (let i = 1; i <= count; i++) {
    points.push({ x: i * stepX, y: i % 2 === 0 ? 0 : amplitude })
  }
  return points
}

test('fitCircle recovers center and radius of a perfect circle', () => {
  const fit = fitCircle(circlePoints(200, 150, 40))
  assert.ok(fit)
  assert.ok(Math.abs(fit.centerX - 200) < 0.5, `centerX ${fit.centerX}`)
  assert.ok(Math.abs(fit.centerY - 150) < 0.5, `centerY ${fit.centerY}`)
  assert.ok(Math.abs(fit.meanRadius - 40) < 0.5, `radius ${fit.meanRadius}`)
  assert.ok(fit.radiusStd < 0.5, `radiusStd ${fit.radiusStd}`)
})

test('fitCircle rejects nearly collinear points', () => {
  assert.equal(fitCircle(linePoints(0, 0, 120, 8, 24)), null)
})

test('detectCircleGesture accepts a hand-drawn circle', () => {
  assert.equal(detectCircleGesture(circlePoints(300, 300, 40)), true)
})

test('detectCircleGesture accepts a circle drawn after an approach segment', () => {
  const leadIn = linePoints(30, 300, 260, 300, 15)
  const loop = circlePoints(300, 300, 40)
  assert.equal(detectCircleGesture([...leadIn, ...loop]), true)
})

test('detectCircleGesture accepts a small circle near the minimum diameter', () => {
  assert.equal(detectCircleGesture(circlePoints(300, 300, 24)), true)
})

test('detectCircleGesture rejects a C-shaped arc', () => {
  assert.equal(detectCircleGesture(circlePoints(300, 300, 40, -Math.PI * 0.75, Math.PI * 0.75)), false)
})

test('detectCircleGesture rejects a straight swipe', () => {
  assert.equal(detectCircleGesture(linePoints(100, 300, 300, 300, 40)), false)
})

test('computeTrajectoryStats measures straightness for a straight swipe', () => {
  const stats = computeTrajectoryStats(linePoints(100, 300, 260, 316, 30))
  assert.ok(stats.straightness > 0.95, `straightness ${stats.straightness}`)
  assert.equal(isStraightSwipe(stats), true)
})

test('computeTrajectoryStats measures straightness for a slightly curved swipe', () => {
  const points = []
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    points.push({ x: 100 + 180 * t, y: 300 + 20 * Math.sin(Math.PI * t) })
  }
  const stats = computeTrajectoryStats(points)
  assert.equal(isStraightSwipe(stats), true)
})

test('a zigzag scribble fails the straightness check', () => {
  const stats = computeTrajectoryStats(zigzagPoints(10, 25, 10))
  assert.ok(stats.straightness < 0.45, `straightness ${stats.straightness}`)
  assert.equal(isStraightSwipe(stats), false)
  assert.equal(isScribble(stats), true)
})

test('a short zigzag path is not classified as a scribble', () => {
  const stats = computeTrajectoryStats(zigzagPoints(6, 4, 4))
  assert.equal(isScribble(stats), false)
})
