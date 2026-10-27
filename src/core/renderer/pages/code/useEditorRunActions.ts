/**
 * 19 号计划 §12 步骤 6：页面级编辑器运行动作 hook。
 * 防抖解析 RunAction[]（§4.4：内容变化防抖 + 版本校验防旧覆新），
 * 执行前核对 package-script 仍存在于当前内容（§2.2 执行标识稳定性约束）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../components/ui/toast'
import { useI18n } from '../../i18n'
import { parsePackageScriptsWithLines } from '../../lib/packageScripts'
import { resolveProcessUseWsl } from '../../lib/processEnvironmentResolution'
import { joinProjectPath } from '../../lib/projectPaths'
import { executeRunAction } from '../../lib/runActions/actionExecutor'
import { resolveRunActions, runActionProviders } from '../../lib/runActions/providers'
import { type RunContextResolverDeps, resolveRunContext } from '../../lib/runActions/runContextResolver'
import { createAppStoreTerminalDeps } from '../../lib/runActions/terminalExecution'
import type { RunAction } from '../../lib/runActions/types'
import { useAppStore } from '../../stores/appStore'

const EDITOR_RUN_RESOLVE_DEBOUNCE_MS = 300

const runContextResolverDeps: RunContextResolverDeps = {
  listDirectoryFiles: (projectPath, directoryRelativePath) => window.electronAPI.listProjectDirectoryFiles(projectPath, directoryRelativePath),
  readTextFile: async (projectPath, relativePath) => {
    try {
      const result = await window.electronAPI.readProjectFile(projectPath, relativePath)
      return result.content
    } catch {
      return null
    }
  },
}

type UseEditorRunActionsArgs = {
  projectId: string
  projectPath: string
  activeRelativePath: string | null
  editorValue: string
}

export function useEditorRunActions({ projectId, projectPath, activeRelativePath, editorValue }: UseEditorRunActionsArgs) {
  const { t } = useI18n()
  const [runActions, setRunActions] = useState<RunAction[]>([])
  const resolveRequestRef = useRef(0)

  // 文件切换时立即清空旧动作：悬浮入口不随旧文件残留到新文件上（防抖解析完成后再出现）。
  useEffect(() => {
    setRunActions([])
  }, [activeRelativePath])

  useEffect(() => {
    if (!activeRelativePath) return
    const requestId = resolveRequestRef.current + 1
    resolveRequestRef.current = requestId
    const timerId = window.setTimeout(() => {
      void (async () => {
        const absolutePath = joinProjectPath(projectPath, activeRelativePath)
        const useWsl = resolveProcessUseWsl(absolutePath) ?? false
        try {
          const context = await resolveRunContext(runContextResolverDeps, {
            projectPath,
            relativePath: activeRelativePath,
            content: editorValue,
            useWsl,
          })
          // 版本校验：文件已再次切换/编辑时丢弃旧结果（§4.4）。
          if (resolveRequestRef.current !== requestId) return
          setRunActions(resolveRunActions(runActionProviders, context))
        } catch {
          if (resolveRequestRef.current === requestId) setRunActions([])
        }
      })()
    }, EDITOR_RUN_RESOLVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timerId)
  }, [activeRelativePath, editorValue, projectPath])

  const runAction = useCallback(
    (action: RunAction) => {
      // 不只靠行号/缓存识别：执行前核对脚本名在当前内容中仍存在，已删除则提示而非执行过期动作（§2.2）。
      const execution = action.execution
      if (execution.type === 'package-script') {
        const entries = parsePackageScriptsWithLines(editorValue)
        if (!entries?.some((entry) => entry.name === execution.scriptName)) {
          toast.error(t('codeWorkspace.runActionStale', { name: execution.scriptName }))
          return
        }
      }
      const deps = createAppStoreTerminalDeps(useAppStore, {
        onProcessOutput: window.electronAPI.onProcessOutput,
        openPathTerminal: (cwdPath, terminalCommand) => window.electronAPI.openPathTerminal(cwdPath, terminalCommand),
      })
      void executeRunAction(deps, {
        projectId,
        action,
        useWsl: resolveProcessUseWsl(action.execution.cwd) ?? false,
        notifyLaunchFailure: () => toast.error(t('codeFileTree.terminalLaunchFailed')),
      })
    },
    [editorValue, projectId, t],
  )

  return { runActions, runAction }
}
