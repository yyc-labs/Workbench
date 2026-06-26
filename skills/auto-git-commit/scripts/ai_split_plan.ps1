#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [switch]$UseAi,
  [ValidateRange(1, 12)]
  [int]$MaxBatches = 4,
  [ValidateRange(1, 20)]
  [int]$MaxBullets = 8,
  [string]$ApiBaseUrl = '',
  [string]$ApiKey = '',
  [string]$Model = '',
  [string]$OutputPath = ''
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
  Write-Host ("[split-plan] " + $Message)
}

function Write-Ai([string]$Message) {
  Write-Host ("[ai] " + $Message)
}

function Normalize-String([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return $Value.Trim()
}

function Get-AiApiRoot([string]$Value) {
  $raw = Normalize-String $Value
  if (-not $raw) { $raw = Normalize-String $env:AI_COMMIT_API_BASE_URL }
  if (-not $raw) { $raw = 'https://api.openai.com/v1' }

  $trimmed = $raw.TrimEnd('/')
  $lower = $trimmed.ToLowerInvariant()
  if ($lower.EndsWith('/chat/completions')) {
    return $trimmed.Substring(0, $trimmed.Length - '/chat/completions'.Length)
  }
  if ($lower.EndsWith('/responses')) {
    return $trimmed.Substring(0, $trimmed.Length - '/responses'.Length)
  }
  if ($lower.EndsWith('/v1')) {
    return $trimmed
  }
  return ($trimmed + '/v1')
}

function Get-AiConfiguredEndpointKind([string]$Value) {
  $raw = Normalize-String $Value
  if (-not $raw) { $raw = Normalize-String $env:AI_COMMIT_API_BASE_URL }
  $trimmed = $raw.TrimEnd('/')
  if (-not $trimmed) { return '' }

  $lower = $trimmed.ToLowerInvariant()
  if ($lower.EndsWith('/chat/completions')) { return 'chat' }
  if ($lower.EndsWith('/responses')) { return 'responses' }
  return ''
}

function Resolve-AiEndpoint([string]$Value, [string]$Kind) {
  $resolvedKind = if ((Normalize-String $Kind).ToLowerInvariant() -eq 'responses') { 'responses' } else { 'chat' }
  $root = Get-AiApiRoot $Value
  $suffix = if ($resolvedKind -eq 'responses') { '/responses' } else { '/chat/completions' }

  return [ordered]@{
    Kind = $resolvedKind
    Url = ($root.TrimEnd('/') + $suffix)
    Root = $root
  }
}

function Resolve-AiBaseUrl([string]$Value) {
  return (Resolve-AiEndpoint -Value $Value -Kind 'chat').Url
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

function Resolve-MaxBullets([int]$CliValue) {
  if ($CliValue -ge 1) { return $CliValue }
  $envValue = Normalize-String $env:AI_COMMIT_MAX_BULLETS
  if ($envValue -and $envValue -match '^\d+$') {
    $parsed = [int]$envValue
    if ($parsed -ge 1 -and $parsed -le 20) { return $parsed }
  }
  return 8
}

function Test-Gpt5LikeModel([string]$Value) {
  $clean = (Normalize-String $Value).ToLowerInvariant()
  if (-not $clean) { return $false }
  return $clean -match '^gpt-5([.-]|$)'
}

function Limit-Text([string]$Value, [int]$MaxLength) {
  $text = Normalize-String $Value
  if (-not $text) { return '' }
  if ($text.Length -le $MaxLength) { return $text }
  return ($text.Substring(0, $MaxLength) + '...')
}

function Get-ExceptionStatusCode([System.Exception]$Exception) {
  if (-not $Exception) { return 0 }
  try {
    if ($Exception.Response -and $Exception.Response.StatusCode) {
      return [int]$Exception.Response.StatusCode
    }
  } catch { }
  return 0
}

function Get-ObjectPropertyString([object]$Value, [string[]]$Names) {
  if (-not $Value -or -not $Names) { return '' }
  foreach ($name in $Names) {
    if (-not $name) { continue }
    try {
      $prop = $Value.PSObject.Properties[$name]
      if (-not $prop) { continue }
      $text = Normalize-String ([string]$prop.Value)
      if ($text) { return $text }
    } catch { }
  }
  return ''
}

function Get-ErrorRecordDetails([object]$ErrorRecord) {
  if (-not $ErrorRecord) { return '' }

  $candidates = @(
    (Get-ObjectPropertyString -Value $ErrorRecord -Names @('ErrorDetails')),
    (Get-ObjectPropertyString -Value $ErrorRecord.ErrorDetails -Names @('Message')),
    (Get-ObjectPropertyString -Value $ErrorRecord -Names @('Message'))
  )
  foreach ($item in $candidates) {
    $text = Normalize-String $item
    if ($text) { return $text }
  }
  return ''
}

function Get-ExceptionResponseBody([System.Exception]$Exception) {
  if (-not $Exception) { return '' }

  $directFields = @(
    (Get-ObjectPropertyString -Value $Exception -Names @('ResponseBody', 'ResponseContent', 'Content', 'Body'))
  )
  foreach ($item in $directFields) {
    $text = Normalize-String $item
    if ($text) { return $text }
  }

  try {
    if ($Exception.Response -and $Exception.Response.Content) {
      $text = $Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if ($text) { return [string]$text }
    }
  } catch { }

  try {
    if ($Exception.Response) {
      $stream = $Exception.Response.GetResponseStream()
      if ($stream) {
        try {
          $reader = New-Object System.IO.StreamReader($stream)
          return [string]$reader.ReadToEnd()
        } finally {
          if ($reader) { $reader.Dispose() }
          $stream.Dispose()
        }
      }
    }
  } catch { }

  $inner = $Exception.InnerException
  if ($inner -and ($inner -ne $Exception)) {
    $innerBody = Get-ExceptionResponseBody $inner
    if ($innerBody) { return $innerBody }
  }

  return ''
}

function Get-ExceptionMessages([System.Exception]$Exception) {
  $messages = New-Object System.Collections.Generic.List[string]
  $current = $Exception
  $depth = 0
  while ($current -and $depth -lt 8) {
    $text = Normalize-String ([string]$current.Message)
    if ($text) { $null = $messages.Add($text) }
    $current = $current.InnerException
    $depth += 1
  }
  return @($messages.ToArray())
}

function Get-AiErrorSummary([string]$ResponseBody, [string]$FallbackMessage) {
  $body = Normalize-String $ResponseBody
  if ($body) {
    try {
      $parsed = $body | ConvertFrom-Json
      if ($parsed -and $parsed.error) {
        $parts = @()
        $message = Normalize-String ([string]$parsed.error.message)
        $code = Normalize-String ([string]$parsed.error.code)
        $param = Normalize-String ([string]$parsed.error.param)
        $type = Normalize-String ([string]$parsed.error.type)
        if ($message) { $parts += $message }
        if ($code) { $parts += ('code=' + $code) }
        if ($param) { $parts += ('param=' + $param) }
        if ($type) { $parts += ('type=' + $type) }
        if ($parts.Count -gt 0) { return ($parts -join '; ') }
      }
    } catch { }
    return Limit-Text $body 800
  }
  return Limit-Text $FallbackMessage 400
}

function Format-AiFailure([object]$Failure) {
  if (-not $Failure) { return 'AI request failed.' }

  $parts = @()
  $attemptName = Normalize-String ([string]$Failure.AttemptName)
  if ($attemptName) { $parts += ('attempt=' + $attemptName) }

  $statusCode = 0
  try { $statusCode = [int]$Failure.StatusCode } catch { }
  if ($statusCode -gt 0) { $parts += ('status=' + [string]$statusCode) }

  $summary = Normalize-String ([string]$Failure.Summary)
  if ($summary) {
    $parts += $summary
  } else {
    $exceptionMessage = Normalize-String ([string]$Failure.ExceptionMessage)
    if ($exceptionMessage) { $parts += $exceptionMessage }
  }

  if ($parts.Count -eq 0) { return 'AI request failed.' }
  return ($parts -join '; ')
}

function Should-TryAiFallback([object]$Failure) {
  if (-not $Failure) { return $false }

  $statusCode = 0
  try { $statusCode = [int]$Failure.StatusCode } catch { }
  if (@(400, 404, 405, 415, 422) -contains $statusCode) { return $true }

  $diagnostic = ((Normalize-String ([string]$Failure.Summary)) + ' ' + (Normalize-String ([string]$Failure.ExceptionMessage))).ToLowerInvariant()
  if (-not $diagnostic) { return $false }
  return $diagnostic -match 'unsupported|not\s*found|unknown model|invalid.*model|chat/completions|responses|temperature|developer|system'
}

function Is-ValidCommitType([string]$Value) {
  $clean = (Normalize-String $Value).ToLower()
  return @('fix', 'feat', 'style', 'chore', 'refactor', 'docs', 'debug') -contains $clean
}

function Resolve-CommitTypeFromFiles([string[]]$Files) {
  if ($Files -match '(^|/|\\)(docs|README|CHANGELOG|logs)/' -or $Files -match '\.md$') { return 'docs' }
  if ($Files -match '(^|/|\\)(src/core/renderer/)' -or $Files -match '\.(css|scss|less)$') { return 'style' }
  if ($Files -match '(^|/|\\)(package\.json|package-lock\.json|build/|script/|scripts/|\.github/)') { return 'chore' }
  return 'fix'
}

function Get-DefaultSubjectByType([string]$Type, [int]$FileCount) {
  switch ($Type) {
    'feat' { return '拆分并提交功能更新' }
    'style' { return '拆分并提交界面样式改动' }
    'chore' { return '拆分并提交工程配置调整' }
    'docs' { return '拆分并提交文档记录更新' }
    'refactor' { return '拆分并提交重构改动' }
    'debug' { return '拆分并提交调试辅助改动' }
    default { return ('拆分并提交代码改动 (' + [string]$FileCount + ' files)') }
  }
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Resolve-TempDir() {
  $candidates = @(
    (Normalize-String $env:TEMP),
    (Normalize-String $env:TMPDIR),
    (Normalize-String $env:TMP),
    (Normalize-String ([System.IO.Path]::GetTempPath()))
  )
  foreach ($item in $candidates) {
    if (-not $item) { continue }
    try {
      if (-not (Test-Path $item)) {
        New-Item -ItemType Directory -Force -Path $item | Out-Null
      }
      if (Test-Path $item) { return $item }
    } catch { }
  }
  return '.'
}

function New-PlanPath([string]$GivenPath) {
  $clean = Normalize-String $GivenPath
  if ($clean) { return $clean }
  $name = 'ai-split-plan-' + [Guid]::NewGuid().ToString('N') + '.json'
  return Join-Path (Resolve-TempDir) $name
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

function Get-ChatResponseText([object]$Response) {
  if ($Response -and $Response.choices -and $Response.choices.Count -gt 0) {
    return Normalize-String ([string]$Response.choices[0].message.content)
  }
  return ''
}

function Get-ResponsesText([object]$Response) {
  if (-not $Response) { return '' }

  $outputText = Normalize-String ([string]$Response.output_text)
  if ($outputText) { return $outputText }

  $chunks = @()
  foreach ($item in @($Response.output)) {
    if (-not $item) { continue }
    foreach ($part in @($item.content)) {
      if (-not $part) { continue }
      $text = Normalize-String ([string]$part.text)
      if ($text) {
        $chunks += $text
        continue
      }
      $alt = Normalize-String ([string]$part.output_text)
      if ($alt) { $chunks += $alt }
    }
  }

  return Normalize-String (($chunks -join "`n"))
}

function New-AiChatAttempt(
  [string]$ApiBaseUrl,
  [string]$Model,
  [string]$Instruction,
  [string]$UserPrompt,
  [bool]$UseDeveloper,
  [bool]$IncludeTemperature,
  [string]$Name
) {
  $endpoint = Resolve-AiEndpoint -Value $ApiBaseUrl -Kind 'chat'
  $leadRole = if ($UseDeveloper) { 'developer' } else { 'system' }
  $bodyObject = @{
    model = $Model
    messages = @(
      @{
        role = $leadRole
        content = $Instruction
      },
      @{
        role = 'user'
        content = $UserPrompt
      }
    )
  }
  if ($IncludeTemperature) {
    $bodyObject.temperature = 0.2
  }

  return [ordered]@{
    Name = $Name
    Kind = 'chat'
    Url = $endpoint.Url
    Model = $Model
    BodyObject = $bodyObject
  }
}

function New-AiResponsesAttempt(
  [string]$ApiBaseUrl,
  [string]$Model,
  [string]$Instruction,
  [string]$UserPrompt,
  [string]$Name
) {
  $endpoint = Resolve-AiEndpoint -Value $ApiBaseUrl -Kind 'responses'
  $bodyObject = @{
    model = $Model
    instructions = $Instruction
    input = $UserPrompt
  }

  return [ordered]@{
    Name = $Name
    Kind = 'responses'
    Url = $endpoint.Url
    Model = $Model
    BodyObject = $bodyObject
  }
}

function Invoke-AiAttempt([object]$Attempt, [hashtable]$Headers) {
  $body = $Attempt.BodyObject | ConvertTo-Json -Depth 12
  Write-Step ("Calling AI API (" + [string]$Attempt.Model + ')')
  Write-Ai ('attempt=' + [string]$Attempt.Name)
  Write-Ai ('endpoint=' + [string]$Attempt.Url)

  try {
    $resp = Invoke-RestMethod -Method Post -Uri $Attempt.Url -Headers $Headers -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 90
  } catch {
    $errorDetails = Get-ErrorRecordDetails $_
    $statusCode = Get-ExceptionStatusCode $_.Exception
    $responseBody = Get-ExceptionResponseBody $_.Exception
    if (-not $responseBody -and $errorDetails) {
      $responseBody = $errorDetails
    }
    $exceptionMessages = @(Get-ExceptionMessages $_.Exception)
    $fallbackSummary = if ($errorDetails) {
      $errorDetails
    } elseif ($exceptionMessages.Count -gt 0) {
      $exceptionMessages -join ' | '
    } else {
      $_.Exception.Message
    }
    $summary = Get-AiErrorSummary -ResponseBody $responseBody -FallbackMessage $fallbackSummary
    Write-Ai ('request failed: ' + $summary)
    if ($responseBody) {
      Write-Ai 'error body:'
      Write-Host $responseBody
    }
    Write-Ai 'request body preview:'
    Write-Host (Limit-Text $body 1200)

    return @{
      Ok = $false
      AttemptName = [string]$Attempt.Name
      StatusCode = $statusCode
      Summary = $summary
      ResponseBody = $responseBody
      ExceptionMessage = Normalize-String ($exceptionMessages -join ' | ')
    }
  }

  $content = if ([string]$Attempt.Kind -eq 'responses') {
    Get-ResponsesText $resp
  } else {
    Get-ChatResponseText $resp
  }

  if (-not $content) {
    Write-Ai 'request failed: AI response content is empty.'
    return @{
      Ok = $false
      AttemptName = [string]$Attempt.Name
      StatusCode = 0
      Summary = 'AI response content is empty.'
      ResponseBody = ''
      ExceptionMessage = 'AI response content is empty.'
    }
  }

  return @{
    Ok = $true
    AttemptName = [string]$Attempt.Name
    Content = $content
  }
}

function New-LocalBatch([string]$Id, [string]$Type, [string]$Subject, [string[]]$Files, [string[]]$Bullets) {
  return [ordered]@{
    id = $Id
    type = $Type
    subject = $Subject
    bullets = @($Bullets)
    files = @($Files)
  }
}

function Normalize-Bullets([object[]]$Items, [int]$Limit) {
  $result = @()
  foreach ($item in $Items) {
    $text = Normalize-String ([string]$item)
    if (-not $text) { continue }
    $result += $text
    if ($result.Count -ge $Limit) { break }
  }
  return @($result)
}

function Compress-Batches([object[]]$Batches, [int]$Limit, [int]$BulletLimit) {
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($b in $Batches) { $null = $list.Add($b) }
  if ($list.Count -le $Limit) { return ,@($list.ToArray()) }

  while ($list.Count -gt $Limit) {
    $tail = $list[$list.Count - 1]
    $list.RemoveAt($list.Count - 1)
    $last = $list[$list.Count - 1]
    $last.files = @($last.files + $tail.files | Select-Object -Unique)
    if ($tail.subject) {
      $last.bullets = Normalize-Bullets -Items (@($last.bullets) + @('合并批次: ' + [string]$tail.subject)) -Limit $BulletLimit
    }
  }
  return ,@($list.ToArray())
}

function Get-ParentDir([string]$PathValue) {
  $clean = Normalize-String $PathValue
  if (-not $clean) { return '' }
  $normalized = $clean -replace '\\', '/'
  $idx = $normalized.LastIndexOf('/')
  if ($idx -lt 0) { return '' }
  return $normalized.Substring(0, $idx)
}

function Join-RepoPath([string]$Dir, [string]$FileName) {
  $d = Normalize-String $Dir
  if (-not $d) { return $FileName }
  return ($d + '/' + $FileName)
}

function Enforce-PackageLockPairing([object[]]$Batches) {
  if (-not $Batches -or $Batches.Count -eq 0) { return ,@() }

  $location = @{}
  for ($i = 0; $i -lt $Batches.Count; $i++) {
    foreach ($f0 in @($Batches[$i].files)) {
      $f = Normalize-String ([string]$f0)
      if (-not $f) { continue }
      $location[$f] = $i
    }
  }

  for ($i = 0; $i -lt $Batches.Count; $i++) {
    $batchFiles = @($Batches[$i].files)
    foreach ($f0 in $batchFiles) {
      $f = Normalize-String ([string]$f0)
      if (-not $f) { continue }
      if (-not ($f -match '(^|/|\\)package\.json$')) { continue }

      $dir = Get-ParentDir $f
      $lock = Join-RepoPath $dir 'package-lock.json'
      if (-not $location.ContainsKey($lock)) { continue }

      $lockIndex = [int]$location[$lock]
      if ($lockIndex -eq $i) { continue }

      $sourceBatch = $Batches[$lockIndex]
      $targetBatch = $Batches[$i]

      $targetBatch.files = @($targetBatch.files + @($lock) | Select-Object -Unique)
      $sourceBatch.files = @($sourceBatch.files | Where-Object { (Normalize-String ([string]$_)) -ne $lock })

      if (@($sourceBatch.files).Count -eq 0) {
        $sourceBatch.subject = Normalize-String $sourceBatch.subject
      }
      $location[$lock] = $i
    }
  }

  $result = @()
  foreach ($batch in $Batches) {
    $files = @($batch.files | ForEach-Object { Normalize-String ([string]$_) } | Where-Object { $_ } | Select-Object -Unique)
    if ($files.Count -eq 0) { continue }
    $batch.files = $files
    $result += $batch
  }
  return ,@($result)
}

function New-LocalPlan([string[]]$Files, [int]$BatchLimit) {
  $groups = [ordered]@{
    fix = New-Object System.Collections.Generic.List[string]
    style = New-Object System.Collections.Generic.List[string]
    chore = New-Object System.Collections.Generic.List[string]
    docs = New-Object System.Collections.Generic.List[string]
  }

  foreach ($f in $Files) {
    $path = Normalize-String $f
    if (-not $path) { continue }
    $t = Resolve-CommitTypeFromFiles @($path)
    if (-not $groups.Contains($t)) { $t = 'fix' }
    $groups[$t].Add($path)
  }

  $batches = @()
  foreach ($t in @('fix', 'style', 'chore', 'docs')) {
    $items = @($groups[$t].ToArray() | Select-Object -Unique)
    if ($items.Count -eq 0) { continue }
    $subject = Get-DefaultSubjectByType $t $items.Count
    $bullets = @('按文件级规则自动分组')
    $batches += New-LocalBatch ('batch-' + [string]($batches.Count + 1)) $t $subject $items $bullets
  }

  $batches = Compress-Batches $batches $BatchLimit $resolvedMaxBullets
  for ($i = 0; $i -lt $batches.Count; $i++) {
    $batches[$i].id = 'batch-' + [string]($i + 1)
  }

  return [ordered]@{
    version = 1
    mode = 'file'
    summary = '本次改动采用本地规则生成分批计划'
    batches = @($batches)
  }
}

function New-AiSplitPrompt([string]$Files, [string]$Stat, [int]$BatchLimit, [int]$BulletLimit) {
  return @"
Generate a Chinese git split-commit plan from staged changes.
Return JSON only with shape:
{
  "version":1,
  "mode":"file",
  "summary":"<=40 chars",
  "batches":[
    {
      "id":"batch-1",
      "type":"fix|feat|style|chore|refactor|docs|debug",
      "subject":"<=40 chars",
      "bullets":["0-$BulletLimit items, each <=50 chars"],
      "files":["exact path from input list"]
    }
  ]
}

Rules:
1) JSON only, no markdown.
2) subject/summary/bullets MUST be Simplified Chinese.
3) file-level plan only. One file can appear in one batch only.
4) Use only files from the input list. No extra file.
5) Cover every input file exactly once.
6) Batch count MUST be <= $BatchLimit.
7) package.json and package-lock.json must be in the same batch when both exist.

