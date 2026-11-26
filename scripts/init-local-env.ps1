#Requires -Version 7.0
[CmdletBinding()]
param([ValidateSet('app', 'ragflow', 'langfuse')][string]$Service = 'app')

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function New-Secret { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
function Set-Value([string]$Text, [string]$Name, [string]$Value) {
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
    if (-not [regex]::IsMatch($Text, $pattern)) { throw "Missing template variable: $Name" }
    return [regex]::Replace($Text, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) "$Name=$Value" })
}
switch ($Service) {
    'app' { $template = Join-Path $projectRoot '.env.example'; $destination = Join-Path $projectRoot '.env' }
    'ragflow' {
        $template = Join-Path $projectRoot 'infra/ragflow/.env.example'
        $destination = Join-Path $projectRoot 'infra/ragflow/.env'
    }
    'langfuse' {
        $template = Join-Path $projectRoot 'infra/langfuse/.env.example'
        $destination = Join-Path $projectRoot 'infra/langfuse/.env'
    }
}
if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite existing secrets: $destination" }
$text = [IO.File]::ReadAllText($template).Replace("`r`n", "`n")
switch ($Service) {
    'app' {
        $password = New-Secret
        $url = "postgresql://gard_dev:${password}@127.0.0.1:5433/gard_agent"
        $text = Set-Value $text POSTGRES_PASSWORD $password
        $text = Set-Value $text DATABASE_URL $url
        $text = Set-Value $text CHECKPOINT_DATABASE_URL $url
        $text = Set-Value $text SESSION_SECRET (New-Secret)
    }
    'ragflow' {
        foreach ($name in @('ELASTIC_PASSWORD','MYSQL_PASSWORD','MINIO_PASSWORD','REDIS_PASSWORD','ADMIN_DEFAULT_PASSWORD')) {
            $text = Set-Value $text $name (New-Secret)
        }
        $text = Set-Value $text DOC_ENGINE 'elasticsearch'
        $text = Set-Value $text DEVICE 'cpu'
        $text = Set-Value $text DB_TYPE 'mysql'
    }
    'langfuse' {
        $password = New-Secret
        $objectPassword = New-Secret
        $text = Set-Value $text POSTGRES_PASSWORD $password
        $text = Set-Value $text DATABASE_URL "postgresql://postgres:${password}@postgres:5432/postgres"
        foreach ($name in @('SALT','ENCRYPTION_KEY','NEXTAUTH_SECRET','CLICKHOUSE_PASSWORD','REDIS_AUTH')) {
            $text = Set-Value $text $name (New-Secret)
        }
        foreach ($name in @('MINIO_ROOT_PASSWORD','LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY','LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY','LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY')) {
            $text = Set-Value $text $name $objectPassword
        }
    }
}
[IO.File]::WriteAllText($destination, $text, [Text.UTF8Encoding]::new($false))
Write-Output "Created $destination. Secrets were not printed. External API keys remain for you to fill."
