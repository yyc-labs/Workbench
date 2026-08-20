import { useMemo, useState } from 'react'
import { FileText, Table2 } from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { useI18n } from '../../../i18n'
import { MonacoCodeEditor } from '../MonacoCodeEditor'
import { parseDelimited } from './csvParser'
import { FileViewerOpenButton, FileViewerShell } from './fileViewerShared'

type FileCsvViewerProps = {
  sourceText: string
  projectPath: string
  relativePath: string
  monacoTheme: 'vs' | 'vs-dark'
}

type CsvViewMode = 'table' | 'text'

const MAX_TABLE_ROWS = 500

export function FileCsvViewer({ sourceText, projectPath, relativePath, monacoTheme }: FileCsvViewerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<CsvViewMode>('table')

  const delimiter: ',' | '\t' = relativePath.toLowerCase().endsWith('.tsv') ? '\t' : ','
  const rows = useMemo(() => parseDelimited(sourceText, delimiter), [sourceText, delimiter])
  const isTruncated = rows.length > MAX_TABLE_ROWS
  const visibleRows = isTruncated ? rows.slice(0, MAX_TABLE_ROWS) : rows
  const [headerRow, ...bodyRows] = visibleRows

  return (
    <FileViewerShell
      title={relativePath}
      actions={
        <>
          <div className="code-editor-preview-mode-group">
            <Tooltip content={t('codeWorkspace.csvViewTable')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'table' ? 'is-active' : ''}`} onClick={() => setMode('table')}>
                <Table2 className="h-3.5 w-3.5" />
                {t('codeWorkspace.csvViewTable')}
              </button>
            </Tooltip>
            <Tooltip content={t('codeWorkspace.csvViewText')} interactive={false}>
              <button type="button" className={`code-editor-preview-mode-btn ${mode === 'text' ? 'is-active' : ''}`} onClick={() => setMode('text')}>
                <FileText className="h-3.5 w-3.5" />
                {t('codeWorkspace.csvViewText')}
              </button>
            </Tooltip>
          </div>
          <FileViewerOpenButton projectPath={projectPath} relativePath={relativePath} />
        </>
      }
    >
      {mode === 'table' ? (
        <>
          {isTruncated ? <div className="code-file-viewer-error">{t('codeWorkspace.csvTooManyRows')}</div> : null}
          <div className="code-file-table-scroll">
            <table className="code-file-table">
              {headerRow ? (
                <thead>
                  <tr>
                    {headerRow.map((cell, index) => (
                      <th key={index}>{cell}</th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <MonacoCodeEditor filePath={relativePath} value={sourceText} language="plaintext" theme={monacoTheme} isReadOnly onChange={() => {}} onSave={() => {}} />
      )}
    </FileViewerShell>
  )
}
