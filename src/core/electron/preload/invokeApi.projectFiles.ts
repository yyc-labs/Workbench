import { ipcRenderer } from 'electron'
import type { ProjectFileArchiveEntry, ProjectFileContentSearchOptions, ProjectFileNode, ProjectFileTreeOptions } from '../../shared/types'
import { IPC } from '../main/ipc'

/** 排队中任务取消（v2⑤）：renderer 切换文件/关闭预览时调用；已进入转换的任务不中断。 */
function cancelDocxPreview(requestId: string) {
  return ipcRenderer.invoke(IPC.PROJECT_FILE_DOCX_PREVIEW_CANCEL, requestId)
}

export function createProjectFileInvokeApi() {
  return {
    getProjectFileAutoLoadDecision: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_AUTOLOAD_DECISION, projectPath),

    listProjectFiles: (projectPath: string, options?: ProjectFileTreeOptions) => ipcRenderer.invoke(IPC.PROJECT_FILE_TREE, projectPath, options),

    listProjectDirectoryFiles: (projectPath: string, directoryRelativePath: string | null) => ipcRenderer.invoke(IPC.PROJECT_FILE_TREE_DIRECTORY, projectPath, directoryRelativePath),

    searchProjectFiles: (projectPath: string, query: string, folderRelativePath?: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_SEARCH, projectPath, query, folderRelativePath),

    searchProjectDirectories: (projectPath: string, query: string, folderRelativePath?: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_SEARCH_DIRECTORIES, projectPath, query, folderRelativePath) as Promise<ProjectFileNode[]>,

    searchProjectContent: (projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => ipcRenderer.invoke(IPC.PROJECT_FILE_CONTENT_SEARCH, projectPath, query, options),

    readProjectFile: (projectPath: string, relativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_READ, projectPath, relativePath),

    statProjectFile: (projectPath: string, relativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_STAT, projectPath, relativePath),

    writeProjectFile: (projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number) => ipcRenderer.invoke(IPC.PROJECT_FILE_WRITE, projectPath, relativePath, content, expectedMtimeMs),

    writeProjectImageFile: (projectPath: string, targetDirectoryRelativePath: string, extension: string, dataBase64: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_WRITE_IMAGE, projectPath, targetDirectoryRelativePath, extension, dataBase64),

    openProjectFilePath: (projectPath: string, relativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_OPEN_PATH, projectPath, relativePath),

    revealProjectFileInFileManager: (projectPath: string, relativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_REVEAL, projectPath, relativePath),

    zipProjectFolder: (projectPath: string, folderRelativePath: string, zipName: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_ZIP, projectPath, folderRelativePath, zipName),

    copyProjectFolderZipToClipboard: (projectPath: string, folderRelativePath: string, zipName: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_ZIP_CLIPBOARD, projectPath, folderRelativePath, zipName) as Promise<{ name: string; size: number }>,

    copyProjectFileToClipboard: (projectPath: string, fileRelativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_CLIPBOARD, projectPath, fileRelativePath) as Promise<{ name: string; size: number }>,

    copyProjectEntriesToClipboard: (projectPath: string, entries: ProjectFileArchiveEntry[]) => ipcRenderer.invoke(IPC.PROJECT_FILE_CLIPBOARD_ENTRIES, projectPath, entries) as Promise<{ name: string; count: number }>,

    copyProjectEntriesZipToClipboard: (projectPath: string, entries: ProjectFileArchiveEntry[], zipName?: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_ZIP_ENTRIES_CLIPBOARD, projectPath, entries, zipName) as Promise<{ name: string; size: number }>,

    docxPreview: (projectPath: string, relativePath: string, requestId?: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_DOCX_PREVIEW, projectPath, relativePath, requestId),

    cancelDocxPreview: (requestId: string) => cancelDocxPreview(requestId),

    readDocxSource: (projectPath: string, relativePath: string) => ipcRenderer.invoke(IPC.PROJECT_FILE_DOCX_READ_SOURCE, projectPath, relativePath),
  }
}
