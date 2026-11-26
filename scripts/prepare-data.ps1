#Requires -Version 7.0
# Creates empty bind-mount directories only. Never changes existing data or ACLs.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataRoot = Join-Path $projectRoot 'data'
foreach ($relative in @('postgres', 'ragflow/logs', 'ragflow/cache', 'ragflow/elasticsearch', 'ragflow/mysql', 'ragflow/minio', 'ragflow/kvrocks', 'ragflow/nats')) {
    $target = Join-Path $dataRoot $relative
    New-Item -ItemType Directory -Path $target -Force | Out-Null
}
Write-Output "Prepared bind directories under $dataRoot. No services started."
