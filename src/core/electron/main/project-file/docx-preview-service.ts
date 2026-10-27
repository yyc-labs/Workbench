import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { DocxPreviewResult, ProjectDocxSourceResult } from '../../../shared/types'
import { DEFAULT_DOCX_PREVIEW_CACHE_BUDGET_MB, DEFAULT_DOCX_PREVIEW_LIMIT_MB, loadConfig } from '../config'
import { DocxPreviewController, type EngineCandidate, type FileSystemAdapter, MAX_GENERATED_PDF_BYTES } from './docx-preview-core'
import { ensureWithinRoot, normalizeRelativeInput, openValidatedFileHandle, ProjectFileServiceError, resolveRoot, validateRelativePathLooksSafe } from './shared'

/**
 * DOCX 高保真预览服务（18 号计划）：LibreOffice headless 转 PDF。
 * 核心逻辑在 docx-preview-core.ts（可注入、可单测），本文件只做 Electron 接线：
 * 路径解析复用 project-file 防护链，临时目录/缓存目录沿用 temp 与 userData 先例。
 */

const DEFAULT_PROGRAM_FILES = 'C:\\Program Files'
const DEFAULT_PROGRAM_FILES_X86 = 'C:\\Program Files (x86)'

/** 引擎候选顺序（v3）：配置覆盖路径优先，其后默认安装位置；否定结果不缓存。 */
function buildEngineCandidates(): EngineCandidate[] {
  const candidates: EngineCandidate[] = []
  const overridePath = loadConfig().docxPreviewSofficePath?.trim()
  if (overridePath) candidates.push({ id: 'override', executablePath: overridePath })
  const programFiles = process.env.ProgramFiles || DEFAULT_PROGRAM_FILES
  const programFilesX86 = process.env['ProgramFiles(x86)'] || DEFAULT_PROGRAM_FILES_X86
  const localAppData = process.env.LOCALAPPDATA || ''
  candidates.push({ id: 'program-files', executablePath: path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe') })
  candidates.push({ id: 'program-files-x86', executablePath: path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe') })
  if (localAppData) candidates.push({ id: 'local-app-data', executablePath: path.join(localAppData, 'Programs', 'LibreOffice', 'program', 'soffice.exe') })
  return candidates
}

let controller: DocxPreviewController | undefined

function getController(): DocxPreviewController {
  if (!controller) {
    controller = new DocxPreviewController({
      fileSystem: fs as FileSystemAdapter,
      spawn,
      engineCandidates: buildEngineCandidates,
      limits: () => {
        const config = loadConfig()
        return {
          sourceBytes: (config.docxPreviewLimitMb ?? DEFAULT_DOCX_PREVIEW_LIMIT_MB) * 1024 * 1024,
          outputBytes: MAX_GENERATED_PDF_BYTES,
          cacheBudgetBytes: (config.docxPreviewCacheBudgetMb ?? DEFAULT_DOCX_PREVIEW_CACHE_BUDGET_MB) * 1024 * 1024,
        }
      },
      tempRoot: path.join(app.getPath('temp'), 'yyc-workbench-docx-convert'),
      cacheRoot: path.join(app.getPath('userData'), 'cache', 'docx-preview'),
    })
  }
  return controller
}

/** 防护链解析源文件绝对真实路径：resolveRoot → normalize → validate → realpath → ensureWithinRoot。 */
async function resolveDocxSourceRealPath(projectPath: string, relativePath: string): Promise<string> {
  const rootRealPath = await resolveRoot(projectPath)
  const normalizedRelativePath = normalizeRelativeInput(relativePath)
  validateRelativePathLooksSafe(normalizedRelativePath)
  const candidatePath = path.resolve(rootRealPath, normalizedRelativePath)
  const realPath = await fs.realpath(candidatePath)
  ensureWithinRoot(rootRealPath, realPath)
  return realPath
}

export async function previewDocxFile(projectPath: string, relativePath: string, requestId?: string): Promise<DocxPreviewResult> {
  const sourceRealPath = await resolveDocxSourceRealPath(projectPath, relativePath)
  return getController().preview(sourceRealPath, requestId)
}

export function cancelDocxPreview(requestId: string): void {
  getController().cancel(requestId)
}

/** 手动基础预览按需读取原始 DOCX（v2⑦）：走同防护链 + docxPreviewLimitMb 上限。 */
export async function readDocxSource(projectPath: string, relativePath: string): Promise<ProjectDocxSourceResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, stat, normalizedRelativePath } = opened
  try {
    const config = loadConfig()
    const limitBytes = (config.docxPreviewLimitMb ?? DEFAULT_DOCX_PREVIEW_LIMIT_MB) * 1024 * 1024
    if (stat.size > limitBytes) {
      throw new ProjectFileServiceError('DOCX file exceeds the preview size limit.')
    }
    const buffer = await fileHandle.readFile()
    return {
      relativePath: normalizedRelativePath,
      base64: buffer.toString('base64'),
      size: buffer.byteLength,
      mtimeMs: stat.mtimeMs,
    }
  } finally {
    await fileHandle.close().catch(() => undefined)
  }
}
