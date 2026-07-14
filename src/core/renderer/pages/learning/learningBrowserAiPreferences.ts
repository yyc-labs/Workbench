const LEARNING_BROWSER_AI_PREFERENCES_KEY = 'app:learning-browser-ai-preferences'

export type LearningBrowserAiPreferences = {
  defaultNoteIds: string[]
  savePromptByDefault: boolean
}

const DEFAULT_PREFERENCES: LearningBrowserAiPreferences = {
  defaultNoteIds: [],
  savePromptByDefault: false,
}

export function readLearningBrowserAiPreferences(): LearningBrowserAiPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(LEARNING_BROWSER_AI_PREFERENCES_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed = JSON.parse(raw) as Partial<LearningBrowserAiPreferences>
    return {
      defaultNoteIds: Array.isArray(parsed.defaultNoteIds)
        ? Array.from(new Set(parsed.defaultNoteIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim())))
        : [],
      savePromptByDefault: parsed.savePromptByDefault === true,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function saveLearningBrowserAiPreferences(preferences: LearningBrowserAiPreferences): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LEARNING_BROWSER_AI_PREFERENCES_KEY, JSON.stringify({
    defaultNoteIds: Array.from(new Set(preferences.defaultNoteIds.filter(Boolean))),
    savePromptByDefault: preferences.savePromptByDefault,
  }))
}
