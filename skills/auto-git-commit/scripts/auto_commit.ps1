#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [ValidateSet('fix', 'feat', 'style', 'chore', 'refactor', 'docs', 'debug')]
  [string]$Type = '',
  [string]$Subject = '',
  [string[]]$Bullet = @(),
  [switch]$All,
  [switch]$IncludeUntracked,
  [switch]$DryRun,
  [switch]$Split,
  [switch]$SplitDryRun,
  [ValidateRange(1, 12)]
  [int]$SplitMaxBatches = 4,
  [switch]$UseAi,
  [string]$ApiBaseUrl = '',
  [string]$ApiKey = '',
  [string]$Model = ''
)

$ErrorActionPreference = 'Stop'

# Force UTF-8 for host output and native process interaction.
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$env:PYTHONIOENCODING = 'utf-8'
$env:LANG = 'C.UTF-8'
$env:LC_ALL = 'C.UTF-8'
$env:GIT_PAGER = 'cat'
$env:GIT_CONFIG_PARAMETERS = "'i18n.commitEncoding=utf-8' 'i18n.logOutputEncoding=utf-8' 'core.quotepath=false'"

function Write-Step([string]$Message) {
  Write-Host ("[auto-commit] " + $Message)
}

function Write-Ai([string]$Message) {
  Write-Host ("[ai] " + $Message)
}

