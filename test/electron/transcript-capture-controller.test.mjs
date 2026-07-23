import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { TranscriptCaptureController } = loadTsModule('src/core/electron/main/transcript-capture-controller.ts')

test('transcript capture controller falls back and consumes the latest snapshot once', async () => {
  const controller = new TranscriptCaptureController()
  const snapshot = controller.begin({
    capture: async () => {
      throw new Error('selection unavailable')
    },
    fallback: () => ({ text: 'clipboard text', source: 'clipboard' }),
  })

  assert.equal(controller.isShortcutPending(), true)
  assert.deepEqual(await snapshot, { text: 'clipboard text', source: 'clipboard' })
  assert.deepEqual(await controller.consume(), { text: 'clipboard text', source: 'clipboard' })
  assert.deepEqual(await controller.consume(), { text: '', source: 'empty' })
  assert.equal(controller.isShortcutPending(), false)
})

test('reset invalidates an older in-flight capture', async () => {
  const controller = new TranscriptCaptureController()
  let resolveCapture
  const capture = new Promise((resolve) => {
    resolveCapture = resolve
  })
  controller.begin({ capture: () => capture, fallback: () => ({ text: 'fallback', source: 'clipboard' }) })
  controller.reset()
  resolveCapture({ text: 'stale', source: 'selection' })
  await Promise.resolve()
  assert.deepEqual(await controller.consume(), { text: '', source: 'empty' })
})
