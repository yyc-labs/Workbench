/**
 * 从路由 pathname 解析当前项目上下文：`/project/:projectId(/pane)` → projectId，其它路由 → undefined。
 * 供浮动终端（Ctrl+J）、最近项目抽屉、路由目录等共享「当前在哪个项目」的判定。
 */
export function getProjectIdFromPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'project' && segments[1] ? segments[1] : undefined
}
