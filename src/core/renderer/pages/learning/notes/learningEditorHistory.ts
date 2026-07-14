export type LearningEditorSnapshot = {
  value: string
  selectionStart: number
  selectionEnd: number
}

export type LearningEditorHistoryState = {
  history: LearningEditorSnapshot[]
  index: number
}

export function createLearningEditorHistoryState(value: string, selectionStart = 0, selectionEnd = selectionStart): LearningEditorHistoryState {
  return {
    history: [
      {
        value,
        selectionStart,
        selectionEnd,
      },
    ],
    index: 0,
  }
}

export function pushLearningEditorSnapshot(state: LearningEditorHistoryState, snapshot: LearningEditorSnapshot, limit: number): LearningEditorHistoryState {
  const currentIndex = state.history.length > 0 ? Math.min(Math.max(state.index, 0), state.history.length - 1) : -1
  const currentSnapshot = currentIndex >= 0 ? state.history[currentIndex] : undefined
  if (currentSnapshot && currentSnapshot.value === snapshot.value && currentSnapshot.selectionStart === snapshot.selectionStart && currentSnapshot.selectionEnd === snapshot.selectionEnd) {
    return state
  }

  const nextHistory = currentIndex >= 0 ? state.history.slice(0, currentIndex + 1) : []
  nextHistory.push(snapshot)

  const normalizedLimit = Math.max(1, Math.trunc(limit) || 1)
  if (nextHistory.length > normalizedLimit) {
    nextHistory.splice(0, nextHistory.length - normalizedLimit)
  }

  return {
    history: nextHistory,
    index: nextHistory.length - 1,
  }
}

export function updateLearningEditorSnapshotSelection(state: LearningEditorHistoryState, selectionStart: number, selectionEnd: number): LearningEditorHistoryState {
  if (state.history.length === 0) return state

  const currentIndex = Math.min(Math.max(state.index, 0), state.history.length - 1)
  const currentSnapshot = state.history[currentIndex]
  if (currentSnapshot.selectionStart === selectionStart && currentSnapshot.selectionEnd === selectionEnd) {
    return state
  }

  const nextHistory = state.history.slice()
  nextHistory[currentIndex] = {
    ...currentSnapshot,
    selectionStart,
    selectionEnd,
  }

  return {
    history: nextHistory,
    index: currentIndex,
  }
}
