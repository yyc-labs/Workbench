import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppStore } from '../../stores/appStore'
import { getProjectIdFromPath } from '../../lib/routeProjectContext'
import { TerminalCollectionPanel } from './TerminalCollectionPanel'

const INVENTORY_POLL_INTERVAL_MS = 5000

/**
 * 终端集合面板层（Ctrl+J）：挂载在 App 壳层（Routes 外），position: fixed 不参与文档流。
 * 单面板聚合所有项目的终端：顶部项目 tab + 左侧终端列表，取代原项目坞与平铺浮动终端。
 */
export function TerminalCollectionLayer() {
  const hidden = useAppStore((s) => s.floatingPanel.hidden)
  const setTerminalInventory = useAppStore((s) => s.setTerminalInventory)
  const revealTerminal = useAppStore((s) => s.revealTerminal)
  const pendingTerminalFocus = useAppStore((s) => s.pendingTerminalFocus)
  const consumePendingTerminalFocus = useAppStore((s) => s.consumePendingTerminalFocus)
  const location = useLocation()
  // 项目路由上下文：项目 tab 置顶 + Ctrl+J 聚焦目标。
  const contextProjectId = useMemo(() => getProjectIdFromPath(location.pathname), [location.pathname])

  // 面板可见期间轮询主进程进程清单；隐藏时停止轮询。
  useEffect(() => {
    if (hidden) return
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await window.electronAPI.listTerminalProcesses()
        if (!cancelled && Array.isArray(data?.managedProcesses)) setTerminalInventory(data.managedProcesses)
      } catch {
        if (!cancelled) setTerminalInventory([])
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), INVENTORY_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hidden, setTerminalInventory])

  // 跨页面聚焦请求（查看日志 / 脚本终端落地 / 项目卡入口）：显示面板并定位目标。
  useEffect(() => {
    if (!pendingTerminalFocus) return
    revealTerminal(pendingTerminalFocus.projectId, pendingTerminalFocus.processKey)
    consumePendingTerminalFocus()
  }, [consumePendingTerminalFocus, pendingTerminalFocus, revealTerminal])

  if (hidden) return null
  return <TerminalCollectionPanel contextProjectId={contextProjectId} />
}
