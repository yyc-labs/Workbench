import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
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

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function MediaControls({ mediaRef }: { mediaRef: RefObject<HTMLMediaElement | null> }) {
  const { t } = useI18n()
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    const sync = () => {
      setPlaying(!media.paused && !media.ended)
      setMuted(media.muted)
      setCurrentTime(media.currentTime)
      setDuration(Number.isFinite(media.duration) ? media.duration : 0)
    }
    sync()
    const events = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'volumechange'] as const
    for (const event of events) media.addEventListener(event, sync)
    return () => {
      for (const event of events) media.removeEventListener(event, sync)
    }
  }, [mediaRef])

  const togglePlay = () => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }

  const toggleMute = () => {
    const media = mediaRef.current
    if (!media) return
    media.muted = !media.muted
  }

  const seek = (value: number) => {
    const media = mediaRef.current
    if (!media || !Number.isFinite(value)) return
    media.currentTime = value
    setCurrentTime(value)
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  const seekInput = (
    <input
      type="range"
      className="code-media-seek"
      min={0}
      max={duration > 0 ? duration : 1}
      step={0.1}
      value={Math.min(currentTime, duration > 0 ? duration : 0)}
      disabled={duration <= 0}
      onChange={(event) => seek(Number(event.target.value))}
      style={{ '--media-progress': `${progress}%` } as CSSProperties}
      aria-label={t('codeWorkspace.mediaSeek')}
    />
  )

  return (
    <div className={`code-media-controls${playing ? '' : ' is-paused'}`}>
      <button type="button" className="code-media-btn" onClick={togglePlay} title={t(playing ? 'codeWorkspace.mediaPause' : 'codeWorkspace.mediaPlay')} aria-label={t(playing ? 'codeWorkspace.mediaPause' : 'codeWorkspace.mediaPlay')}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span className="code-media-time">{formatMediaTime(currentTime)}</span>
      {seekInput}
      <span className="code-media-time">{formatMediaTime(duration)}</span>
      <button type="button" className="code-media-btn" onClick={toggleMute} title={t(muted ? 'codeWorkspace.mediaUnmute' : 'codeWorkspace.mediaMute')} aria-label={t(muted ? 'codeWorkspace.mediaUnmute' : 'codeWorkspace.mediaMute')}>
        {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export function FileMediaViewer({ dataUrl, kind, projectPath, relativePath }: FileMediaViewerProps) {
  const { t } = useI18n()
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let createdUrl: string | null = null
    let probe: HTMLVideoElement | null = null
    const handleProbeReady = () => {
      if (active) setReady(true)
    }
    try {
      const { blobUrl: nextUrl } = decodeDataUrlToBlobUrl(dataUrl)
      createdUrl = nextUrl
      if (active) {
        setBlobUrl(nextUrl)
        setError(null)
        if (kind === 'video') {
          // 先用离屏探针读取元数据，拿到真实尺寸后再挂载 video 容器，避免 300x150 默认占位导致 UI 跳动。
          setReady(false)
          probe = document.createElement('video')
          probe.preload = 'metadata'
          probe.muted = true
          probe.addEventListener('loadeddata', handleProbeReady)
          probe.src = nextUrl
        } else {
          setReady(true)
        }
      }
    } catch (err) {
      if (active) {
        setBlobUrl(null)
        setReady(false)
        setError(t(kind === 'video' ? 'codeWorkspace.videoNotPlayable' : 'codeWorkspace.audioNotPlayable'))
      }
    }
    return () => {
      active = false
      if (probe) {
        probe.removeEventListener('loadeddata', handleProbeReady)
        probe.removeAttribute('src')
        probe.load()
      }
      if (createdUrl) URL.revokeObjectURL(createdUrl)
      setBlobUrl(null)
    }
  }, [dataUrl, kind, t])

  const playErrorMessage = t(kind === 'video' ? 'codeWorkspace.videoNotPlayable' : 'codeWorkspace.audioNotPlayable')

  const toggleVideoPlay = () => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }

  return (
    <FileViewerShell title={relativePath} actions={<FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />}>
      {error ? <div className="code-file-viewer-error">{error}</div> : null}
      {!error && blobUrl && kind === 'video' && !ready ? (
        <div className="code-media-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
      {!error && blobUrl && ready ? (
        <div className={`code-file-viewer-media-shell${kind === 'audio' ? ' is-audio' : ''}`}>
          {kind === 'video' ? (
            <video
              ref={(el) => {
                mediaRef.current = el
              }}
              src={blobUrl}
              className="code-file-viewer-media"
              playsInline
              onClick={toggleVideoPlay}
              onError={() => setError(playErrorMessage)}
            />
          ) : (
            <audio
              ref={(el) => {
                mediaRef.current = el
              }}
              src={blobUrl}
              className="code-file-viewer-audio"
              onError={() => setError(playErrorMessage)}
            />
          )}
          <MediaControls mediaRef={mediaRef} />
        </div>
      ) : null}
    </FileViewerShell>
  )
}
