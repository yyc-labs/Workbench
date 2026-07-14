import type { BrowserAiPreferences } from '../../../../shared/types'

const LEARNING_BROWSER_AI_PREFERENCES_KEY = 'app:learning-browser-ai-preferences'

export type LearningBrowserAiPreferences = BrowserAiPreferences

const DEFAULT_PREFERENCES: LearningBrowserAiPreferences = {
  defaultSkillIds: [],
  defaultNoteIds: [],
  includeCurrentNoteByDefault: false,
  savePromptByDefault: false,
}

export function readLearningBrowserAiPreferences(): LearningBrowserAiPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(LEARNING_BROWSER_AI_PREFERENCES_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed = JSON.parse(raw) as Partial<LearningBrowserAiPreferences>
    return {
      defaultSkillIds: Array.isArray(parsed.defaultSkillIds) ? Array.from(new Set(parsed.defaultSkillIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))) : [],
      defaultNoteIds: Array.isArray(parsed.defaultNoteIds) ? Array.from(new Set(parsed.defaultNoteIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))) : [],
      includeCurrentNoteByDefault: parsed.includeCurrentNoteByDefault === true,
      savePromptByDefault: parsed.savePromptByDefault === true,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function saveLearningBrowserAiPreferences(preferences: LearningBrowserAiPreferences): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    LEARNING_BROWSER_AI_PREFERENCES_KEY,
    JSON.stringify({
      defaultSkillIds: Array.from(new Set(preferences.defaultSkillIds.filter(Boolean))),
      defaultNoteIds: Array.from(new Set(preferences.defaultNoteIds.filter(Boolean))),
      includeCurrentNoteByDefault: preferences.includeCurrentNoteByDefault,
      savePromptByDefault: preferences.savePromptByDefault,
    }),
  )
}
