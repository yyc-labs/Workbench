import { useEffect } from 'react'
import { useAppStore } from '../../stores/appStore'
import { FloatingTerminalPanel } from './FloatingTerminalPanel'

/**
 * 浮动终端层：单面板多标签（VS Code 式），挂载在 App 壳层（Routes 外），position: fixed 不参与文档流。
 * z-index 基础 9000 段，置顶递增上限 9997，永远低于弹层（ContextCascader 9999 / ModalShell 10040）。
 */
export function FloatingTerminalLayer() {
  const instances = useAppStore((s) => s.floatingTerminals)
  const activeId = useAppStore((s) => s.activeFloatingTerminalId)
  const persistedFloatingTerminals = useAppStore((s) => s.config.floatingTerminals)
  const hydrateFloatingTerminals = useAppStore((s) => s.hydrateFloatingTerminals)

  // 挂载时从 config 恢复：仅保留主进程仍存活的会话（死会话清空后再渲染，不出「重新连接」死标签）。
  useEffect(() => {
    void hydrateFloatingTerminals()
  }, [hydrateFloatingTerminals, persistedFloatingTerminals])

  const visible = instances.filter((instance) => !instance.hidden)
  if (visible.length === 0) return null
  const activeInstance = visible.find((instance) => instance.id === activeId) ?? visible[0]

  return <FloatingTerminalPanel instances={visible} activeInstance={activeInstance} />
}
