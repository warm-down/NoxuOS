$ErrorActionPreference = 'Stop'

Write-Host "NoxuOS local agent launch check" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  throw "Ollama is not installed or is not on PATH."
}

Write-Host "`nOllama models:" -ForegroundColor Yellow
ollama list

$baseUrl = $env:OLLAMA_BASE_URL
if (-not $baseUrl) {
  $baseUrl = 'http://127.0.0.1:11434'
}

Write-Host "`nChecking Ollama API at $baseUrl ..." -ForegroundColor Yellow
$tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method Get -TimeoutSec 5
if (-not $tags.models -or $tags.models.Count -eq 0) {
  throw "Ollama is reachable, but no models are installed."
}

$model = $env:OLLAMA_MODEL
if (-not $model) {
  $model = 'llama3.2:latest'
}

$availableNames = @($tags.models | ForEach-Object { $_.name })
if ($availableNames -notcontains $model) {
  throw "Configured OLLAMA_MODEL '$model' is not installed. Available: $($availableNames -join ', ')"
}

Write-Host "Using model: $model" -ForegroundColor Green

Write-Host "`nRunning deterministic app tests..." -ForegroundColor Yellow
npm test

Write-Host "`nRunning live Ollama readiness smoke test..." -ForegroundColor Yellow
$body = @{
  model = $model
  stream = $false
  messages = @(
    @{
      role = 'user'
      content = 'Reply with exactly one word: YES'
    }
  )
  options = @{
    temperature = 0
    num_predict = 8
    num_ctx = 2048
  }
} | ConvertTo-Json -Depth 8

$smoke = Invoke-RestMethod -Uri "$baseUrl/api/chat" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 45
$content = $smoke.message.content.Trim()
Write-Host "Ollama replied: $content" -ForegroundColor Green

if ($content -notmatch 'YES') {
  throw "Ollama smoke test did not return YES."
}

Write-Host "`nLaunch check passed. This computer is ready as the first local agent node." -ForegroundColor Green
