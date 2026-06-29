import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  shouldRefreshLoadedDirectory,
  shouldRefreshRootOnSidebarReveal,
} = loadTsModule('src/core/renderer/pages/code/code.treeRefresh.ts')

test('shouldRefreshRootOnSidebarReveal only refreshes stale loaded roots', () => {
  const base = {
    autoLoadBlocked: false,
    hasLoadedRoot: true,
    isRefreshingRoot: false,
    lastRootLoadedAtMs: 1_000,
    lastRootRefreshStartedAtMs: null,
    nowMs: 20_001,
    ttlMs: 15_000,
    retryCooldownMs: 1_000,
  }

  assert.equal(shouldRefreshRootOnSidebarReveal(base), true)
  assert.equal(shouldRefreshRootOnSidebarReveal({ ...base, nowMs: 15_999 }), false)
  assert.equal(shouldRefreshRootOnSidebarReveal({ ...base, autoLoadBlocked: true }), false)
  assert.equal(shouldRefreshRootOnSidebarReveal({ ...base, hasLoadedRoot: false }), false)
  assert.equal(shouldRefreshRootOnSidebarReveal({ ...base, isRefreshingRoot: true }), false)
  assert.equal(shouldRefreshRootOnSidebarReveal({
    ...base,
    lastRootRefreshStartedAtMs: 19_500,
  }), false)
  assert.equal(shouldRefreshRootOnSidebarReveal({
    ...base,
    lastRootLoadedAtMs: null,
    lastRootRefreshStartedAtMs: null,
  }), true)
})

test('shouldRefreshLoadedDirectory respects force, reason, and ttl', () => {
  assert.equal(shouldRefreshLoadedDirectory({
    isLoaded: false,
    lastLoadedAtMs: null,
    reason: 'initial-open',
  }), true)

  assert.equal(shouldRefreshLoadedDirectory({
    isLoaded: true,
    lastLoadedAtMs: 1_000,
    nowMs: 10_000,
    reason: 'initial-open',
    ttlMs: 15_000,
  }), false)

  assert.equal(shouldRefreshLoadedDirectory({
    isLoaded: true,
    lastLoadedAtMs: 1_000,
    nowMs: 20_001,
    reason: 'initial-open',
    ttlMs: 15_000,
  }), true)

  assert.equal(shouldRefreshLoadedDirectory({
    isLoaded: true,
    lastLoadedAtMs: 1_000,
    nowMs: 20_001,
    reason: 'locate-path',
    ttlMs: 15_000,
  }), false)

  assert.equal(shouldRefreshLoadedDirectory({
    isLoaded: true,
    lastLoadedAtMs: 1_000,
    nowMs: 10_000,
    reason: 'directory-refresh',
    ttlMs: 15_000,
  }), true)

  assert.equal(shouldRefreshLoadedDirectory({
    force: true,
    isLoaded: true,
    lastLoadedAtMs: 1_000,
    nowMs: 10_000,
    reason: 'locate-path',
    ttlMs: 15_000,
  }), true)
})
