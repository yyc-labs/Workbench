import { protocol } from 'electron'
import { projectIdFromPath } from '../../../shared/rules'
import { loadConfig } from '../config'
import { injectHtmlPreviewBootstrap, isHtmlPreviewContentType } from './project-file-preview-inject'
import { mimeTypeFromPreviewPath, openValidatedFileHandle } from './shared'

const WORKBENCH_SCHEME = 'yyc-workbench'

export function registerYycWorkbenchScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WORKBENCH_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        bypassCSP: false,
        stream: false,
      },
    },
  ])
}

export function registerYycWorkbenchHandler(): void {
  protocol.handle(WORKBENCH_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const projectId = url.hostname
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const previewTheme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
      const project = loadConfig().projects.find((item) => projectIdFromPath(item.path) === projectId)
      if (!project) {
        return new Response('Not Found', { status: 404 })
      }

      const opened = await openValidatedFileHandle(project.path, relativePath)
      const { fileHandle } = opened
      try {
        const buffer = await fileHandle.readFile()
        const contentType = mimeTypeFromPreviewPath(relativePath)
        if (isHtmlPreviewContentType(contentType)) {
          // Inject fallback CSS variables / icon font into standalone preview docs.
          return new Response(injectHtmlPreviewBootstrap(buffer, previewTheme), {
            headers: { 'content-type': `${contentType}; charset=utf-8`, 'cache-control': 'no-cache' },
          })
        }
        return new Response(buffer, {
          headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
        })
      } finally {
        await fileHandle.close().catch(() => undefined)
      }
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
