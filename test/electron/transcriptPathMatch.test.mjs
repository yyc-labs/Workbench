import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { findTranscriptImportProject, normalizeTranscriptProjectPath } = loadTsModule('src/core/electron/main/transcript/transcriptPathMatch.ts')

const projects = [
  { projectId: 'p1', projectPath: 'D:\\Tools\\ide-electron', name: 'ide', displayName: 'ide' },
  { projectId: 'p2', projectPath: 'C:\\repo\\demo', name: 'demo', displayName: 'demo' },
]

test('normalizeTranscriptProjectPath unifies case, separators and trailing slashes', () => {
  assert.equal(normalizeTranscriptProjectPath('D:\\Tools\\ide-electron'), normalizeTranscriptProjectPath('d:/tools/ide-electron/'))
  assert.equal(normalizeTranscriptProjectPath('C:/repo/demo'), normalizeTranscriptProjectPath('c:\\REPO\\demo\\'))
})

test('findTranscriptImportProject matches exact registered path first', () => {
  assert.equal(findTranscriptImportProject(projects, 'D:\\Tools\\ide-electron')?.projectId, 'p1')
})

test('findTranscriptImportProject is tolerant of case and separator differences', () => {
  assert.equal(findTranscriptImportProject(projects, 'd:/tools/ide-electron')?.projectId, 'p1')
  assert.equal(findTranscriptImportProject(projects, 'D:\\Tools\\ide-electron\\')?.projectId, 'p1')
  assert.equal(findTranscriptImportProject(projects, 'c:\\REPO\\demo')?.projectId, 'p2')
})

test('findTranscriptImportProject returns undefined for an unregistered path', () => {
  assert.equal(findTranscriptImportProject(projects, 'E:\\unknown\\project'), undefined)
  assert.equal(findTranscriptImportProject(projects, ''), undefined)
})
