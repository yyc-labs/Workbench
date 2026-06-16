import type { MermaidConfig } from 'mermaid'

export function createMermaidRenderConfig(themeMode: 'light' | 'dark'): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: themeMode === 'dark' ? 'dark' : 'default',
    // Mermaid 11 still reads top-level htmlLabels in some flowchart paths.
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
    },
  }
}
