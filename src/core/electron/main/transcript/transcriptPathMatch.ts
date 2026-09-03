import type { TranscriptImportProjectTarget } from '../../../shared/types'

// 转录导入的项目路径匹配。Windows 盘符/目录大小写不敏感、斜杠分隔符可混用、
// 尾部分隔符可省略，因此统一归一化后再做 === 比较（与 project-id 端点、直接
// projectPath 导入共用同一套语义）。纯函数模块，不依赖 config / electron，可单测。
export function normalizeTranscriptProjectPath(value: string): string {
  return value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function findTranscriptImportProject(projects: TranscriptImportProjectTarget[], queryPath: string): TranscriptImportProjectTarget | undefined {
  const trimmed = queryPath.trim()
  return projects.find((project) => project.projectPath === trimmed) || projects.find((project) => normalizeTranscriptProjectPath(project.projectPath) === normalizeTranscriptProjectPath(trimmed))
}
