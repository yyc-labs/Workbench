function stepStatusText(status: 'pending' | 'running' | 'success' | 'error'): string {
  if (status === 'success') return 'completed'
  if (status === 'running') return 'running'
  if (status === 'error') return 'failed'
  return 'pending'
}

function flowNodeTone(status: 'pending' | 'running' | 'success' | 'error'): {
  border: string
  background: string
  accent: string
  statusBackground: string
  statusText: string
} {
  if (status === 'success') {
    return {
      border: 'color-mix(in srgb, var(--color-success) 28%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-success-background) 95%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-success)',
      statusBackground: 'color-mix(in srgb, var(--color-success-background) 90%, transparent)',
      statusText: 'var(--color-success)',
    }
  }
  if (status === 'running') {
    return {
      border: 'color-mix(in srgb, var(--color-primary) 30%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-primary) 10%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-primary)',
      statusBackground: 'color-mix(in srgb, var(--color-primary) 13%, transparent)',
      statusText: 'var(--color-primary)',
    }
  }
  if (status === 'error') {
    return {
      border: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-destructive-background) 95%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-destructive)',
      statusBackground: 'color-mix(in srgb, var(--color-destructive-background) 90%, transparent)',
      statusText: 'var(--color-destructive)',
    }
  }
  return {
    border: 'color-mix(in srgb, var(--color-border) 85%, transparent)',
    background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-background-sunken) 62%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
    accent: 'color-mix(in srgb, var(--color-muted-foreground) 42%, transparent)',
    statusBackground: 'color-mix(in srgb, var(--color-background-sunken) 88%, transparent)',
    statusText: 'var(--color-muted-foreground)',
  }
}

export { flowNodeTone, stepStatusText }
