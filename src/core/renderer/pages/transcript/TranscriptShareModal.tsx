import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, QrCode, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import QRCode from 'react-qr-code'
import type { TranscriptShareBindingMode, TranscriptShareEntry, TranscriptShareHost } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import { copyTextToClipboard } from '../code/code.clipboard'

type TranscriptShareModalProps = {
  open: boolean
  onClose: () => void
  entries: TranscriptShareEntry[]
  hosts: TranscriptShareHost[]
  port: number
  bindingMode: TranscriptShareBindingMode
  generating: boolean
  error: string | null
  onGenerate: () => void
  onRevoke: (token: string) => void
  onRevokeAll: () => void
}

function formatHostKind(kind: TranscriptShareHost['kind'], t: ReturnType<typeof useI18n>['t']): string {
  switch (kind) {
    case 'wifi':
      return t('transcript.shareHostKindWifi')
    case 'ethernet':
      return t('transcript.shareHostKindEthernet')
    case 'vpn':
      return t('transcript.shareHostKindVpn')
    case 'virtual':
      return t('transcript.shareHostKindVirtual')
    default:
      return t('transcript.shareHostKindOther')
  }
}

function replaceShareUrlHost(url: string, host: string, port: number): string {
  try {
    const parsed = new URL(url)
    parsed.hostname = host
    parsed.port = String(port)
    return parsed.toString()
  } catch {
    return url
  }
}