Files:
$Files

Stats:
$Stat
"@
}

function Normalize-Plan([object]$Plan, [string[]]$AllFiles, [int]$BatchLimit, [int]$BulletLimit) {
  $allSet = @{}
  foreach ($f in $AllFiles) { $allSet[$f] = $true }

  $assigned = @{}
  $normalizedBatches = @()

  if ($Plan -and $Plan.batches) {
    foreach ($batch in $Plan.batches) {
      $type = (Normalize-String ([string]$batch.type)).ToLower()
      if (-not (Is-ValidCommitType $type)) { $type = '' }

      $files = @()
      if ($batch.files) {
        foreach ($item in $batch.files) {
          $f = Normalize-String ([string]$item)
          if (-not $f) { continue }
          if (-not $allSet.ContainsKey($f)) { continue }
          if ($assigned.ContainsKey($f)) { continue }
          $files += $f
          $assigned[$f] = $true
        }
      }
      $files = @($files | Select-Object -Unique)
      if ($files.Count -eq 0) { continue }

      if (-not $type) {
        $type = Resolve-CommitTypeFromFiles $files
      }

      $subject = Normalize-String ([string]$batch.subject)
      if (-not $subject) {
        $subject = Get-DefaultSubjectByType $type $files.Count
      }

      $bullets = @()
      if ($batch.bullets) {
        $bullets = Normalize-Bullets -Items $batch.bullets -Limit $BulletLimit
      }

      $normalizedBatches += New-LocalBatch '' $type $subject $files $bullets
    }
  }

  $missing = @()
  foreach ($f in $AllFiles) {
    if (-not $assigned.ContainsKey($f)) { $missing += $f }
  }
  if ($missing.Count -gt 0) {
    $fallbackType = Resolve-CommitTypeFromFiles $missing
    $fallbackSubject = Get-DefaultSubjectByType $fallbackType $missing.Count
    $normalizedBatches += New-LocalBatch '' $fallbackType $fallbackSubject $missing @('补齐未分配文件')
  }

  if ($normalizedBatches.Count -eq 0) {
    return New-LocalPlan $AllFiles $BatchLimit
  }

  $normalizedBatches = Enforce-PackageLockPairing $normalizedBatches
  $normalizedBatches = Compress-Batches $normalizedBatches $BatchLimit $BulletLimit
  for ($i = 0; $i -lt $normalizedBatches.Count; $i++) {
    $normalizedBatches[$i].id = 'batch-' + [string]($i + 1)
  }

  $summary = ''
  if ($Plan) {
    $summary = Normalize-String ([string]$Plan.summary)
  }
  if (-not $summary) {
    $summary = '本次改动按文件级策略拆分提交'
  }

  return [ordered]@{
    version = 1
    mode = 'file'
    summary = $summary
    batches = @($normalizedBatches)
  }
}

