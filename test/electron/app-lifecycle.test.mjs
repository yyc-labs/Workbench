import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const lifecycle = loadTsModule('src/core/electron/main/app-lifecycle.ts')

test('cleanup steps run in order even when one step fails', async () => {
  const calls = []
  const errors = []
  await lifecycle.runAppCleanupSteps(
    [
      { name: 'first', run: () => calls.push('first') },
      {
        name: 'broken',
        run: async () => {
          calls.push('broken')
          throw new Error('boom')
        },
      },
      { name: 'last', run: () => calls.push('last') },
    ],
    (name, error) => errors.push({ name, message: error.message }),
  )

  assert.deepEqual(calls, ['first', 'broken', 'last'])
  assert.deepEqual(errors, [{ name: 'broken', message: 'boom' }])
})

test('registerAppLifecycle wires each process event exactly once', () => {
  const listeners = new Map()
  const app = {
    on(event, listener) {
      this.listeners.set(event, listener)
      return this
    },
    listeners,
  }
  const calls = []
  lifecycle.registerAppLifecycle(app, {
    onSecondInstance: () => calls.push('second-instance'),
    onBeforeQuit: () => calls.push('before-quit'),
    onWillQuit: () => calls.push('will-quit'),
    onActivate: () => calls.push('activate'),
    onWindowAllClosed: () => calls.push('window-all-closed'),
  })

  for (const event of ['second-instance', 'before-quit', 'will-quit', 'activate', 'window-all-closed']) {
    listeners.get(event)()
  }

  assert.deepEqual(calls, ['second-instance', 'before-quit', 'will-quit', 'activate', 'window-all-closed'])
})

test('runAppStartupSteps rolls back completed resources in reverse order', async () => {
  const calls = []
  await assert.rejects(
    lifecycle.runAppStartupSteps(
      [
        { name: 'first', run: () => calls.push('first'), rollback: () => calls.push('rollback:first') },
        { name: 'second', run: () => calls.push('second'), rollback: () => calls.push('rollback:second') },
        {
          name: 'broken',
          run: () => {
            throw new Error('startup failed')
          },
        },
      ],
      () => undefined,
    ),
    /startup failed/,
  )
  assert.deepEqual(calls, ['first', 'second', 'rollback:second', 'rollback:first'])
})
