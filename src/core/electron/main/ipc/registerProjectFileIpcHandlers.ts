import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import {
  listProjectDirectoryFiles,
  listProjectFiles,
  readProjectFile,
  searchProjectContent,
  searchProjectFiles,
  statProjectFile,
  writeProjectFile,
  writeProjectImageFile,
} from '../project-file-service'
import type { ProjectFileContentSearchOptions } from '../../../shared/types'
import { withProjectFileErrors } from './registerIpcHandlers.shared'

export function registerProjectFileIpcHandlers(): void {
  ipcMain.handle(IPC.PROJECT_FILE_TREE, async (_event, projectPath: string) => {
    return withProjectFileErrors(() => listProjectFiles(projectPath))
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_TREE_DIRECTORY,
    async (_event, projectPath: string, directoryRelativePath: string | null) => {
      return withProjectFileErrors(() =>
        listProjectDirectoryFiles(projectPath, directoryRelativePath)
      )
    }
  )

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH, async (_event, projectPath: string, query: string) => {
    return withProjectFileErrors(() => searchProjectFiles(projectPath, query))
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_CONTENT_SEARCH,
    async (
      _event,
      projectPath: string,
      query: string,
      options?: ProjectFileContentSearchOptions
    ) => {
      return withProjectFileErrors(() => searchProjectContent(projectPath, query, options))
    }
  )

  ipcMain.handle(
    IPC.PROJECT_FILE_READ,
    async (_event, projectPath: string, relativePath: string) => {
      return withProjectFileErrors(() => readProjectFile(projectPath, relativePath))
    }
  )

  ipcMain.handle(
    IPC.PROJECT_FILE_STAT,
    async (_event, projectPath: string, relativePath: string) => {
      return withProjectFileErrors(() => statProjectFile(projectPath, relativePath))
    }
  )

  ipcMain.handle(
    IPC.PROJECT_FILE_WRITE,
    async (
      _event,
      projectPath: string,
      relativePath: string,
      content: string,
      expectedMtimeMs?: number
    ) => {
      return withProjectFileErrors(() =>
        writeProjectFile(projectPath, relativePath, content, expectedMtimeMs)
      )
    }
  )

  ipcMain.handle(
    IPC.PROJECT_FILE_WRITE_IMAGE,
    async (
      _event,
      projectPath: string,
      targetDirectoryRelativePath: string,
      extension: string,
      dataBase64: string
    ) => {
      return withProjectFileErrors(() =>
        writeProjectImageFile(
          projectPath,
          targetDirectoryRelativePath,
          extension,
          dataBase64
        )
      )
    }
  )
}