if (-not (Test-Path '.git')) {
  throw 'Current directory is not a git repository root.'
}

$stagedFiles = @(git diff --cached --name-only)
if ($stagedFiles.Count -eq 0) {
  throw 'No staged changes for split plan.'
}

$resolvedMaxBullets = Resolve-MaxBullets $MaxBullets

$filesText = ($stagedFiles -join "`n")
$statText = (git diff --cached --stat | Out-String).Trim()

$plan = $null
if ($UseAi) {
  $apiKey = Resolve-AiKey $ApiKey
  if (-not $apiKey) {
    throw 'AI split enabled but no API key provided.'
  } else {
    try {
      $model = Resolve-AiModel $Model
      Write-Ai ("model=" + $model)

      $userPrompt = New-AiSplitPrompt -Files $filesText -Stat $statText -BatchLimit $MaxBatches -BulletLimit $resolvedMaxBullets
      $instruction = 'You are a senior engineer. Output JSON only. Every textual field must be Simplified Chinese.'
      $configuredEndpointKind = Get-AiConfiguredEndpointKind $ApiBaseUrl
      $isGpt5Like = Test-Gpt5LikeModel $model
      $attempts = New-Object System.Collections.Generic.List[object]

      if ($configuredEndpointKind -eq 'responses') {
        $null = $attempts.Add((New-AiResponsesAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -Name 'responses-primary'))
        if ($isGpt5Like) {
          $null = $attempts.Add((New-AiChatAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -UseDeveloper $true -IncludeTemperature $false -Name 'chat-developer-fallback'))
          $null = $attempts.Add((New-AiChatAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -UseDeveloper $false -IncludeTemperature $true -Name 'chat-system-fallback'))
        }
      } else {
        $null = $attempts.Add((New-AiChatAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -UseDeveloper $false -IncludeTemperature $true -Name 'chat-system-primary'))
        if ($isGpt5Like) {
          $null = $attempts.Add((New-AiChatAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -UseDeveloper $true -IncludeTemperature $false -Name 'chat-developer-fallback'))
          $null = $attempts.Add((New-AiResponsesAttempt -ApiBaseUrl $ApiBaseUrl -Model $model -Instruction $instruction -UserPrompt $userPrompt -Name 'responses-fallback'))
        }
      }

      if ($attempts.Count -eq 0) {
        throw 'AI request configuration is empty.'
      }

      $headers = @{
        Authorization = ("Bearer " + $apiKey)
      }

      $contentRaw = ''
      $lastFailure = $null
      for ($index = 0; $index -lt $attempts.Count; $index++) {
        $attempt = $attempts[$index]
        $result = Invoke-AiAttempt -Attempt $attempt -Headers $headers
        if ($result.Ok) {
          $contentRaw = Normalize-String ([string]$result.Content)
          Write-Ai ('response accepted via ' + [string]$result.AttemptName)
          break
        }

        $lastFailure = $result
        if ($index -ge ($attempts.Count - 1)) { break }
        if (-not (Should-TryAiFallback $result)) { break }
        Write-Ai ('fallback next=' + [string]$attempts[$index + 1].Name)
      }

      if (-not $contentRaw) {
        if ($lastFailure) {
          throw (Format-AiFailure $lastFailure)
        }
        throw 'AI response content is empty.'
      }

      $jsonText = Extract-JsonObject $contentRaw
      Write-Ai 'raw split response:'
      Write-Host $jsonText
      $plan = $jsonText | ConvertFrom-Json
    } catch {
      throw ('AI split planning failed, abort split commit: ' + $_.Exception.Message)
    }
  }
}

if (-not $plan) {
  $plan = New-LocalPlan $stagedFiles $MaxBatches
}

$normalizedPlan = Normalize-Plan -Plan $plan -AllFiles $stagedFiles -BatchLimit $MaxBatches -BulletLimit $resolvedMaxBullets
$path = New-PlanPath $OutputPath
$dir = Split-Path -Parent $path
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$json = $normalizedPlan | ConvertTo-Json -Depth 10
Write-Utf8NoBomFile -Path $path -Content $json
Write-Step ('plan generated: ' + $path)
Write-Step ('batch count: ' + [string](@($normalizedPlan.batches).Count))

return @{
  planPath = $path
}
