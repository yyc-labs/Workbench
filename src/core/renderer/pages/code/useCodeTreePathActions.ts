import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { copyTextToClipboard } from './code.clipboard'
import { joinProjectPath, normalizeRelativePathForCopy, removeRelativePathSlashes, resolveTreeNodeFolderPath } from './code.pathActions'

type UseCodeTreePathActionsArgs = {
  isNarrowViewport: boolean
  openContentSearchMatch: (relativePath: string, lineNumber: number, column: number) => Promise<void> | void
  openFile: (relativePath: string) => Promise<boolean> | void
  openExcludedEntry: (relativePath: string, nodeKind: ProjectFileNodeKind) => Promise<boolean> | void
  openFileWithTreeLocate: (relativePath: string) => Promise<boolean> | void
  projectPath: string
  setActiveContentSearchLocation: (value: { relativePath: string; lineNumber: number; column: number }) => void
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>
  setIsQuickDrawerOpen: Dispatch<SetStateAction<boolean>>
}

export function useCodeTreePathActions({ isNarrowViewport, openContentSearchMatch, openFile, openExcludedEntry, openFileWithTreeLocate, projectPath, setActiveContentSearchLocation, setIsExplorerOpen, setIsQuickDrawerOpen }: UseCodeTreePathActionsArgs) {
  const collapseExplorerIfNeeded = useCallback(() => {
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, setIsExplorerOpen])

  const handleSelectTreeFile = useCallback(
    (relativePath: string) => {
      void openFile(relativePath)
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openFile],
  )

  const handleSelectExcluded = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      void openExcludedEntry(relativePath, nodeKind)
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openExcludedEntry],
  )

  const handleOpenTreeNodeFolder = useCallback(
    async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      const revealPath = nodeKind === 'file' ? joinProjectPath(projectPath, relativePath) : undefined
      await window.electronAPI.openFolder(folderPath, revealPath)
    },
    [projectPath],
  )

  const handleOpenTreeNodeTerminal = useCallback(
    async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      await window.electronAPI.openPathTerminal(folderPath)
    },
    [projectPath],
  )

  const handleCopyTreeNodeName = useCallback((nodeName: string) => {
    void copyTextToClipboard(nodeName)
  }, [])

  const handleCopyTreeNodeRelativePath = useCallback((relativePath: string) => {
    void copyTextToClipboard(normalizeRelativePathForCopy(relativePath))
  }, [])

  const handleCopyTreeNodeRelativePathWithoutSlashes = useCallback((relativePath: string) => {
    void copyTextToClipboard(removeRelativePathSlashes(relativePath))
  }, [])

  const openFileFromQuickDrawer = useCallback(
    (relativePath: string) => {
      void openFileWithTreeLocate(relativePath)
      collapseExplorerIfNeeded()
      setIsQuickDrawerOpen(false)
    },
    [collapseExplorerIfNeeded, openFileWithTreeLocate, setIsQuickDrawerOpen],
  )

  const handleOpenContentSearchResult = useCallback(
    (relativePath: string, lineNumber: number, column: number) => {
      void openContentSearchMatch(relativePath, lineNumber, column)
      setActiveContentSearchLocation({ relativePath, lineNumber, column })
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openContentSearchMatch, setActiveContentSearchLocation],
  )

  const handleOpenSmartEmptyFile = useCallback(
    (relativePath: string) => {
      void openFileWithTreeLocate(relativePath)
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openFileWithTreeLocate],
  )

  return {
    handleCopyTreeNodeName,
    handleCopyTreeNodeRelativePath,
    handleCopyTreeNodeRelativePathWithoutSlashes,
    handleOpenContentSearchResult,
    handleOpenSmartEmptyFile,
    handleOpenTreeNodeFolder,
    handleOpenTreeNodeTerminal,
    handleSelectExcluded,
    handleSelectTreeFile,
    openFileFromQuickDrawer,
  }
}
