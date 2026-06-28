import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProjectFileContentSearchResponse,
  ProjectFileNode,
} from '../../../shared/types'
import { collectParentDirectories } from './code.helpers'
import {
  collectTopLevelDirectories,
  expandTreePath,
  findDirectoryNode,
  mergeKnownFilePaths,
  replaceDirectoryNodes,
  sortProjectNodes,
} from './code.tree'
import type { FileTreeState } from './code.types'

export type ContentSearchScopePreset = {
  id: string
  label: string
  hint: string
  scopeInput: string
  title: string
}

const MAX_CONTENT_SEARCH_SCOPE_GLOBS = 24
const CONTENT_SEARCH_SCOPE_SEPARATOR_RE = /[\s,;\n，；]+/
const CONTENT_SEARCH_ROOT_SCOPE_CANDIDATES = ['src', 'app', 'packages', 'docs', 'test', 'tests', 'spec', 'scripts']
const CONTENT_SEARCH_ROOT_SCOPE_LABELS: Record<string, string> = {
  src: 'Source',
  app: 'App',
  packages: 'Packages',
  docs: 'Docs',
  test: 'Tests',
  tests: 'Tests',
  spec: 'Specs',
  scripts: 'Scripts',
}

function normalizeContentSearchScopeToken(value: string): string {
  const token = value.trim()
  if (!token) return ''
  if (token.startsWith('.')) return `*${token}`
  if (!token.includes('*') && !token.includes('/') && /^[A-Za-z0-9_-]+$/.test(token)) {
    return `*.${token}`
  }
  if (token.endsWith('/') || (!token.includes('*') && token.includes('/'))) {
    const normalized = token.replace(/\/+$/, '')
    return `${normalized}/**`
  }
  return token
}

export function parseContentSearchScopeGlobs(scopeInput: string): string[] {
  const tokens = scopeInput
    .split(CONTENT_SEARCH_SCOPE_SEPARATOR_RE)
    .map(normalizeContentSearchScopeToken)
    .filter((item) => item.length > 0)
  return Array.from(new Set(tokens)).slice(0, MAX_CONTENT_SEARCH_SCOPE_GLOBS)
}

export function contentSearchScopeKey(scopeInput: string): string {
  return parseContentSearchScopeGlobs(scopeInput).join('\n')
}

