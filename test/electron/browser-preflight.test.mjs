import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parseProgIdFromRegOutput, parseBrowserExePathFromRegOutput, parseProcessNameFromExePath } = loadTsModule('src/core/electron/main/shell/browser-preflight.ts')

test('parseProgIdFromRegOutput extracts ProgId from reg query output', () => {
  const output = ['', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '    ProgId    REG_SZ    ChromeHTML', ''].join('\n')

  assert.equal(parseProgIdFromRegOutput(output), 'ChromeHTML')
})

test('parseProgIdFromRegOutput returns null when the value is missing', () => {
  assert.equal(parseProgIdFromRegOutput('ERROR: The system was unable to find the specified registry key or value.'), null)
  assert.equal(parseProgIdFromRegOutput(''), null)
})

test('parseBrowserExePathFromRegOutput handles quoted and unquoted command values', () => {
  const quoted = ['', 'HKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command', '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1', ''].join('\n')
  assert.equal(parseBrowserExePathFromRegOutput(quoted), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

  const unquoted = ['', 'HKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command', '    (Default)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe --single-argument %1', ''].join('\n')
  assert.equal(parseBrowserExePathFromRegOutput(unquoted), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
})

test('parseBrowserExePathFromRegOutput returns null when no exe path is present', () => {
  assert.equal(parseBrowserExePathFromRegOutput('Value not found.'), null)
  assert.equal(parseBrowserExePathFromRegOutput(''), null)
})

test('parseProcessNameFromExePath normalizes separators and lowercases the basename', () => {
  assert.equal(parseProcessNameFromExePath('C:\\Program Files\\Google\\Chrome\\Application\\CHROME.EXE'), 'chrome.exe')
  assert.equal(parseProcessNameFromExePath('C:/Program Files/Mozilla Firefox/firefox.exe'), 'firefox.exe')
  assert.equal(parseProcessNameFromExePath('msedge.exe'), 'msedge.exe')
})
