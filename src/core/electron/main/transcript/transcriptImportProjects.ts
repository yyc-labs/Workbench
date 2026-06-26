import path from 'path'
import { loadConfig } from '../config'
import { projectIdFromPath } from '../../../shared/rules'

export function listTranscriptImportProjects() {
  return loadConfig().projects.map((project) => {
    const projectId = projectIdFromPath(project.path)
    const name = path.basename(project.path) || project.path
    const customName = project.customName?.trim() || undefined
    return {
      projectId,
      projectPath: project.path,
      name,
      customName,
      displayName: customName || name,
    }
  })
}
