import test from 'node:test'
import assert from 'node:assert/strict'

import { computeNextWinVersion, normalizeWinVersionConfig } from '../../script/release/dist-win.mjs'

test('increments build number when manual version is unchanged', () => {
  const result = computeNextWinVersion({
    manualVersion: { major: 1, minor: 2 },
    state: {
      lastManualVersion: { major: 1, minor: 2 },
      build: 5,
    },
  })

  assert.equal(result.version, '1.2.6')
  assert.equal(result.resetReason, 'build')
  assert.deepEqual(result.nextConfig, {
    manualVersion: { major: 1, minor: 2 },
    state: {
      lastManualVersion: { major: 1, minor: 2 },
      build: 6,
    },
  })
})

test('resets build number to zero when minor changes', () => {
  const result = computeNextWinVersion({
    manualVersion: { major: 1, minor: 3 },
    state: {
      lastManualVersion: { major: 1, minor: 2 },
      build: 9,
    },
  })

  assert.equal(result.version, '1.3.0')
  assert.equal(result.resetReason, 'minor')
  assert.deepEqual(result.nextConfig, {
    manualVersion: { major: 1, minor: 3 },
    state: {
      lastManualVersion: { major: 1, minor: 3 },
      build: 0,
    },
  })
})

test('resets trailing segments when major changes', () => {
  const result = computeNextWinVersion({
    manualVersion: { major: 2, minor: 7 },
    state: {
      lastManualVersion: { major: 1, minor: 4 },
      build: 3,
    },
  })

  assert.equal(result.version, '2.0.0')
  assert.equal(result.resetReason, 'major')
  assert.deepEqual(result.nextConfig, {
    manualVersion: { major: 2, minor: 0 },
    state: {
      lastManualVersion: { major: 2, minor: 0 },
      build: 0,
    },
  })
})

test('falls back to default state when state is missing', () => {
  const normalized = normalizeWinVersionConfig(
    {
      manualVersion: { major: 3, minor: 1 },
    },
    { major: 3, minor: 1, build: 0 },
  )

  assert.deepEqual(normalized, {
    manualVersion: { major: 3, minor: 1 },
    state: {
      lastManualVersion: { major: 3, minor: 1 },
      build: 0,
    },
  })
})
