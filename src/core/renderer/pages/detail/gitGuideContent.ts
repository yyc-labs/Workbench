import { translateCurrent } from '../../i18n'

export type GitGuideSection = {
  title: string
  lines: string[]
}

export function getGitGuideTitle(): string {
  return translateCurrent('detail.gitGuideTitle')
}

export function getGitGuideSections(): GitGuideSection[] {
  return [
    {
      title: translateCurrent('detail.gitGuideIntro'),
      lines: [
        translateCurrent('detail.gitGuideCurrentLine'),
        translateCurrent('detail.gitGuideUpstreamLine'),
        translateCurrent('detail.gitGuideMergeTargetLine'),
      ],
    },
    {
      title: translateCurrent('detail.gitGuideButtons'),
      lines: [
        `${translateCurrent('detail.gitOpFetch')}: ${translateCurrent('detail.gitOpDescFetch')}.`,
        `${translateCurrent('detail.gitOpPull')}: ${translateCurrent('detail.gitOpDescPull')}.`,
        `${translateCurrent('detail.gitOpPush')}: ${translateCurrent('detail.gitOpDescPush')}.`,
        `${translateCurrent('detail.gitOpSwitch')}: ${translateCurrent('detail.gitOpDescSwitch')}.`,
        `${translateCurrent('detail.gitOpMerge')}: ${translateCurrent('detail.gitOpDescMerge')}.`,
      ],
    },
    {
      title: translateCurrent('detail.gitGuideCommon'),
      lines: [
        translateCurrent('detail.gitGuideScenarioOne'),
        translateCurrent('detail.gitGuideScenarioTwo'),
        translateCurrent('detail.gitGuideScenarioThree'),
      ],
    },
  ]
}