function ShareLinkRow({
  entry,
  hosts,
  port,
  onShowQr,
  onRevoke,
}: {
  entry: TranscriptShareEntry
  hosts: TranscriptShareHost[]
  port: number
  onShowQr: (entry: TranscriptShareEntry) => void
  onRevoke: (token: string) => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const alternateUrls = hosts
    .map((item) => ({
      key: `${item.interfaceName}:${item.host}`,
      label: `${item.interfaceName} · ${formatHostKind(item.kind, t)}`,
      url: replaceShareUrlHost(entry.url, item.host, port),
    }))
    .filter((item, index, list) => item.url !== entry.url && list.findIndex((other) => other.url === item.url) === index)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(entry.url)
    setCopied(ok)
  }, [entry.url])

  const handleOpen = useCallback(() => {
    void window.electronAPI.openExternal(entry.url)
  }, [entry.url])

  return (
    <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
        <div className="min-w-0 flex-1">
          <code className="block truncate text-xs text-[color:var(--color-foreground)]" title={entry.url}>
            {entry.url}
          </code>
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
          onClick={handleOpen}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('common.open')}
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('transcript.shareCopied') : t('transcript.shareCopy')}
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
          onClick={() => onShowQr(entry)}
        >
          <QrCode className="h-3.5 w-3.5" />
          {t('transcript.shareShowQr')}
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
          onClick={() => onRevoke(entry.token)}
          title={t('transcript.shareRevoke')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {alternateUrls.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-[color:var(--color-border)] pt-2">
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {t('transcript.shareAlternateLinks')}
          </p>
          {alternateUrls.map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--color-muted-foreground)]" title={item.url}>
                {item.url}
              </code>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => {
                  void window.electronAPI.openExternal(item.url)
                }}
                title={item.label}
              >
                <ExternalLink className="h-3 w-3" />
                {t('common.open')}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-full border border-[color:var(--color-border)] px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => void copyTextToClipboard(item.url)}
                title={item.label}
              >
                {t('transcript.shareCopyAlternate')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TranscriptShareModal({
  open,
  onClose,
  entries,
  hosts,
  port,
  bindingMode,
  generating,
  error,
  onGenerate,
  onRevoke,
  onRevokeAll,
}: TranscriptShareModalProps) {
  const { t } = useI18n()
  const [qrEntry, setQrEntry] = useState<TranscriptShareEntry | null>(null)
  const [qrCopied, setQrCopied] = useState(false)
  const healthUrls = hosts.map((item) => `http://${item.host}:${port}/health`)

  useEffect(() => {
    if (!open) {
      setQrEntry(null)
      setQrCopied(false)
    }
  }, [open])

  useEffect(() => {
    if (!qrCopied) return
    const timer = window.setTimeout(() => setQrCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [qrCopied])

  const handleCopyQrValue = useCallback(async () => {
    if (!qrEntry) return
    const ok = await copyTextToClipboard(qrEntry.url)
    setQrCopied(ok)
  }, [qrEntry])

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        widthClassName="max-w-[min(700px,calc(100vw-40px))]"
        baseZIndex={1160}
        ariaLabel={t('transcript.shareTitle')}
        panelClassName="flex max-h-[min(88vh,920px)] flex-col overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[color:var(--color-border)] px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="section-label mb-1">{t('transcript.share')}</p>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {t('transcript.shareTitle')}
                </p>
                <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                  {t('transcript.shareDescription')}
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={onClose}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onGenerate}
              disabled={generating}
            >
              {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {generating ? t('transcript.shareGenerating') : t('transcript.shareGenerate')}
            </button>

            {error && (
              <p className="mt-2 text-xs text-[color:var(--color-destructive)]">{error}</p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-3">
              <p className="text-xs font-medium text-[color:var(--color-foreground)]">
                {t('transcript.shareReachableHosts')}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                {bindingMode === 'loopback'
                  ? t('transcript.shareLoopbackHint')
                  : t('transcript.shareReachableHostsHint')}
              </p>
              <div className="mt-3 space-y-2">
                {hosts.length <= 0 ? (
                  <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                    {t('transcript.shareReachableHostsEmpty')}
                  </p>
                ) : (
                  hosts.map((item) => (
                    <div
                      key={`${item.interfaceName}:${item.host}`}
                      className="flex items-center gap-2 rounded-[12px] border border-[color:var(--color-border)] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[color:var(--color-foreground)]">
                          {item.host}
                        </p>
                        <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                          {item.interfaceName} · {formatHostKind(item.kind, t)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                        onClick={() => void copyTextToClipboard(`http://${item.host}:${port}`)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('transcript.shareCopyHost')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-[color:var(--color-foreground)]">
                {t('transcript.shareActiveLinks')}
              </p>
              {entries.length > 0 && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                  onClick={onRevokeAll}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('transcript.shareRevokeAll')}
                </button>
              )}
            </div>

            <div className="mt-2 space-y-2">
              {entries.length <= 0 ? (
                <p className="rounded-[14px] border border-dashed border-[color:var(--color-border)] px-3 py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">
                  {t('transcript.shareNoLinks')}
                </p>
              ) : (
                entries.map((entry) => (
                  <ShareLinkRow
                    key={entry.token}
                    entry={entry}
                    hosts={hosts}
                    port={port}
                    onShowQr={setQrEntry}
                    onRevoke={onRevoke}
                  />
                ))
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-[color:var(--color-warning-border,var(--color-border))] bg-[color:var(--color-warning-background,transparent)] px-3 py-2.5">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                  {t('transcript.shareSecurityHint')}
                </p>
                {healthUrls.length > 0 && (
                  <p className="mt-1 break-all text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                    {t('transcript.shareHealthHint')} {healthUrls[0]}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(qrEntry)}
        onClose={() => setQrEntry(null)}
        widthClassName="max-w-[420px]"
        baseZIndex={1180}
        ariaLabel={t('transcript.shareQrTitle')}
      >
        {qrEntry && (
          <div>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="section-label mb-1">{t('transcript.share')}</p>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {t('transcript.shareQrTitle')}
                </p>
                <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                  {t('transcript.shareQrHint')}
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setQrEntry(null)}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col items-center rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)] px-4 py-5">
              <div className="rounded-[14px] bg-white p-3 shadow-sm">
                <QRCode
                  value={qrEntry.url}
                  size={220}
                  bgColor="#ffffff"
                  fgColor="#111111"
                />
              </div>
              <code className="mt-4 block max-w-full break-all text-center text-[11px] text-[color:var(--color-muted-foreground)]">
                {qrEntry.url}
              </code>
              <button
                type="button"
                className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => void handleCopyQrValue()}
              >
                {qrCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {qrCopied ? t('transcript.shareCopied') : t('transcript.shareCopyQr')}
              </button>
            </div>
          </div>
        )}
      </ModalShell>
    </>
  )
}
