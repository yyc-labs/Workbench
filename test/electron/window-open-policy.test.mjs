import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { resolveWindowOpenDecision } = loadTsModule('src/core/electron/main/window/webContentsSecurity.ts')

test('window.open policy keeps project preview popups inside the app', () => {
  assert.deepEqual(resolveWindowOpenDecision('yyc-workbench://p1h3ly1/docs/index.html'), { action: 'allow' })
})

test('window.open policy hands web popups to the system browser', () => {
  assert.deepEqual(resolveWindowOpenDecision('https://example.com/page'), { action: 'deny', openExternally: true })
  assert.deepEqual(resolveWindowOpenDecision('http://localhost:3000/'), { action: 'deny', openExternally: true })
})

test('window.open policy denies every other scheme', () => {
  assert.deepEqual(resolveWindowOpenDecision('file:///C:/Windows/system32/drivers/etc/hosts'), { action: 'deny', openExternally: false })
  assert.deepEqual(resolveWindowOpenDecision('javascript:alert(1)'), { action: 'deny', openExternally: false })
})
