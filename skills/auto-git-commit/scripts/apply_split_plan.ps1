#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PlanPath,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

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
  Write-Host ("[split-apply] " + $Message)
}

function Normalize-String([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return $Value.Trim()
}

function Is-ValidCommitType([string]$Value) {
  $clean = (Normalize-String $Value).ToLower()
  return @('fix', 'feat', 'style', 'chore', 'refactor', 'docs', 'debug') -contains $clean
}

function New-TempUtf8FilePath() {
  $name = 'ai-split-commit-msg-' + [Guid]::NewGuid().ToString('N') + '.txt'
  return Join-Path $env:TEMP $name
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

if (-not (Test-Path '.git')) {
  throw 'Current directory is not a git repository root.'
}

$cleanPlanPath = Normalize-String $PlanPath
if (-not $cleanPlanPath -or -not (Test-Path $cleanPlanPath)) {
  throw ('Plan file not found: ' + $cleanPlanPath)
}

$raw = Get-Content -Raw -Path $cleanPlanPath
$plan = $raw | ConvertFrom-Json
if (-not $plan -or -not $plan.batches) {
  throw 'Invalid plan: missing batches.'
}

$stagedBefore = @(git diff --cached --name-only)
if ($stagedBefore.Count -eq 0) {
  throw 'No staged changes before applying split plan.'
}
$stagedSet = @{}
foreach ($f in $stagedBefore) { $stagedSet[$f] = $true }

$assigned = @{}
foreach ($batch in $plan.batches) {
  if (-not $batch.files -or @($batch.files).Count -eq 0) {
    throw ('Invalid batch (no files): ' + [string]$batch.id)
  }
  foreach ($f0 in $batch.files) {
    $f = Normalize-String ([string]$f0)
    if (-not $f) { continue }
    if (-not $stagedSet.ContainsKey($f)) {
      throw ('Plan file is not in staged changes: ' + $f)
    }
    if ($assigned.ContainsKey($f)) {
      throw ('Duplicate file across batches: ' + $f)
    }
    $assigned[$f] = $true
  }
}

foreach ($f in $stagedBefore) {
  if (-not $assigned.ContainsKey($f)) {
    throw ('Plan does not cover staged file: ' + $f)
  }
}

$batchIndex = 0
foreach ($batch in $plan.batches) {
  $batchIndex++
  $type = (Normalize-String ([string]$batch.type)).ToLower()
  if (-not (Is-ValidCommitType $type)) {
    throw ('Invalid batch type in ' + [string]$batch.id + ': ' + [string]$batch.type)
  }

  $subject = Normalize-String ([string]$batch.subject)
  if (-not $subject) {
    throw ('Missing subject in ' + [string]$batch.id)
  }

  $files = @()
  foreach ($f0 in $batch.files) {
    $f = Normalize-String ([string]$f0)
    if (-not $f) { continue }
    $files += $f
  }
  $files = @($files | Select-Object -Unique)
  if ($files.Count -eq 0) {
    throw ('No valid files in ' + [string]$batch.id)
  }

  $bullets = @()
  if ($batch.bullets) {
    $bullets = @($batch.bullets | ForEach-Object { Normalize-String ([string]$_) } | Where-Object { $_ } | Select-Object -First 3)
  }

  Write-Step ("batch " + [string]$batchIndex + "/" + [string](@($plan.batches).Count) + ": " + [string]$batch.id)
  Write-Step ('git restore --staged :/')
  git restore --staged :/

  Write-Step ('git add -- ' + ($files -join ' '))
  git add -- $files

  $stagedNow = @(git diff --cached --name-only)
  $stagedNowSet = @{}
  foreach ($f in $stagedNow) { $stagedNowSet[$f] = $true }
  foreach ($f in $files) {
    if (-not $stagedNowSet.ContainsKey($f)) {
      throw ('Expected file not staged in ' + [string]$batch.id + ': ' + $f)
    }
  }
  foreach ($f in $stagedNow) {
    if (-not ($files -contains $f)) {
      throw ('Unexpected staged file in ' + [string]$batch.id + ': ' + $f)
    }
  }

  $title = $type + ':' + $subject
  Write-Step ('commit message: ' + $title)
  foreach ($b in $bullets) {
    Write-Host ('  - ' + $b)
  }

  if ($DryRun) {
    Write-Step '[dry-run] skip commit for this batch'
    continue
  }

  $messageLines = @($title)
  foreach ($b in $bullets) {
    $messageLines += ''
    $messageLines += ('- ' + $b)
  }
  $commitBody = ($messageLines -join "`n")
  $msgFile = New-TempUtf8FilePath
  try {
    Write-Utf8NoBomFile -Path $msgFile -Content $commitBody
    Write-Step ('git commit --quiet -F ' + $msgFile)
    git -c i18n.commitEncoding=utf-8 commit --quiet -F $msgFile
  } finally {
    if (Test-Path $msgFile) {
      Remove-Item -Path $msgFile -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not $DryRun) {
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    throw 'Staged area is not clean after split apply.'
  }
}

Write-Step 'Done.'
