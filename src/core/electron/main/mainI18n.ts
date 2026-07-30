import type { AppLocale } from '../../shared/types'

export type MainLocale = Exclude<AppLocale, 'system'>

const FALLBACK_MAIN_LOCALE: MainLocale = 'en-US'

const mainMessages = {
  'en-US': {
    tray: {
      showMainWindow: 'Show Main Window',
      hideMainWindow: 'Hide Main Window',
      openHome: 'Open Home',
      openSettings: 'Open Settings',
      quitApp: 'Quit IDE Electron',
    },
    feishu: {
      unknownProject: 'Unknown Project',
      waitingApproval: 'Waiting for Approval',
      sessionEnded: 'Session Ended',
      completed: 'Completed',
      agentLabel: 'Agent',
      eventLabel: 'Event',
      timeLabel: 'Time',
      toolLabel: 'Tool',
      permissionModeLabel: 'Permission Mode',
      directoryLabel: 'Directory',
      sessionLabel: 'Session',
      turnLabel: 'Turn',
    },
    git: {
      noTextualPatchOutput: '(no textual patch output)',
      diffEmptyHint: 'Git status shows this file changed, but the diff is currently empty.',
      diffEmptyCause: 'This is usually caused by CRLF/LF normalization differences.',
      file: 'File: {value}',
      status: 'Status: scope={scope}, index={index}, worktree={worktree}',
      eol: 'EOL: {value}',
      confirmCommand: 'You can run: git ls-files --eol -- "<file>" to confirm.',
    },
    learning: {
      defaults: {
        newNoteTitle: 'New Learning Note',
        introLine: 'What I learned today:',
      },
    },
    browserScreenshot: {
      triggerLabel: 'Screenshot',
      fixedPolicy: 'Floating elements',
      keepFixed: 'Keep page elements',
      hideFixed: 'Hide fixed and sticky elements',
      chooseContainer: 'Choose a scroll container',
      chooseElements: 'Mark elements, then press Enter to capture',
      markElement: 'Mark element',
      cancelMark: 'Cancel marking',
      cancelAction: 'Cancel',
      viewMarked: 'View marked elements',
      editMarked: 'Edit marked elements',
      lastAppearance: 'Show only in the last segment',
      firstAppearance: 'Show only in the first segment',
      alwaysHide: 'Hide in every segment',
      confirmElements: 'Press Enter to start capture',
      cancelSelection: 'Press Esc to cancel',
      markedSummary: 'Marked elements: {value}',
      fullPage: 'Full page',
      selectArea: 'Select area',
    },
  },
  'zh-CN': {
    tray: {
      showMainWindow: '显示主窗口',
      hideMainWindow: '隐藏主窗口',
      openHome: '打开首页',
      openSettings: '打开设置',
      quitApp: '退出 IDE Electron',
    },
    feishu: {
      unknownProject: '未知项目',
      waitingApproval: '等待确认',
      sessionEnded: '会话结束',
      completed: '已完成',
      agentLabel: 'Agent',
      eventLabel: '事件',
      timeLabel: '时间',
      toolLabel: '工具',
      permissionModeLabel: '权限模式',
      directoryLabel: '目录',
      sessionLabel: '会话',
      turnLabel: '轮次',
    },
    git: {
      noTextualPatchOutput: '(无文本 patch 输出)',
      diffEmptyHint: 'Git 状态显示该文件存在变更，但当前 diff 为空。',
      diffEmptyCause: '这通常是 CRLF/LF 行尾规范化导致的显示差异。',
      file: '文件: {value}',
      status: '状态: scope={scope}, index={index}, worktree={worktree}',
      eol: 'EOL: {value}',
      confirmCommand: '可执行: git ls-files --eol -- "<file>" 进一步确认。',
    },
    learning: {
      defaults: {
        newNoteTitle: '新学习记录',
        introLine: '今天学习到：',
      },
    },
    browserScreenshot: {
      triggerLabel: '截图',
      fixedPolicy: '悬浮元素',
      keepFixed: '保留页面元素',
      hideFixed: '隐藏 fixed 和 sticky 元素',
      chooseContainer: '选择滚动容器',
      chooseElements: '标记元素，按 Enter 开始截图',
      markElement: '标记元素',
      cancelMark: '取消标记',
      cancelAction: '取消',
      viewMarked: '查看当前标记元素',
      editMarked: '编辑标记元素',
      lastAppearance: '仅在最后一段显示',
      firstAppearance: '仅在第一段显示',
      alwaysHide: '所有分段隐藏',
      confirmElements: '按 Enter 开始截图',
      cancelSelection: '按 Esc 取消',
      markedSummary: '已标记元素：{value} 个',
      fullPage: '整页截图',
      selectArea: '精准选择',
    },
  },
} as const

function readMainMessage(locale: MainLocale, key: string): string {
  const tree = mainMessages[locale] as Record<string, unknown>
  const segments = key.split('.')
  let current: unknown = tree

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return key
    }
    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' ? current : key
}

function interpolateMainMessage(template: string, values?: Record<string, number | string>): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function resolveMainLocale(locale: AppLocale | undefined, systemLocale: string | undefined): MainLocale {
  if (locale === 'zh-CN' || locale === 'en-US') return locale
  const normalizedSystemLocale = (systemLocale || '').toLowerCase()
  if (normalizedSystemLocale.startsWith('zh')) return 'zh-CN'
  if (normalizedSystemLocale.startsWith('en')) return 'en-US'
  return FALLBACK_MAIN_LOCALE
}

export function translateMain(locale: MainLocale, key: string, values?: Record<string, number | string>): string {
  return interpolateMainMessage(readMainMessage(locale, key), values)
}

export function toFeishuLocaleTag(locale: MainLocale): 'en_us' | 'zh_cn' {
  return locale === 'zh-CN' ? 'zh_cn' : 'en_us'
}
