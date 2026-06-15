export function createMermaidRenderConfig(themeMode: 'light' | 'dark') {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: themeMode === 'dark' ? 'dark' : 'default',
    // Mermaid 11 still reads top-level htmlLabels in some flowchart paths.
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
    },
  }
}
