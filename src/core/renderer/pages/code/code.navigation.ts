export type CodeWorkspaceRevealTarget = {
  relativePath: string
  lineNumber: number
  column: number
}

export type CodeWorkspaceNavigationState = {
  revealTarget?: CodeWorkspaceRevealTarget
}
