import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createTranscriptService } = loadTsModule('src/core/electron/main/transcript/transcriptService.ts')
const { buildTranscriptSession } = loadTsModule('src/core/shared/transcript/transcript.parser.ts')

test('getTranscript rebuilds stale transcript markdown and references from raw text', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'transcript-service-'))
  mkdirSync(join(projectPath, 'nanopct_inf', 'model'), { recursive: true })
  writeFileSync(join(projectPath, 'nanopct_inf', 'model', 'data_config.json'), '{}', 'utf8')

  const rawText = [
    '项目                                       当前是否可改            代码来源            说明                                     前端建议',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━',
    '分类参数候选项                             不可在页面改            nanopct_inf/        下拉选项集合由配置文件固定               不暴露为高级参数',
    '                                                                      model/',
    '                                                                      data_config.json',
    '                                                                      :20',
  ].join('\n')

  const freshSession = buildTranscriptSession(
    {
      projectId: 'project-1',
      sourceType: 'manual-markdown',
      rawText,
      title: 'Transcript',
    },
    {
      sessionId: 'session-1',
      projectPath,
      createdAt: 1000,
      updatedAt: 1000,
      title: 'Transcript',
      isProjectFilePath: (relativePath) => relativePath === 'nanopct_inf/model/data_config.json',
    }
  )

  const staleSession = {
    ...freshSession,
    markdownText: rawText,
    references: [],
  }

  const savedSessions = []
  const repository = {
    saveSession: async (session) => {
      savedSessions.push(session)
    },
    getSession: async () => staleSession,
    listSessions: async () => [],
    listAllSessions: async () => [],
    deleteSession: async () => false,
  }

  const service = createTranscriptService({
    repository,
    getProjectIdByPath: () => 'project-1',
    getProjectPathById: () => projectPath,
  })

  const session = await service.getTranscript('project-1', 'session-1')

  assert.ok(session)
  assert.match(
    session.markdownText,
    /\[model\/data_config\.json:20\]\(transcript-ref:\/\/session-1-ref-1\)/
  )
  assert.deepEqual(
    session.references.map((reference) => ({
      label: reference.label,
      relativePath: reference.relativePath,
      lineNumber: reference.lineNumber,
    })),
    [
      {
        label: 'model/data_config.json:20',
        relativePath: 'nanopct_inf/model/data_config.json',
        lineNumber: 20,
      },
    ]
  )
  assert.equal(savedSessions.length, 1)
  assert.equal(savedSessions[0]?.id, 'session-1')
})