function directoryFromRelativePath(relativePath: string | null | undefined): string {
  const normalized = (relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return ''
  return normalized.slice(0, index)
}

function fileNameFromRelativePath(relativePath: string | null | undefined): string {
  const normalized = (relativePath ?? '').replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

function extensionFromRelativePath(relativePath: string | null | undefined): string {
  const fileName = fileNameFromRelativePath(relativePath)
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function expandParentDirectories(previous: Set<string>, relativePath: string): Set<string> {
  const next = new Set(previous)
  let changed = false
  for (const parent of collectParentDirectories(relativePath)) {
    if (next.has(parent)) continue
    next.add(parent)
    changed = true
  }
  return changed ? next : previous
}

type UseCodeWorkspaceExplorerStateOptions = {
  activePane: 'code' | 'aicommit'
  activeRelativePath: string | null
  contentSearchScopeInput: string
  projectPath: string
}

export function useCodeWorkspaceExplorerState({
  activePane,
  activeRelativePath,
  contentSearchScopeInput,
  projectPath,
}: UseCodeWorkspaceExplorerStateOptions) {
  const [tree, setTree] = useState<FileTreeState>({
    status: 'idle',
    nodes: [],
    error: null,
    knownFilePaths: new Set(),
    loadingDirectories: new Set(),
    skippedDirectories: 0,
    skippedFiles: 0,
  })
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set())
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [searchResultNodes, setSearchResultNodes] = useState<ProjectFileNode[]>([])
  const [isSearchingFiles, setIsSearchingFiles] = useState(false)
  const [fileSearchError, setFileSearchError] = useState<string | null>(null)
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSearchCaseSensitive, setContentSearchCaseSensitive] = useState(false)
  const [isContentSearchAdvancedOpen, setIsContentSearchAdvancedOpen] = useState(false)
  const [contentSearchResult, setContentSearchResult] = useState<ProjectFileContentSearchResponse>({
    files: [],
    totalMatches: 0,
    limited: false,
  })
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  const [contentSearchError, setContentSearchError] = useState<string | null>(null)
  const [isContentSearchAllExpanded, setIsContentSearchAllExpanded] = useState(true)

  const treeLoadRequestSeqRef = useRef(0)
  const searchRequestSeqRef = useRef(0)
  const contentSearchRequestSeqRef = useRef(0)
  const treeNodesRef = useRef<ProjectFileNode[]>([])
  const directoryLoadGenerationRef = useRef(0)
  const directoryLoadPromisesRef = useRef<Map<string, Promise<boolean>>>(new Map())

  useEffect(() => {
    treeNodesRef.current = tree.nodes
  }, [tree.nodes])

  const loadDirectory = useCallback(async (directoryRelativePath: string | null): Promise<boolean> => {
    const loadingKey = directoryRelativePath ?? ''
    if (directoryRelativePath) {
      const targetNode = findDirectoryNode(treeNodesRef.current, directoryRelativePath)
      if (targetNode?.isLoaded) return true
    }

    const existingLoad = directoryLoadPromisesRef.current.get(loadingKey)
    if (existingLoad) return existingLoad

    const loadGeneration = directoryLoadGenerationRef.current
    const loadPromise = (async () => {
      setTree((prev) => {
        if (directoryRelativePath) {
          const targetNode = findDirectoryNode(prev.nodes, directoryRelativePath)
          if (targetNode?.isLoaded) return prev
        }
        if (prev.loadingDirectories.has(loadingKey)) return prev
        const nextLoadingDirectories = new Set(prev.loadingDirectories)
        nextLoadingDirectories.add(loadingKey)
        return {
          ...prev,
          loadingDirectories: nextLoadingDirectories,
        }
      })

      try {
        const result = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryRelativePath)
        const sortedNodes = sortProjectNodes(result.nodes)
        if (directoryLoadGenerationRef.current !== loadGeneration) return false
        setTree((prev) => {
          const nextLoadingDirectories = new Set(prev.loadingDirectories)
          nextLoadingDirectories.delete(loadingKey)
          return {
            status: 'ready',
            nodes: replaceDirectoryNodes(prev.nodes, result.directoryRelativePath, sortedNodes),
            error: null,
            knownFilePaths: mergeKnownFilePaths(prev.knownFilePaths, sortedNodes),
            loadingDirectories: nextLoadingDirectories,
            skippedDirectories: prev.skippedDirectories + result.skipped.directories,
            skippedFiles: prev.skippedFiles + result.skipped.files,
          }
        })
        return true
      } catch (error) {
        if (directoryLoadGenerationRef.current !== loadGeneration) return false
        setTree((prev) => {
          const nextLoadingDirectories = new Set(prev.loadingDirectories)
          nextLoadingDirectories.delete(loadingKey)
          return {
            ...prev,
            status: prev.nodes.length > 0 ? 'ready' : 'error',
            error: error instanceof Error ? error.message : String(error),
            loadingDirectories: nextLoadingDirectories,
          }
        })
        return false
      }
    })()

    directoryLoadPromisesRef.current.set(loadingKey, loadPromise)
    try {
      return await loadPromise
    } finally {
      if (directoryLoadPromisesRef.current.get(loadingKey) === loadPromise) {
        directoryLoadPromisesRef.current.delete(loadingKey)
      }
    }
  }, [projectPath])

  const loadTree = useCallback(async () => {
    const requestSeq = treeLoadRequestSeqRef.current + 1
    treeLoadRequestSeqRef.current = requestSeq
    directoryLoadGenerationRef.current += 1
    directoryLoadPromisesRef.current.clear()
    setTree({
      status: 'loading',
      nodes: [],
      error: null,
      knownFilePaths: new Set(),
      loadingDirectories: new Set(),
      skippedDirectories: 0,
      skippedFiles: 0,
    })
    setExpandedDirectories(new Set())
    setFileSearchError(null)

    try {
      const result = await window.electronAPI.listProjectFiles(projectPath)
      const sortedNodes = sortProjectNodes(result.nodes)
      if (treeLoadRequestSeqRef.current !== requestSeq) return
      setTree((prev) => {
        const mergedNodes = replaceDirectoryNodes(prev.nodes, null, sortedNodes)
        return {
          status: 'ready',
          nodes: mergedNodes,
          error: null,
          knownFilePaths: mergeKnownFilePaths(new Set(), mergedNodes),
          loadingDirectories: new Set(),
          skippedDirectories: result.skipped.directories,
          skippedFiles: result.skipped.files,
        }
      })
    } catch (error) {
      if (treeLoadRequestSeqRef.current !== requestSeq) return
      setTree({
        status: 'error',
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
        knownFilePaths: new Set(),
        loadingDirectories: new Set(),
        skippedDirectories: 0,
        skippedFiles: 0,
      })
      setSearchResultNodes([])
    }
  }, [projectPath])

  const ensureTreePathLoaded = useCallback(async (relativePath: string) => {
    await expandTreePath(relativePath, collectParentDirectories(relativePath), {
      loadDirectory,
      setExpandedDirectories,
    })
  }, [loadDirectory])

  const markFilePathKnown = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return

    setExpandedDirectories((prev) => expandParentDirectories(prev, normalizedPath))
    setTree((prev) => {
      if (prev.knownFilePaths.has(normalizedPath)) return prev
      return {
        ...prev,
        knownFilePaths: new Set(prev.knownFilePaths).add(normalizedPath),
      }
    })
  }, [])

  useEffect(() => {
    if (activePane !== 'code') return
    if (tree.status !== 'idle') return
    void loadTree()
  }, [activePane, loadTree, tree.status])

  useEffect(() => {
    const normalizedQuery = fileSearchQuery.trim()
    if (!normalizedQuery) {
      setIsSearchingFiles(false)
      setFileSearchError(null)
      setSearchResultNodes([])
      return
    }

    const requestSeq = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestSeq
    setIsSearchingFiles(true)
    setFileSearchError(null)

    void window.electronAPI.searchProjectFiles(projectPath, normalizedQuery)
      .then((result) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes(result)
      })
      .catch((error) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes([])
        setFileSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setIsSearchingFiles(false)
      })
  }, [fileSearchQuery, projectPath])

  useEffect(() => {
    if (!activeRelativePath) return
    void ensureTreePathLoaded(activeRelativePath)
  }, [activeRelativePath, ensureTreePathLoaded])

  const contentSearchScopeGlobs = useMemo(
    () => parseContentSearchScopeGlobs(contentSearchScopeInput),
    [contentSearchScopeInput]
  )

  useEffect(() => {
    const normalizedQuery = contentSearchQuery.trim()
    if (!normalizedQuery) {
      setIsSearchingContent(false)
      setContentSearchError(null)
      setIsContentSearchAllExpanded(false)
      setContentSearchResult({
        files: [],
        totalMatches: 0,
        limited: false,
      })
      return
    }

    const requestSeq = contentSearchRequestSeqRef.current + 1
    contentSearchRequestSeqRef.current = requestSeq
    setIsSearchingContent(true)
    setContentSearchError(null)
    setIsContentSearchAllExpanded(false)

    void window.electronAPI.searchProjectContent(projectPath, normalizedQuery, {
      caseSensitive: contentSearchCaseSensitive,
      includeGlobs: contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs : undefined,
    })
      .then((result) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult(result)
        setIsContentSearchAllExpanded(result.files.length > 0)
      })
      .catch((error) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult({
          files: [],
          totalMatches: 0,
          limited: false,
        })
        setIsContentSearchAllExpanded(false)
        setContentSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setIsSearchingContent(false)
      })
  }, [
    contentSearchCaseSensitive,
    contentSearchQuery,
    contentSearchScopeGlobs,
    projectPath,
  ])

  const topLevelDirectorySet = useMemo(() => collectTopLevelDirectories(tree.nodes), [tree.nodes])
  const contentSearchScopePresets = useMemo<ContentSearchScopePreset[]>(() => {
    const presets: ContentSearchScopePreset[] = [{
      id: 'all',
      label: 'All',
      hint: 'entire project',
      scopeInput: '',
      title: 'Search the whole project',
    }]

    for (const candidate of CONTENT_SEARCH_ROOT_SCOPE_CANDIDATES) {
      if (!topLevelDirectorySet.has(candidate)) continue
      presets.push({
        id: `dir:${candidate}`,
        label: CONTENT_SEARCH_ROOT_SCOPE_LABELS[candidate] ?? candidate,
        hint: `${candidate}/`,
        scopeInput: `${candidate}/`,
        title: `Search inside ${candidate}/`,
      })
    }

    const activeDirectory = directoryFromRelativePath(activeRelativePath)
    if (activeDirectory && !presets.some((preset) => preset.scopeInput === `${activeDirectory}/`)) {
      presets.push({
        id: 'current-dir',
        label: 'This dir',
        hint: `${activeDirectory}/`,
        scopeInput: `${activeDirectory}/`,
        title: `Search inside ${activeDirectory}/`,
      })
    }

    const activeExtension = extensionFromRelativePath(activeRelativePath)
    if (activeExtension) {
      presets.push({
        id: 'same-type',
        label: `.${activeExtension}`,
        hint: `*.${activeExtension}`,
        scopeInput: activeExtension,
        title: `Search ${activeExtension.toUpperCase()} files`,
      })
    }

    return presets.slice(0, 7)
  }, [activeRelativePath, topLevelDirectorySet])

  const activeContentSearchScopeKey = useMemo(
    () => contentSearchScopeKey(contentSearchScopeInput),
    [contentSearchScopeInput]
  )

  const contentSearchScopeSummary = useMemo(() => (
    contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs.join(' · ') : 'All files'
  ), [contentSearchScopeGlobs])

  const activeContentSearchScopeLabel = useMemo(() => {
    const activePreset = contentSearchScopePresets.find((preset) => contentSearchScopeKey(preset.scopeInput) === activeContentSearchScopeKey)
    if (activePreset) return activePreset.label
    if (contentSearchScopeGlobs.length === 1) return contentSearchScopeGlobs[0]
    return `${contentSearchScopeGlobs.length} globs`
  }, [activeContentSearchScopeKey, contentSearchScopeGlobs, contentSearchScopePresets])

  const hasContentSearchQuery = contentSearchQuery.trim().length > 0
  const hasContentSearchScope = contentSearchScopeGlobs.length > 0
  const showContentSearchSummary = hasContentSearchQuery && !isSearchingContent && !contentSearchError
  const canToggleContentSearchTree = hasContentSearchQuery && !isSearchingContent && contentSearchResult.files.length > 0
  const contentSearchToggleLabel = isContentSearchAllExpanded ? 'Collapse all' : 'Expand all'
  const hasSearchQuery = fileSearchQuery.trim().length > 0
  const treeNodesForView = hasSearchQuery ? searchResultNodes : tree.nodes

  return {
    activeContentSearchScopeKey,
    activeContentSearchScopeLabel,
    canToggleContentSearchTree,
    contentSearchCaseSensitive,
    contentSearchError,
    contentSearchQuery,
    contentSearchResult,
    contentSearchScopeGlobs,
    contentSearchScopePresets,
    contentSearchScopeSummary,
    contentSearchToggleLabel,
    ensureTreePathLoaded,
    expandedDirectories,
    fileSearchError,
    fileSearchQuery,
    hasContentSearchQuery,
    hasContentSearchScope,
    hasSearchQuery,
    isContentSearchAdvancedOpen,
    isContentSearchAllExpanded,
    isSearchingContent,
    isSearchingFiles,
    loadDirectory,
    loadTree,
    markFilePathKnown,
    setContentSearchCaseSensitive,
    setContentSearchQuery,
    setExpandedDirectories,
    setFileSearchQuery,
    setIsContentSearchAdvancedOpen,
    setIsContentSearchAllExpanded,
    showContentSearchSummary,
    tree,
    treeNodesForView,
  }
}
