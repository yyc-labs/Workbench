import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { extractTerminalLinks } = loadTsModule('src/core/renderer/lib/terminalLinks.ts')

test('提取行内 http(s) 链接与 0-based 列区间', () => {
  const line = '  \u2794  Local:   http://localhost:5173/  '
  // 'http://localhost:5173/' 长 22，起始列 14（2 空格 + ➜ + 2 空格 + 'Local:' + 3 空格）
  assert.deepEqual(extractTerminalLinks(line), [{ text: 'http://localhost:5173/', start: 14, end: 36 }])
})

test('一行多个链接各自成项', () => {
  const line = 'see https://a.example.com and http://b.example.com/x?y=1'
  const links = extractTerminalLinks(line)
  assert.equal(links.length, 2)
  assert.deepEqual(
    links.map((link) => link.text),
    ['https://a.example.com', 'http://b.example.com/x?y=1'],
  )
  // 区间与文本严格对齐（end - start === text.length）
  for (const link of links) {
    assert.equal(link.end - link.start, link.text.length)
    assert.equal(line.slice(link.start, link.end), link.text)
  }
})

test('剥离句尾标点，不吞进行链接', () => {
  const line = 'open https://a.example.com. or (https://b.example.com), done'
  const links = extractTerminalLinks(line)
  assert.deepEqual(
    links.map((link) => link.text),
    ['https://a.example.com', 'https://b.example.com'],
  )
})

test('非 http 协议、无协议域名与裸文本不匹配', () => {
  assert.deepEqual(extractTerminalLinks('ftp://files.example.com'), [])
  assert.deepEqual(extractTerminalLinks('www.example.com no scheme'), [])
  assert.deepEqual(extractTerminalLinks('plain output line'), [])
})

test('引号 / 尖括号 / 空白终止链接', () => {
  // 'https://a.example.com' 长 21
  assert.deepEqual(extractTerminalLinks('<https://a.example.com>'), [{ text: 'https://a.example.com', start: 1, end: 22 }])
  assert.deepEqual(extractTerminalLinks('"https://a.example.com"'), [{ text: 'https://a.example.com', start: 1, end: 22 }])
  assert.deepEqual(extractTerminalLinks('https://a.example.com next'), [{ text: 'https://a.example.com', start: 0, end: 21 }])
})

test('重复调用不残留 lastIndex（正则复用安全）', () => {
  const line = 'https://a.example.com'
  assert.equal(extractTerminalLinks(line).length, 1)
  assert.equal(extractTerminalLinks(line).length, 1)
  assert.equal(extractTerminalLinks(line).length, 1)
})

test('空行返回空数组', () => {
  assert.deepEqual(extractTerminalLinks(''), [])
  assert.deepEqual(extractTerminalLinks('     '), [])
})
