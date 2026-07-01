import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { AgentLogCollapsibleJson } from './AgentLogCollapsibleJson'

type AgentLogMarkdownViewProps = {
  markdown: string
  loading: boolean
}

type MarkdownDisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; raw: string; value: unknown }

function flushTextBlock(blocks: MarkdownDisplayBlock[], lines: string[]) {
  if (lines.length === 0) return
  const text = lines.join('\n')
  if (text.trim() || blocks.length > 0) {
    blocks.push({ type: 'text', text })
  }
  lines.length = 0
}

function parseJsonFence(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

function parseMarkdownDisplayBlocks(markdown: string): MarkdownDisplayBlock[] {
  const blocks: MarkdownDisplayBlock[] = []
  const textLines: string[] = []
  const lines = markdown.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^```([^\s`]*)\s*$/)

    if (!fenceMatch) {
      textLines.push(line)
      continue
    }

    const language = fenceMatch[1]?.toLowerCase()
    const codeLines: string[] = []
    let closed = false

    index += 1
    for (; index < lines.length; index += 1) {
      if (/^```\s*$/.test(lines[index])) {
        closed = true
        break
      }
      codeLines.push(lines[index])
    }

    const raw = codeLines.join('\n')
    const parsedJson = language === 'json' && closed ? parseJsonFence(raw) : { ok: false as const }

    if (parsedJson.ok) {
      flushTextBlock(blocks, textLines)
      blocks.push({ type: 'json', raw, value: parsedJson.value })
    } else {
      textLines.push(line, ...codeLines)
      if (closed) textLines.push('```')
    }
  }

  flushTextBlock(blocks, textLines)
  return blocks
}

export function AgentLogMarkdownView({ markdown, loading }: AgentLogMarkdownViewProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const blocks = loading || !markdown ? [] : parseMarkdownDisplayBlocks(markdown)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    if (!markdown) return
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="h-9 rounded-full px-3 text-xs"
          onClick={() => void handleCopy()}
          disabled={loading || !markdown}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('common.copied') : t('settings.agentLogs.copyMarkdown')}
        </Button>
      </div>
      {loading || !markdown ? (
        <pre className="max-h-[620px] overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap break-all">
          {loading ? t('common.loading') : t('settings.agentLogs.noMarkdown')}
        </pre>
      ) : (
        <div className="max-h-[620px] space-y-3 overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4">
          {blocks.map((block, index) => block.type === 'json' ? (
            <AgentLogCollapsibleJson
              key={`${index}:${block.raw}`}
              value={block.value}
              copyText={block.raw}
              defaultExpandedDepth={1}
              maxHeightClassName="max-h-[460px]"
              className="bg-[color:var(--color-card)]"
            />
          ) : (
            <pre
              key={`${index}:${block.text}`}
              className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-[color:var(--color-foreground)]"
            >
              {block.text}
            </pre>
          ))}
        </div>
      )}
    </div>
  )
}
