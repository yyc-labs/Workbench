import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { isManagedBrowserNewTabUrl } = loadTsModule('src/core/electron/main/screenshot/screenshotService.ts')

test('browser screenshot recognizes managed browser new-tab URLs', () => {
  assert.equal(isManagedBrowserNewTabUrl('chrome://newtab/'), true)
  assert.equal(isManagedBrowserNewTabUrl('edge://newtab/?source=tab'), true)
  assert.equal(isManagedBrowserNewTabUrl('about:newtab'), true)
  assert.equal(isManagedBrowserNewTabUrl('https://www.deepseek.com/'), false)
})
