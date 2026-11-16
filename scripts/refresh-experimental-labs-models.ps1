[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [string]$ProviderId = "custom_provider:explabs",

  [string]$NodePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$cliPath = Join-Path $repositoryRoot "dist\cli.js"

if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
  throw "Bari is not built. Run pnpm build in $repositoryRoot, then retry."
}

$candidatePaths = New-Object System.Collections.Generic.List[string]
$seenPaths = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)

function Add-NodeCandidate {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }
  try {
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  }
  catch {
    return
  }
  if ((Test-Path -LiteralPath $resolvedPath -PathType Leaf) -and $seenPaths.Add($resolvedPath)) {
    $candidatePaths.Add($resolvedPath)
  }
}

if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
  Add-NodeCandidate -Path $NodePath
}
elseif (-not [string]::IsNullOrWhiteSpace($env:BARI_NODE_EXE)) {
  Add-NodeCandidate -Path $env:BARI_NODE_EXE
}

$pathNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if ($null -ne $pathNode) {
  Add-NodeCandidate -Path $pathNode.Source
}

$vitePlusNodeRoot = Join-Path $env:LOCALAPPDATA "vite-plus\data\js_runtime\node"
if (Test-Path -LiteralPath $vitePlusNodeRoot -PathType Container) {
  Get-ChildItem -LiteralPath $vitePlusNodeRoot -Filter node.exe -File -Recurse |
    Sort-Object -Property FullName -Descending |
    ForEach-Object { Add-NodeCandidate -Path $_.FullName }
}

if ($candidatePaths.Count -eq 0) {
  throw "No Node.js executable was found. Install Node.js or pass -NodePath explicitly."
}

$compatibleNode = $null
foreach ($candidatePath in $candidatePaths) {
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "SilentlyContinue"
    & $candidatePath $cliPath provider list --json *> $null
    $probeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  if ($probeExitCode -eq 0) {
    $compatibleNode = $candidatePath
    break
  }
}

if ($null -eq $compatibleNode) {
  $checked = $candidatePaths -join "`n  - "
  throw "No installed Node.js runtime can load Bari's native SQLite module. Checked:`n  - $checked"
}

$nodeVersion = (& $compatibleNode --version).Trim()
Write-Host "Using $compatibleNode ($nodeVersion)"
Write-Host "Synchronizing $ProviderId from its live model catalog..."

Push-Location $repositoryRoot
try {
  & $compatibleNode $cliPath provider refresh $ProviderId --json
  if ($LASTEXITCODE -ne 0) {
    throw "Bari provider refresh failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
