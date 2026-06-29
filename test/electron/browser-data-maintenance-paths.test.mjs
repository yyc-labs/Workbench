import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS,
} = loadTsModule('src/core/electron/main/browser-data-maintenance-paths.ts')

test('legacy browser data cleanup includes Chromium dictionary storage directories', () => {
  assert.ok(
    LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS.includes('Dictionaries'),
    'should delete Chromium spellcheck dictionaries left under the old cache root'
  )
  assert.ok(
    LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS.includes('Shared Dictionary'),
    'should delete Chromium shared dictionary cache left under the old cache root'
  )
})
