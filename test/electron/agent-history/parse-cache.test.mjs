import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const mod = loadTsModule('src/core/electron/main/agent-history/parse-cache.ts')

const stat = { mtimeMs: 1000, sizeBytes: 500 }

test('parse cache stores, hits and counts', () => {
  const cache = mod.createParseCache()
  assert.equal(cache.get('a', stat, 1), null)
  cache.set('a', stat, 1, { title: 't' })
  assert.deepEqual(cache.get('a', stat, 1), { title: 't' })
  assert.deepEqual(cache.counters(), { hits: 1, misses: 1, invalidations: 0 })
})

test('parse cache invalidates when mtime changes (file touched)', () => {
  const cache = mod.createParseCache()
  cache.set('a', stat, 1, { v: 1 })
  assert.equal(cache.get('a', { mtimeMs: 2000, sizeBytes: 500 }, 1), null)
  assert.equal(cache.counters().invalidations, 1)
})

test('parse cache invalidates on same-size rewrite', () => {
  const cache = mod.createParseCache()
  cache.set('a', stat, 1, { v: 1 })
  assert.equal(cache.get('a', { mtimeMs: 3000, sizeBytes: 500 }, 1), null)
})

test('parse cache invalidates when size changes', () => {
  const cache = mod.createParseCache()
  cache.set('a', stat, 1, { v: 1 })
  assert.equal(cache.get('a', { mtimeMs: 1000, sizeBytes: 900 }, 1), null)
})

test('parse cache invalidates when parserVersion changes', () => {
  const cache = mod.createParseCache()
  cache.set('a', stat, 1, { v: 1 })
  assert.equal(cache.get('a', stat, 2), null)
  cache.set('a', stat, 2, { v: 2 })
  assert.deepEqual(cache.get('a', stat, 2), { v: 2 })
})

test('parse cache remove/clear/size', () => {
  const cache = mod.createParseCache()
  cache.set('a', stat, 1, { v: 1 })
  cache.set('b', stat, 1, { v: 2 })
  assert.equal(cache.size(), 2)
  cache.remove('a')
  assert.equal(cache.size(), 1)
  cache.clear()
  assert.equal(cache.size(), 0)
})
