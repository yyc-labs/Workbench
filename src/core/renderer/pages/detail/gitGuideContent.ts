export type GitGuideSection = {
  title: string
  lines: string[]
}

export const GIT_GUIDE_TITLE = 'Git 操作指南（新手版）'

export const GIT_GUIDE_SECTIONS: GitGuideSection[] = [
  {
    title: '先看 3 个字段',
    lines: [
      'Current：你现在所在的本地分支。',
      'Upstream：Current 默认跟踪的远程分支。',
      'Merge Target：你想切换/合并的目标分支。',
    ],
  },
  {
    title: '按钮怎么用',
    lines: [
      'Fetch：刷新远程分支和提交信息（安全，建议先点）。',
      'Pull：把 upstream 的新提交拉到当前分支。',
      'Push：把当前分支提交推到远程。',
      'Switch：切到 Merge Target。',
      // 'Create Remote：在远程创建分支并建立跟踪。',
      'Merge：把 Merge Target 合并到当前分支。',
    ],
  },
  {
    title: '最常见场景',
    lines: [
      '1. 切换远程分支：先 Fetch，选 origin/xxx，再点 Switch。',
      '2. 第一次推分支：点 Push，会自动建立 upstream。',
      '3. Current/Upstream 卡片：点击可打开分支管理弹窗（新增/删除本地分支、创建远程或仅绑定 upstream）。',
    ],
  },
]
