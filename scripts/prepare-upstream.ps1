#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('ragflow', 'langfuse')][string]$Service)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$versions = Get-Content -LiteralPath (Join-Path $projectRoot 'infra/upstream-versions.json') -Raw | ConvertFrom-Json
$spec = $versions.$Service
$source = Join-Path $projectRoot ".local/upstream-$Service"
$target = [IO.Path]::GetFullPath((Join-Path $projectRoot $spec.target))
if (-not $target.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Upstream target must be inside this project.'
}
if (Test-Path -LiteralPath $target) { throw "Target already exists; inspect before upgrading: $target" }
if (Test-Path -LiteralPath $source) { throw "Source already exists; inspect incomplete/prior download: $source" }
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.local') -Force | Out-Null
& git -c core.autocrlf=false clone --filter=blob:none --depth 1 --sparse --branch $spec.tag $spec.repository $source
if ($LASTEXITCODE -ne 0) { throw 'Upstream clone failed. No containers were started.' }
if ($Service -eq 'ragflow') {
    & git -C $source -c core.autocrlf=false sparse-checkout set docker
    if ($LASTEXITCODE -ne 0) { throw 'Could not download upstream docker directory.' }
}
$actualTag = & git -C $source describe --tags --exact-match
if ($LASTEXITCODE -ne 0 -or $actualTag -ne $spec.tag) { throw 'Upstream tag mismatch.' }
$commit = & git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve upstream commit.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
if ($Service -eq 'ragflow') {
    foreach ($item in Get-ChildItem -LiteralPath (Join-Path $source 'docker') -Force) {
        if ($item.Name -eq '.env') {
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $target '.env.example')
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse
        }
    }
} else {
    Copy-Item -LiteralPath (Join-Path $source 'docker-compose.yml') -Destination $target
}
Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $target 'UPSTREAM-LICENSE')
@{ repository = $spec.repository; tag = $actualTag; commit = $commit } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'UPSTREAM.json') -Encoding utf8
Write-Output "Prepared $Service $actualTag at $target. Run init-local-env.ps1 next."
