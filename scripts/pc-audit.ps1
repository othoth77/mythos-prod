<#
=====================================================================
 Mythos — PC Decommission Audit (STRICTLY READ-ONLY)
 scripts/pc-audit.ps1

 PURPOSE
   Produce the evidence required to close PC-DECOMMISSION-GATE:
     - the state of the four PC working copies
     - whether every local commit exists on a remote
     - a whole-PC development-material sweep, so prerequisite #9
       ("no unique development material exists only on the PC") can be
       ASSERTED from evidence instead of assumed.

 WHY THIS FILE EXISTS
   The gate has been open pending a PC-side audit. No audit script existed
   on the VPS or anywhere in Git history, and the VPS cannot reach the PC
   (the noVNC listener on the VPS serves the VPS's own desktop — it is a way
   IN to the VPS, not a way OUT to the PC). This script is the read-only
   mechanism the owner runs ON the PC.

 SAFETY — this script performs NO mutation of any kind.
   It never runs: pull, push, fetch, commit, reset, checkout, stash, clean,
   merge, rebase, gc, prune, or any file write outside the single JSON report
   it is explicitly asked to produce.
   It deletes nothing. It modifies no repository. It transmits nothing.
   Every git command used is read-only: status, rev-parse, rev-list,
   for-each-ref, branch, log, ls-files, remote, cat-file.

 USAGE (PowerShell, no admin required)
   cd $env:USERPROFILE
   powershell -ExecutionPolicy Bypass -File pc-audit.ps1 -OutFile pc-audit-report.json

   Then transfer ONLY the JSON report off the PC for reconciliation.
   Review the report before sharing: it lists file PATHS and hashes, never
   file CONTENTS, but paths alone can be revealing.
=====================================================================
#>

[CmdletBinding()]
param(
  [string]$OutFile = "$env:USERPROFILE\pc-audit-report.json",
  # Whole-PC sweep can take several minutes. Skip only if you accept that
  # prerequisite #9 stays unproven.
  [switch]$SkipWholePcSweep
)

$ErrorActionPreference = 'Continue'

function Invoke-Git {
  param([string]$RepoPath, [string[]]$GitArgs)
  # -C keeps the working directory untouched. 2>$null suppresses git's stderr
  # noise without hiding failures: callers check for $null / empty results.
  try { & git -C $RepoPath @GitArgs 2>$null } catch { $null }
}

function Get-Sha256 {
  param([string]$Path)
  try {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
    }
  } catch { }
  return $null
}

# ---------------------------------------------------------------------
# The four working copies. The repository's own records and the audit order
# disagree about whether three of these sit under Desktop\ or directly under
# the user profile, so BOTH candidates are probed and the one that exists is
# reported. Guessing here would silently audit the wrong directory — or
# report "absent" for a working copy that does exist one level up.
# ---------------------------------------------------------------------
$targets = @(
  @{ Name = 'mythos-os (2607 bureau)';  Candidates = @("$env:USERPROFILE\Desktop\2607 bureau\mythos-os",
                                                       "$env:USERPROFILE\Desktop\2607 bureau") },
  @{ Name = 'mythos-prod';              Candidates = @("$env:USERPROFILE\Desktop\mythos-prod",
                                                       "$env:USERPROFILE\mythos-prod") },
  @{ Name = 'mythos-prod-stage3b';      Candidates = @("$env:USERPROFILE\Desktop\mythos-prod-stage3b",
                                                       "$env:USERPROFILE\mythos-prod-stage3b") },
  @{ Name = 'mythos-prod-work';         Candidates = @("$env:USERPROFILE\Desktop\mythos-prod-work",
                                                       "$env:USERPROFILE\mythos-prod-work") }
)

$report = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  machine        = $env:COMPUTERNAME
  user           = $env:USERNAME
  gitVersion     = (& git --version 2>$null)
  readOnly       = $true
  workingCopies  = @()
  wholePcSweep   = $null
  notes          = @()
}

