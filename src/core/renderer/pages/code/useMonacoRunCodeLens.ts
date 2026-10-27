/**
 * 19 号计划 §2.2 方式 B（回退方案）：CodeLens 行级运行入口。
 * 行级悬停按钮为优先方案，但现有 gutter 的 GUTTER_LINE_DECORATIONS 区已被转录标记占用
 * （useMonacoTranscriptGutter 的 hover 卡片与滚动收起逻辑），第一版先落 CodeLens 验证运行闭环，
 * 行级悬停作为后续优化（不为一个图标重构整套编辑器）。
 * 全局注册一次 provider，lens 随 model / actions 重算；只对持本 hook 的编辑器实例生效，避免多实例重复。
 */

import type { editor as MonacoEditor, languages as MonacoLanguages } from 'monaco-editor'
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import type { RunAction } from '../../lib/runActions/types'
import { resolveFilePathFromModelUri } from './code.importLink'

type UseMonacoRunCodeLensOptions = {
  editorRef: MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>
  monacoRef: MutableRefObject<typeof import('monaco-editor') | null>
  actions: RunAction[]
  projectPath?: string | null
  onRunAction: (action: RunAction) => void
}

type CodeLensDisposable = { dispose: () => void }

export function useMonacoRunCodeLens({ editorRef, monacoRef, actions, projectPath, onRunAction }: UseMonacoRunCodeLensOptions) {
  const { t } = useI18n()
  // editor 实例版本信号：MonacoCodeEditor 异步创建编辑器，就绪后调用 syncEditorInstance。
  const [editorInstance, setEditorInstance] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)

  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const onRunActionRef = useRef(onRunAction)
  onRunActionRef.current = onRunAction
  // lens 文案随 locale 更新：runLensLabelRef 供 provider 读取最新 t。
  const runLensLabelRef = useRef(() => t('codeWorkspace.runLensAction'))
  runLensLabelRef.current = () => t('codeWorkspace.runLensAction')
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath

  // 只需要 fire：emitter 的 dispose 走 effect 内局部 cleanup。
  const lensChangeFireRef = useRef<(() => void) | null>(null)

  const syncEditorInstance = useCallback((editor: MonacoEditor.IStandaloneCodeEditor | null) => {
    setEditorInstance(editor)
  }, [])

  // actions 变化（防抖解析完成 / 文件切换）→ 通知 Monaco 重算 lens。
  useEffect(() => {
    lensChangeFireRef.current?.()
  }, [actions])

  // provider 注册：editor 实例变更时重建，卸载时统一 dispose。
  useEffect(() => {
    const editor = editorInstance
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    const disposables: CodeLensDisposable[] = []
    const runCommandId = editor.addCommand(0, (_, actionId: string) => {
      const action = actionsRef.current.find((item) => item.id === actionId)
      if (action) onRunActionRef.current(action)
    })

    const changeEmitter = new monaco.Emitter<void>()
    lensChangeFireRef.current = () => changeEmitter.fire()
    disposables.push(changeEmitter)

    const provider = monaco.languages.registerCodeLensProvider('*', {
      // Emitter<void> 的 event 与 IEvent<this> 形状不匹配，此处仅作事件源转发。
      onDidChange: changeEmitter.event as unknown as NonNullable<MonacoLanguages.CodeLensProvider['onDidChange']>,
      provideCodeLenses: (model) => {
        // 只服务持有本 hook 的编辑器实例当前 model：其他 Monaco 实例（预览等）不渲染运行 lens。
        if (editor.getModel() !== model) return { lenses: [], dispose: () => {} }
        const scoped = actionsRef.current.filter((action) => {
          if (action.source.line == null) return false
          return resolveFilePathFromModelUri(model.uri, projectPathRef.current ?? undefined) === action.source.filePath
        })
        return {
          lenses: scoped.map((action) => ({
            range: {
              startLineNumber: action.source.line as number,
              startColumn: 1,
              endLineNumber: action.source.line as number,
              endColumn: 1,
            },
            command: runCommandId ? { id: runCommandId, title: `${runLensLabelRef.current()} ${action.label}`, arguments: [action.id] } : undefined,
          })),
          dispose: () => {},
        }
      },
    })
    disposables.push(provider)

    return () => {
      lensChangeFireRef.current = null
      for (const disposable of disposables) disposable.dispose()
    }
  }, [editorInstance, monacoRef])

  return { syncEditorInstance }
}