function Normalize-String([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return $Value.Trim()
}

function Resolve-AiBaseUrl([string]$Value) {
  $raw = Normalize-String $Value
  if (-not $raw) { $raw = Normalize-String $env:AI_COMMIT_API_BASE_URL }
  if (-not $raw) { $raw = 'https://api.openai.com/v1' }
  $trimmed = $raw.TrimEnd('/')
  if ($trimmed -match '/v1$') {
    return ($trimmed + '/chat/completions')
  }
  return ($trimmed + '/v1/chat/completions')
}

function Resolve-AiKey([string]$Value) {
  $raw = Normalize-String $Value
  if ($raw) { return $raw }
  return Normalize-String $env:AI_COMMIT_API_KEY
}

function Resolve-AiModel([string]$Value) {
  $raw = Normalize-String $Value
  if ($raw) { return $raw }
  $envModel = Normalize-String $env:AI_COMMIT_MODEL
  if ($envModel) { return $envModel }
  return 'gpt-4o-mini'
}

function Resolve-CommitTypeFromFiles([string[]]$Files) {
  if ($Files -match '(^|/|\\)(docs|README|CHANGELOG)' -or $Files -match '\.md$') { return 'docs' }
  if ($Files -match '(^|/|\\)(src/renderer/)' -or $Files -match '\.(css|scss|less)$') { return 'style' }
  if ($Files -match '(^|/|\\)(package\.json|package-lock\.json|build/|script/|\.github/)') { return 'chore' }
  return 'fix'
}

function Is-ValidCommitType([string]$Value) {
  $clean = (Normalize-String $Value).ToLower()
  return @('fix', 'feat', 'style', 'chore', 'refactor', 'docs', 'debug') -contains $clean
}

function Contains-Cjk([string]$Text) {
  if (-not $Text) { return $false }
  return [regex]::IsMatch($Text, '[\u4E00-\u9FFF]')
}

function Get-DefaultChineseSubject([int]$FileCount) {
  $codePoints = @(0x66F4, 0x65B0, 0x4EE3, 0x7801, 0x6539, 0x52A8)
  $prefix = -join ($codePoints | ForEach-Object { [char]$_ })
  return ($prefix + ' (' + [string]$FileCount + ' files)')
}

function Ensure-ChineseSubject([string]$Candidate, [string]$Fallback) {
  $clean = Normalize-String $Candidate
  if (-not $clean) { return $Fallback }
  if (Contains-Cjk $clean) { return $clean }
  return $Fallback
}

function Normalize-ChineseBullets([object[]]$Items) {
  $result = @()
  foreach ($item in $Items) {
    $text = Normalize-String ([string]$item)
    if (-not $text) { continue }
    if (-not (Contains-Cjk $text)) { continue }
    $result += $text
  }
  return @($result | Select-Object -First 3)
}

function Test-GenericSubject([string]$Text) {
  $clean = Normalize-String $Text
  if (-not $clean) { return $true }

  $patterns = @(
    '^更新代码改动(\s*[\(（]\d+\s*files[\)）])?$',
    '^自动提交当前改动(\s*[\(（]\d+\s*files[\)）])?$',
    '^提交当前改动(\s*[\(（]\d+\s*files[\)）])?$',
    '^更新文件变更(\s*[\(（]\d+\s*files[\)）])?$',
    '^更新项目文件(\s*[\(（]\d+\s*files[\)）])?$'
  )
  foreach ($pattern in $patterns) {
    if ($clean -match $pattern) { return $true }
  }
  return $false
}

function Get-SubjectFromBullets([string[]]$Items) {
  foreach ($item in $Items) {
    $text = Normalize-String $item
    if (-not $text) { continue }
    if (-not (Contains-Cjk $text)) { continue }

    $text = $text -replace '^[\-\*]\s*', ''
    $text = $text -replace '[。；;,.，、\s]+$', ''
    if ($text.Length -gt 40) {
      $text = $text.Substring(0, 40)
    }
    return $text
  }
  return ''
}

function New-TempUtf8FilePath() {
  $name = 'ai-commit-msg-' + [Guid]::NewGuid().ToString('N') + '.txt'
  return Join-Path $env:TEMP $name
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Extract-JsonObject([string]$Text) {
  $trimmed = Normalize-String $Text
  if (-not $trimmed) { return '' }

  if ($trimmed.StartsWith('```')) {
    $trimmed = $trimmed -replace '^```json\s*', ''
    $trimmed = $trimmed -replace '^```\s*', ''
    $trimmed = $trimmed -replace '\s*```$', ''
    $trimmed = $trimmed.Trim()
  }

  $start = $trimmed.IndexOf('{')
  $end = $trimmed.LastIndexOf('}')
  if ($start -ge 0 -and $end -gt $start) {
    return $trimmed.Substring($start, $end - $start + 1)
  }
  return $trimmed
}

function New-AiPrompt([string]$Files, [string]$Stat, [string]$Patch) {
  return @"
Generate a Chinese git commit suggestion from staged changes.
Return JSON only with shape:
{"type":"fix|feat|style|chore|refactor|docs|debug","subject":"<=40 chars","bullets":["<=3 items, each <=50 chars"]}

Rules:
1) JSON only, no markdown.
2) subject and bullets MUST be Simplified Chinese.
3) subject MUST describe the most important concrete change, not file count or generic wording.
4) Do not use generic subjects like "更新代码改动", "提交当前改动", "更新文件变更".
5) Prefer deriving subject from the strongest summary bullet when appropriate.
6) bullets can be [].

Files:
$Files

Stats:
$Stat

Patch:
$Patch
"@
}

