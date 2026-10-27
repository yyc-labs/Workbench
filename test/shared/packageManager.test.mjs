import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { detectPackageManager, parsePackageManagerField, resolvePackageManager } = loadTsModule('src/core/shared/rules.ts')
const { scriptCommand } = loadTsModule('src/core/renderer/lib/packageScripts.ts')

test('detectPackageManager recognizes bun lockfiles and keeps npm fallback', () => {
  assert.equal(detectPackageManager(['bun.lock', 'package.json']), 'bun')
  assert.equal(detectPackageManager(['bun.lockb']), 'bun')
  assert.equal(detectPackageManager(['pnpm-lock.yaml']), 'pnpm')
  assert.equal(detectPackageManager(['yarn.lock']), 'yarn')
  assert.equal(detectPackageManager(['package.json']), 'npm')
})

test('parsePackageManagerField accepts known manager declarations only', () => {
  assert.equal(parsePackageManagerField('pnpm@9.1.0'), 'pnpm')
  assert.equal(parsePackageManagerField('yarn@4.1.0'), 'yarn')
  assert.equal(parsePackageManagerField('npm@10.2.0'), 'npm')
  assert.equal(parsePackageManagerField('bun@1.1.0'), 'bun')
  assert.equal(parsePackageManagerField('Bun@1.1.0'), 'bun')
  assert.equal(parsePackageManagerField(undefined), undefined)
  assert.equal(parsePackageManagerField(42), undefined)
  assert.equal(parsePackageManagerField('deno@2.0.0'), undefined)
  assert.equal(parsePackageManagerField('unknown-tool'), undefined)
})

test('resolvePackageManager prefers declared field over lockfile and falls back to npm', () => {
  assert.equal(resolvePackageManager({ declared: 'bun', directoryFiles: ['pnpm-lock.yaml'] }), 'bun')
  assert.equal(resolvePackageManager({ declared: undefined, directoryFiles: ['pnpm-lock.yaml'] }), 'pnpm')
  assert.equal(resolvePackageManager({ declared: undefined, directoryFiles: [] }), 'npm')
})

test('scriptCommand builds bun commands like yarn', () => {
  assert.equal(scriptCommand('bun', 'dev'), 'bun run dev')
  assert.equal(scriptCommand('bun', 'start'), 'bun start')
  assert.equal(scriptCommand('pnpm', 'dev'), 'pnpm run dev')
  assert.equal(scriptCommand('yarn', 'start'), 'yarn start')
  assert.equal(scriptCommand(undefined, 'dev'), 'npm run dev')
})
