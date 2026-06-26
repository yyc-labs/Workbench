import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { ProjectFileContentSearchOptions } from '../../shared/types'

export function createProjectFileInvokeApi() {
  return {
    listProjectFiles: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_TREE, projectPath),

    listProjectDirectoryFiles: (projectPath: string, directoryRelativePath: string | null) =>
      ipcRenderer.invoke(IPC.PROJECT_FILE_TREE_DIRECTORY, projectPath, directoryRelativePath),

    searchProjectFiles: (projectPath: string, query: string) =>
      ipcRenderer.invoke(IPC.PROJECT_FILE_SEARCH, projectPath, query),

    searchProjectContent: (
      projectPath: string,
      query: string,
      options?: ProjectFileContentSearchOptions
    ) => ipcRenderer.invoke(IPC.PROJECT_FILE_CONTENT_SEARCH, projectPath, query, options),

    readProjectFile: (projectPath: string, relativePath: string) =>
      ipcRenderer.invoke(IPC.PROJECT_FILE_READ, projectPath, relativePath),

    statProjectFile: (projectPath: string, relativePath: string) =>
      ipcRenderer.invoke(IPC.PROJECT_FILE_STAT, projectPath, relativePath),

    writeProjectFile: (
      projectPath: string,
      relativePath: string,
      content: string,
      expectedMtimeMs?: number
    ) => ipcRenderer.invoke(IPC.PROJECT_FILE_WRITE, projectPath, relativePath, content, expectedMtimeMs),

    writeProjectImageFile: (
      projectPath: string,
      targetDirectoryRelativePath: string,
      extension: string,
      dataBase64: string
    ) =>
      ipcRenderer.invoke(
        IPC.PROJECT_FILE_WRITE_IMAGE,
        projectPath,
        targetDirectoryRelativePath,
        extension,
        dataBase64
      ),
  }
}