function Try-ApplyAiMessage([string]$CurrentType, [string]$CurrentSubject, [string[]]$CurrentBullets) {
  $apiKey = Resolve-AiKey $ApiKey
  if (-not $apiKey) {
    Write-Step 'AI enabled but no API key provided, fallback to local message.'
    return @{
      Type = $CurrentType
      Subject = $CurrentSubject
      Bullets = $CurrentBullets
    }
  }

  $apiUrl = Resolve-AiBaseUrl $ApiBaseUrl
  $model = Resolve-AiModel $Model
  Write-Ai ("model=" + $model)
  Write-Ai ("endpoint=" + $apiUrl)

  $files = (git diff --cached --name-only | Out-String).Trim()
  $stat = (git diff --cached --stat | Out-String).Trim()
  $patch = (git diff --cached --unified=0 | Out-String)
  if ($patch.Length -gt 12000) {
    $patch = $patch.Substring(0, 12000)
  }

  $userPrompt = New-AiPrompt -Files $files -Stat $stat -Patch $patch
  $messages = @(
    @{
      role = 'system'
      content = 'You are a senior engineer. Output JSON only. Every textual field must be Simplified Chinese.'
    },
    @{
      role = 'user'
      content = $userPrompt
    }
  )

  $bodyObject = @{
    model = $model
    temperature = 0.2
    messages = $messages
  }

  $headers = @{
    Authorization = ("Bearer " + $apiKey)
    'Content-Type' = 'application/json'
  }

  $body = $bodyObject | ConvertTo-Json -Depth 10
  Write-Step ("Calling AI API (" + $model + ")")
  Write-Ai 'request: summarize staged diff and generate commit JSON'
  $resp = Invoke-RestMethod -Method Post -Uri $apiUrl -Headers $headers -Body $body -TimeoutSec 90

  $contentRaw = ''
  if ($resp -and $resp.choices -and $resp.choices.Count -gt 0) {
    $contentRaw = Normalize-String ([string]$resp.choices[0].message.content)
  }

  $jsonText = Extract-JsonObject $contentRaw
  Write-Ai 'raw response:'
  Write-Host $jsonText

  $ai = $jsonText | ConvertFrom-Json

  $nextType = $CurrentType
  if (-not $nextType) {
    $nextType = (Normalize-String ([string]$ai.type)).ToLower()
  }

  $nextSubject = $CurrentSubject
  if (-not $nextSubject) {
    $nextSubject = Normalize-String ([string]$ai.subject)
  }
  $nextSubject = Ensure-ChineseSubject $nextSubject $CurrentSubject

  $nextBullets = @($CurrentBullets)
  if ($nextBullets.Count -eq 0 -and $ai.bullets) {
    $nextBullets = @($ai.bullets | ForEach-Object { Normalize-String ([string]$_) } | Where-Object { $_ })
  }
  $nextBullets = Normalize-ChineseBullets $nextBullets

  return @{
    Type = $nextType
    Subject = $nextSubject
    Bullets = $nextBullets
  }
}

if (-not (Test-Path '.git')) {
  throw 'Current directory is not a git repository root.'
}

if ($IncludeUntracked) {
  Write-Step 'git add .'
  git add .
} elseif ($All) {
  Write-Step 'git add -A'
  git add -A
} else {
  Write-Step 'git add -u'
  git add -u
}

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Step 'No staged changes. Skip commit.'
  exit 0
}

$changedFiles = @(git diff --cached --name-only)
Write-Step ("staged file count: " + [string](@($changedFiles).Count))

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($SplitDryRun) {
  $Split = $true
}

if ($Split) {
  $planScript = Join-Path $scriptDir 'ai_split_plan.ps1'
  $applyScript = Join-Path $scriptDir 'apply_split_plan.ps1'
  if (-not (Test-Path $planScript)) {
    throw ('Missing split plan script: ' + $planScript)
  }
  if (-not (Test-Path $applyScript)) {
    throw ('Missing split apply script: ' + $applyScript)
  }

  $planParams = @{
    MaxBatches = $SplitMaxBatches
  }
  if ($UseAi) { $planParams.UseAi = $true }
  if (Normalize-String $ApiBaseUrl) { $planParams.ApiBaseUrl = $ApiBaseUrl }
  if (Normalize-String $ApiKey) { $planParams.ApiKey = $ApiKey }
  if (Normalize-String $Model) { $planParams.Model = $Model }

  Write-Step 'stage: split plan generation'
  $planResult = & $planScript @planParams

  $planPath = ''
  if ($planResult) {
    if ($planResult -is [string]) {
      $planPath = Normalize-String $planResult
    } elseif ($planResult.planPath) {
      $planPath = Normalize-String ([string]$planResult.planPath)
    }
  }
  if (-not $planPath -or -not (Test-Path $planPath)) {
    throw 'Split plan generation failed: plan path is empty or missing.'
  }

  Write-Step ('split plan: ' + $planPath)

  if ($SplitDryRun -or $DryRun) {
    Write-Step '[split-dry-run] Plan generated. Skip apply/commit.'
    try {
      Write-Host (Get-Content -Raw -Path $planPath)
    } catch { }
    exit 0
  }

  Write-Step 'stage: apply split plan'
  & $applyScript -PlanPath $planPath
  Write-Step 'Done.'
  exit 0
}

