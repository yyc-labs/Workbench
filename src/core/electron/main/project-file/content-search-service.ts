import type {
  ProjectFileContentMatch,
  ProjectFileContentSearchOptions,
  ProjectFileContentSearchResponse,
  ProjectFileContentSearchResult,
} from '../../../shared/types'
import {
  MAX_CONTENT_SEARCH_FILES,
  MAX_CONTENT_SEARCH_MATCHES_PER_FILE,
  MAX_CONTENT_SEARCH_TOTAL_MATCHES,
  MAX_TREE_DEPTH,
  ProjectFileServiceError,
  RG_CONTENT_SEARCH_MAX_BUFFER,
  RG_CONTENT_SEARCH_MAX_COLUMNS,
  RG_CONTENT_SEARCH_TIMEOUT_MS,
  RG_EXCLUDE_GLOBS,
  decodeRgOutputData,
  execFileUtf8WithLimits,
  fileDepth,
  normalizeContentSearchIncludeGlobs,
  normalizeListedRelativePath,
  normalizeSearchLineText,
  parseSearchMatchLine,
  resolveRoot,
  shouldSkipListedFilePath,
  toContentSearchResultRecord,
} from './shared'

export async function searchProjectContent(
  projectPath: string,
  query: string,
  options?: ProjectFileContentSearchOptions
): Promise<ProjectFileContentSearchResponse> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return {
      files: [],
      totalMatches: 0,
      limited: false,
    }
  }

  const rootRealPath = await resolveRoot(projectPath)
  const caseSensitive = options?.caseSensitive === true
  const includeGlobs = normalizeContentSearchIncludeGlobs(options?.includeGlobs)
  const args = [
    '--json',
    '--hidden',
    '--no-ignore',
    '--fixed-strings',
    ...(caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
    '--line-number',
    '--column',
    '--max-columns',
    String(RG_CONTENT_SEARCH_MAX_COLUMNS),
    '--max-count',
    String(MAX_CONTENT_SEARCH_MATCHES_PER_FILE),
    ...includeGlobs.flatMap((glob) => ['--glob', glob]),
    ...RG_EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
    '-e',
    normalizedQuery,
    '.',
  ]

  let output = ''
  try {
    output = await execFileUtf8WithLimits(
      rootRealPath,
      args,
      RG_CONTENT_SEARCH_TIMEOUT_MS,
      RG_CONTENT_SEARCH_MAX_BUFFER
    )
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException & { code?: unknown; stdout?: string }
    const errorCode = String(typedError.code ?? '')
    if (errorCode === '1') {
      return {
        files: [],
        totalMatches: 0,
        limited: false,
      }
    }
    if (typedError.code === 'ENOENT') {
      throw new ProjectFileServiceError('rg is not installed. Install ripgrep to enable content search.')
    }
    if (typedError.code === 'ETIMEDOUT') {
      throw new ProjectFileServiceError('Content search timed out. Please refine your query.')
    }
    throw error
  }

  const resultMap = new Map<string, ProjectFileContentSearchResult>()
  let totalMatches = 0
  let limited = false
  const lines = output.split(/\r?\n/)

  for (const rawLine of lines) {
    const parsed = parseSearchMatchLine(rawLine)
    if (!parsed || parsed.type !== 'match') continue

    const relativePath = normalizeListedRelativePath(decodeRgOutputData(parsed.data?.path))
    if (!relativePath) continue
    if (shouldSkipListedFilePath(relativePath)) continue
    if (fileDepth(relativePath) > MAX_TREE_DEPTH) continue

    const matchLineNumber = parsed.data?.line_number
    if (typeof matchLineNumber !== 'number' || !Number.isFinite(matchLineNumber) || matchLineNumber <= 0) continue

    const lineTextRaw = decodeRgOutputData(parsed.data?.lines)
    const lineText = normalizeSearchLineText(lineTextRaw)
    const submatch = parsed.data?.submatches?.[0]
    const start = typeof submatch?.start === 'number' ? submatch.start : 0
    const end = typeof submatch?.end === 'number' ? submatch.end : start + normalizedQuery.length
    const column = Math.max(1, start + 1)
    const endColumn = Math.max(column, end + 1)

    const perFile = toContentSearchResultRecord(resultMap, relativePath)
    if (perFile.matches.length < MAX_CONTENT_SEARCH_MATCHES_PER_FILE) {
      const nextMatch: ProjectFileContentMatch = {
        lineNumber: matchLineNumber,
        column,
        endColumn,
        lineText,
      }
      perFile.matches.push(nextMatch)
    } else {
      limited = true
    }

    perFile.matchCount += 1
    totalMatches += 1

    if (resultMap.size > MAX_CONTENT_SEARCH_FILES || totalMatches >= MAX_CONTENT_SEARCH_TOTAL_MATCHES) {
      limited = true
      break
    }
  }

  const orderedFiles = Array.from(resultMap.values())
    .sort((a, b) => b.matchCount - a.matchCount || a.relativePath.localeCompare(b.relativePath))
    .slice(0, MAX_CONTENT_SEARCH_FILES)

  if (orderedFiles.length < resultMap.size) {
    limited = true
  }

  return {
    files: orderedFiles,
    totalMatches,
    limited,
  }
}
