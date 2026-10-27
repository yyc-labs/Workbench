import { ipcMain } from 'electron'
import type { ProjectFileArchiveEntry, ProjectFileContentSearchOptions, ProjectFileTreeOptions } from '../../../shared/types'
import { IPC } from '../ipc'
import {
  cancelDocxPreview,
  copyProjectEntriesToClipboard,
  copyProjectEntriesZipToClipboard,
  copyProjectFileToClipboard,
  copyProjectFolderZipToClipboard,
  createProjectFolderZip,
  getProjectFileAutoLoadDecision,
  listProjectDirectoryFiles,
  listProjectFiles,
  openProjectFileInSystem,
  previewDocxFile,
  readDocxSource,
  readProjectFile,
  revealProjectFileInFileManager,
  searchProjectContent,
  searchProjectDirectories,
  searchProjectFiles,
  statProjectFile,
  writeProjectFile,
  writeProjectImageFile,
} from '../project-file-service'
import { withProjectFileErrors } from './registerIpcHandlers.shared'

export function registerProjectFileIpcHandlers(): void {
  ipcMain.handle(IPC.PROJECT_FILE_AUTOLOAD_DECISION, async (_event, projectPath: string) => {
    return withProjectFileErrors(() => getProjectFileAutoLoadDecision(projectPath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE, async (_event, projectPath: string, options?: ProjectFileTreeOptions) => {
    return withProjectFileErrors(() => listProjectFiles(projectPath, options))
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE_DIRECTORY, async (_event, projectPath: string, directoryRelativePath: string | null) => {
    return withProjectFileErrors(() => listProjectDirectoryFiles(projectPath, directoryRelativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH, async (_event, projectPath: string, query: string, folderRelativePath?: string) => {
    return withProjectFileErrors(() => searchProjectFiles(projectPath, query, folderRelativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH_DIRECTORIES, async (_event, projectPath: string, query: string, folderRelativePath?: string) => {
    return withProjectFileErrors(() => searchProjectDirectories(projectPath, query, folderRelativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_CONTENT_SEARCH, async (_event, projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => {
    return withProjectFileErrors(() => searchProjectContent(projectPath, query, options))
  })

  ipcMain.handle(IPC.PROJECT_FILE_READ, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => readProjectFile(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_STAT, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => statProjectFile(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_WRITE, async (_event, projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number) => {
    return withProjectFileErrors(() => writeProjectFile(projectPath, relativePath, content, expectedMtimeMs))
  })

  ipcMain.handle(IPC.PROJECT_FILE_WRITE_IMAGE, async (_event, projectPath: string, targetDirectoryRelativePath: string, extension: string, dataBase64: string) => {
    return withProjectFileErrors(() => writeProjectImageFile(projectPath, targetDirectoryRelativePath, extension, dataBase64))
  })

  ipcMain.handle(IPC.PROJECT_FILE_DOCX_PREVIEW, async (_event, projectPath: string, relativePath: string, requestId?: string) => {
    return withProjectFileErrors(() => previewDocxFile(projectPath, relativePath, requestId))
  })

  ipcMain.handle(IPC.PROJECT_FILE_DOCX_PREVIEW_CANCEL, async (_event, requestId: string) => {
    cancelDocxPreview(requestId)
  })

  ipcMain.handle(IPC.PROJECT_FILE_DOCX_READ_SOURCE, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => readDocxSource(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_OPEN_PATH, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => openProjectFileInSystem(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_REVEAL, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => revealProjectFileInFileManager(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_ZIP, async (_event, projectPath: string, folderRelativePath: string, zipName: string) => {
    return withProjectFileErrors(() => createProjectFolderZip(projectPath, folderRelativePath, zipName))
  })

  ipcMain.handle(IPC.PROJECT_FILE_ZIP_CLIPBOARD, async (_event, projectPath: string, folderRelativePath: string, zipName: string) => {
    return withProjectFileErrors(() => copyProjectFolderZipToClipboard(projectPath, folderRelativePath, zipName))
  })

  ipcMain.handle(IPC.PROJECT_FILE_CLIPBOARD, async (_event, projectPath: string, fileRelativePath: string) => {
    return withProjectFileErrors(() => copyProjectFileToClipboard(projectPath, fileRelativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_CLIPBOARD_ENTRIES, async (_event, projectPath: string, entries: ProjectFileArchiveEntry[]) => {
    return withProjectFileErrors(() => copyProjectEntriesToClipboard(projectPath, entries))
  })

  ipcMain.handle(IPC.PROJECT_FILE_ZIP_ENTRIES_CLIPBOARD, async (_event, projectPath: string, entries: ProjectFileArchiveEntry[], zipName?: string) => {
    return withProjectFileErrors(() => copyProjectEntriesZipToClipboard(projectPath, entries, zipName))
  })
}
