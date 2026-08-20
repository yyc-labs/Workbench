import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileMediaViewerProps = {
  dataUrl: string
  kind: 'video' | 'audio'
  projectPath: string
  relativePath: string
}

function decodeDataUrlToBlobUrl(dataUrl: string): { blobUrl: string; type: string } {
  const [meta, payload] = dataUrl.split(',')
  const type = meta?.replace('data:', '') ?? ''
  if (!payload) throw new Error('missing base64 payload')
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const blob = new Blob([bytes], { type })
  return { blobUrl: URL.createObjectURL(blob), type }
}

export function FileMediaViewer({ dataUrl, kind, projectPath, relativePath }: FileMediaViewerProps) {
  const { t } = useI18n()
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let createdUrl: string | null = null
    try {
      const { blobUrl: nextUrl } = decodeDataUrlToBlobUrl(dataUrl)
      createdUrl = nextUrl
      if (active) {
        setBlobUrl(nextUrl)
        setError(null)
      }
    } catch (err) {
      if (active) {
        setBlobUrl(null)
        setError(t(kind === 'video' ? 'codeWorkspace.videoNotPlayable' : 'codeWorkspace.audioNotPlayable'))
      }
    }
    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
      setBlobUrl(null)
    }
  }, [dataUrl, kind, t])

  const playErrorMessage = t(kind === 'video' ? 'codeWorkspace.videoNotPlayable' : 'codeWorkspace.audioNotPlayable')

  return (
    <FileViewerShell title={relativePath} actions={<FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />}>
      {error ? <div className="code-file-viewer-error">{error}</div> : null}
      {!error && blobUrl ? kind === 'video' ? <video controls src={blobUrl} className="code-file-viewer-media" onError={() => setError(playErrorMessage)} /> : <audio controls src={blobUrl} className="code-file-viewer-audio" onError={() => setError(playErrorMessage)} /> : null}
    </FileViewerShell>
  )
}