foreach ($t in $targets) {
  $found = $null
  foreach ($c in $t.Candidates) {
    if (Test-Path -LiteralPath (Join-Path $c '.git')) { $found = $c; break }
  }

  if (-not $found) {
    $report.workingCopies += [ordered]@{
      name = $t.Name; pathProbed = $t.Candidates; path = $null
      exists = $false
      classification = 'ABSENT — no .git found at either candidate path'
    }
    continue
  }

  $branch    = (Invoke-Git $found @('rev-parse','--abbrev-ref','HEAD'))    | Select-Object -First 1
  $head      = (Invoke-Git $found @('rev-parse','HEAD'))                   | Select-Object -First 1
  $remoteUrl = (Invoke-Git $found @('remote','get-url','origin'))          | Select-Object -First 1
  $upstream  = (Invoke-Git $found @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')) | Select-Object -First 1

  # Ahead/behind WITHOUT fetching. This reflects the last known remote state
  # in this clone; a stale clone can understate "behind". Recorded honestly
  # rather than fetched, because fetch would mutate refs.
  $ahead = $null; $behind = $null
  if ($upstream) {
    $counts = (Invoke-Git $found @('rev-list','--left-right','--count',"$upstream...HEAD")) | Select-Object -First 1
    if ($counts) { $parts = $counts -split '\s+'; $behind = $parts[0]; $ahead = $parts[1] }
  }

  # Porcelain status: modified + untracked, without touching anything.
  $status = Invoke-Git $found @('status','--porcelain=v1','--untracked-files=all')
  $modified = @(); $untracked = @()
  foreach ($line in $status) {
    if (-not $line) { continue }
    $code = $line.Substring(0, [Math]::Min(2, $line.Length))
    $rel  = $line.Substring(3)
    $abs  = Join-Path $found $rel
    $entry = [ordered]@{ path = $rel; sha256 = (Get-Sha256 $abs) }
    if ($code -eq '??') { $untracked += $entry } else { $entry.statusCode = $code.Trim(); $modified += $entry }
  }

  # Do local commits exist on ANY remote ref? This is the question that decides
  # PC-UNIQUE vs CANONICAL-IN-GITHUB. Uses only local refs — no network.
  $unpushed = @()
  $remoteRefs = Invoke-Git $found @('for-each-ref','--format=%(refname)','refs/remotes')
  if ($remoteRefs) {
    $notOnRemote = Invoke-Git $found @('rev-list','HEAD','--not','--remotes','--max-count=200')
    foreach ($sha in $notOnRemote) {
      if (-not $sha) { continue }
      $subject = (Invoke-Git $found @('log','-1','--format=%s',$sha)) | Select-Object -First 1
      $when    = (Invoke-Git $found @('log','-1','--format=%cI',$sha)) | Select-Object -First 1
      $unpushed += [ordered]@{ sha = $sha; subject = $subject; committedAt = $when }
    }
  } else {
    $unpushed = 'NO REMOTE REFS PRESENT — every local commit is PC-unique until proven otherwise'
  }

  $allRemoteBranches = @(Invoke-Git $found @('branch','-r','--format=%(refname:short)'))
  $localBranches     = @(Invoke-Git $found @('branch','--format=%(refname:short)'))
  $trackedFileCount  = @(Invoke-Git $found @('ls-files')).Count

  # Classification is derived from evidence only, never assumed.
  $classification =
    if ($unpushed -is [string]) { 'UNRESOLVED — PC UNIQUE (no remote configured)' }
    elseif ($unpushed.Count -gt 0 -or $modified.Count -gt 0 -or $untracked.Count -gt 0) {
      'UNRESOLVED — PC UNIQUE (unpushed commits and/or uncommitted files)' }
    else { 'TRANSFERRED / CANONICAL IN GITHUB (clean, fully pushed)' }

  $report.workingCopies += [ordered]@{
    name              = $t.Name
    path              = $found
    exists            = $true
    branch            = $branch
    head              = $head
    remoteUrl         = $remoteUrl
    upstream          = $upstream
    ahead             = $ahead
    behind            = $behind
    aheadBehindNote   = 'computed WITHOUT fetch; reflects last known remote state in this clone'
    trackedFileCount  = $trackedFileCount
    localBranches     = $localBranches
    remoteBranches    = $allRemoteBranches
    modifiedCount     = $modified.Count
    untrackedCount    = $untracked.Count
    modifiedFiles     = $modified
    untrackedFiles    = $untracked
    commitsNotOnAnyRemote = $unpushed
    classification    = $classification
  }
}

# ---------------------------------------------------------------------
# Whole-PC development-material sweep. Without this, prerequisite #9 can only
# be assumed — and assuming it is precisely the mistake a decommission gate
# exists to prevent.
# ---------------------------------------------------------------------
if (-not $SkipWholePcSweep) {
  $knownPaths = @($report.workingCopies | Where-Object { $_.path } | ForEach-Object { $_.path })
  $roots = @("$env:USERPROFILE") + @(
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne 'C' -and $_.Used -gt 0 } | ForEach-Object { $_.Root }
  )

  $repos = @()
  foreach ($root in $roots) {
    try {
      Get-ChildItem -LiteralPath $root -Directory -Filter '.git' -Recurse -Force -ErrorAction SilentlyContinue |
        ForEach-Object {
          $repoPath = $_.Parent.FullName
          $isKnown  = $knownPaths -contains $repoPath
          $rHead    = (Invoke-Git $repoPath @('rev-parse','HEAD')) | Select-Object -First 1
          $rRemote  = (Invoke-Git $repoPath @('remote','get-url','origin')) | Select-Object -First 1
          $rDirty   = @(Invoke-Git $repoPath @('status','--porcelain=v1','--untracked-files=all')).Count
          $rUnpushed= @(Invoke-Git $repoPath @('rev-list','HEAD','--not','--remotes','--max-count=50')).Count
          $repos += [ordered]@{
            path = $repoPath; alreadyAudited = $isKnown; head = $rHead
            origin = $rRemote; dirtyEntries = $rDirty; commitsNotOnAnyRemote = $rUnpushed
            classification = if ($isKnown) { 'covered by the four-working-copy audit' }
                             elseif (-not $rRemote) { 'PC UNIQUE — no origin remote' }
                             elseif ($rUnpushed -gt 0 -or $rDirty -gt 0) { 'PC UNIQUE — unpushed or dirty' }
                             else { 'clean and pushed' }
          }
        }
    } catch { }
  }

  # Loose development material outside any repository.
  $codeExt = @('*.js','*.ts','*.py','*.php','*.sql','*.ps1','*.sh','*.json','*.md','*.html','*.css')
  $loose = @()
  foreach ($root in $roots) {
    try {
      Get-ChildItem -LiteralPath $root -File -Recurse -Force -Include $codeExt -ErrorAction SilentlyContinue |
        Where-Object {
          $p = $_.FullName
          $p -notmatch '\\\.git\\' -and $p -notmatch '\\node_modules\\' -and
          $p -notmatch '\\AppData\\' -and $p -notmatch '\\vendor\\' -and
          -not ($repos | Where-Object { $p.StartsWith($_.path, 'OrdinalIgnoreCase') })
        } |
        ForEach-Object { $loose += [ordered]@{ path = $_.FullName; bytes = $_.Length; modifiedUtc = $_.LastWriteTimeUtc.ToString('o') } }
    } catch { }
  }

  # The single known UNRESOLVED item from the 1,564-file manifest.
  $mythosData = @()
  foreach ($root in $roots) {
    try {
      Get-ChildItem -LiteralPath $root -File -Recurse -Force -Filter 'mythos_data.json' -ErrorAction SilentlyContinue |
        ForEach-Object { $mythosData += [ordered]@{ path = $_.FullName; bytes = $_.Length; sha256 = (Get-Sha256 $_.FullName) } }
    } catch { }
  }

  $report.wholePcSweep = [ordered]@{
    rootsScanned          = $roots
    repositoriesFound     = $repos.Count
    repositories          = $repos
    looseDevFileCount     = $loose.Count
    looseDevFiles         = $loose
    mythosDataJsonCopies  = $mythosData
    note                  = 'mythos_data.json is a personal-data snapshot: MUST NOT be transferred. Listed for classification only.'
  }
}

$report.notes += 'READ-ONLY: no pull/push/fetch/commit/reset/checkout/stash/clean was executed; no PC file was deleted or modified.'
$report.notes += 'ahead/behind computed without fetch, so "behind" may understate reality in a stale clone.'
$report.notes += 'Sensitive material (65 EXCLUDED_SENSITIVE files) stays on the PC by design and must not be transferred.'

$report | ConvertTo-Json -Depth 8 | Out-File -FilePath $OutFile -Encoding utf8
Write-Host "Audit complete (read-only). Report written to: $OutFile"
Write-Host "Working copies audited: $($report.workingCopies.Count)"
if ($report.wholePcSweep) { Write-Host "Repositories found on PC: $($report.wholePcSweep.repositoriesFound)" }
Write-Host "Nothing was pushed, pulled, committed, reset, or deleted."
