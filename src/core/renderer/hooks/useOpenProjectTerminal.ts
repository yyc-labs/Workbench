import { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'

/**
 * 打开终端集合面板（Ctrl+J）并聚焦指定项目的终端。
 *
 * 跨页面调用（查看日志 / 项目卡 / 运行任务对话框 / Transcript 等）：面板是全局层，
 * 直接唤起并定位，无需跳转路由。focusProcessKey 为空串时只定位项目，
 * 组件回落到该项目第一个终端。
 */
export function useOpenProjectTerminal() {
  const revealTerminal = useAppStore((s) => s.revealTerminal)

  return useCallback(
    (projectId: string, focusProcessKey?: string) => {
      revealTerminal(projectId, focusProcessKey || undefined)
    },
    [revealTerminal],
  )
}
