import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const resolver = loadTsModule('src/core/renderer/lib/processEnvironmentResolution.ts')

test('process environment resolution keeps explicit overrides', () => {
  assert.equal(resolver.resolveProcessUseWsl('C:/repo', true), true)
  assert.equal(resolver.resolveProcessUseWsl('/home/user/repo', false), false)
})

test('process environment resolution routes Windows and WSL paths explicitly', () => {
  assert.equal(resolver.resolveProcessUseWsl('C:/repo'), false)
  assert.equal(resolver.resolveProcessUseWsl('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo'), true)
  assert.equal(resolver.resolveProcessUseWsl('/mnt/c/repo'), false)
  assert.equal(resolver.resolveProcessUseWsl('relative/repo'), undefined)
})
