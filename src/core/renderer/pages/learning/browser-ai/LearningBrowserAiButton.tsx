import { Sparkles } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'

type LearningBrowserAiButtonProps = {
  disabled?: boolean
  onClick: () => void
}

export function LearningBrowserAiButton({ disabled, onClick }: LearningBrowserAiButtonProps) {
  const { t } = useI18n()
  return (
    <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={onClick}>
      <Sparkles className="h-4 w-4" />
      {t('learning.browserAi.open')}
    </Button>
  )
}