$typeProvided = -not [string]::IsNullOrWhiteSpace($Type)
$subjectProvided = -not [string]::IsNullOrWhiteSpace($Subject)
$fallbackType = Resolve-CommitTypeFromFiles $changedFiles

if ($typeProvided) {
  $Type = (Normalize-String $Type).ToLower()
  if (-not (Is-ValidCommitType $Type)) {
    throw ('Invalid --type: ' + $Type + '. Allowed: fix|feat|style|chore|refactor|docs|debug')
  }
}

if ($UseAi) {
  Write-Step 'stage: AI message generation'
  try {
    $aiResult = Try-ApplyAiMessage $Type $Subject $Bullet
    if ($aiResult.Type -and (Is-ValidCommitType ([string]$aiResult.Type))) {
      $Type = (Normalize-String ([string]$aiResult.Type)).ToLower()
    }
    if ($aiResult.Subject) { $Subject = [string]$aiResult.Subject }
    $Bullet = @($aiResult.Bullets)
    Write-Ai ("final type=" + $Type)
    Write-Ai ("final subject=" + $Subject)
    if ($Bullet.Count -gt 0) {
      Write-Ai 'final bullets:'
      foreach ($item in $Bullet) {
        if ($item) { Write-Host ("  - " + [string]$item) }
      }
    }
  } catch {
    Write-Step ("AI message generation failed, fallback to local message: " + $_.Exception.Message)
  }
}

$Type = Normalize-String $Type
$Subject = Normalize-String $Subject
$Bullet = Normalize-ChineseBullets $Bullet

if (-not $subjectProvided -and (Test-GenericSubject $Subject) -and $Bullet.Count -gt 0) {
  $summarySubject = Get-SubjectFromBullets $Bullet
  if ($summarySubject) {
    $Subject = $summarySubject
    Write-Ai ("subject derived from summary=" + $Subject)
  }
}

if ($typeProvided) {
  # honor explicit --type
} elseif (-not (Is-ValidCommitType $Type)) {
  if (Is-ValidCommitType $fallbackType) {
    $Type = $fallbackType
    Write-Ai ("type fallback from files=" + $Type)
  } else {
    $Type = 'fix'
  }
}

if (-not $Type) { $Type = 'fix' }
if (-not $Subject) {
  $Subject = Get-DefaultChineseSubject (@($changedFiles).Count)
}
if (-not (Contains-Cjk $Subject)) {
  $Subject = Get-DefaultChineseSubject (@($changedFiles).Count)
}

$title = ($Type + ':' + $Subject)

Write-Step 'Commit message:'
Write-Host ("  " + $title)
foreach ($b in $Bullet) {
  if ($b) { Write-Host ("  - " + [string]$b) }
}

if ($DryRun) {
  Write-Step '[dry-run] Skip git commit'
  exit 0
}

$messageLines = @($title)
foreach ($b in $Bullet) {
  if (-not $b) { continue }
  $messageLines += ('')
  $messageLines += ('- ' + [string]$b)
}
$commitBody = ($messageLines -join "`n")

$msgFile = New-TempUtf8FilePath
try {
  Write-Utf8NoBomFile -Path $msgFile -Content $commitBody
  Write-Step ('git commit --quiet -F ' + $msgFile)
  git -c i18n.commitEncoding=utf-8 commit --quiet -F $msgFile
  Write-Step ('commit subject: ' + $title)
  Write-Step 'Done.'
} finally {
  if (Test-Path $msgFile) {
    Remove-Item -Path $msgFile -Force -ErrorAction SilentlyContinue
  }
}
