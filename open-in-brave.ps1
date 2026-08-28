# Opens the working copy of Move My Ass in Brave.
# Starts .\run.ps1 if nothing is already listening on port 8000.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$preferred = "http://movemyass.local:8000"
$probe = "http://127.0.0.1:8000"
$url = $preferred
$brave = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function AppIsUp {
  param([string]$Target = $probe)
  try {
    $response = Invoke-WebRequest $Target -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200
  } catch {
    return $false
  }
}

function NameResolves {
  try {
    $entry = [System.Net.Dns]::GetHostAddresses("movemyass.local") | Select-Object -First 1
    return [bool]$entry
  } catch {
    return $false
  }
}

if (-not (NameResolves)) {
  Write-Host "movemyass.local is not in the hosts file yet. Opening $probe" -ForegroundColor Yellow
  Write-Host "As Administrator, add:  127.0.0.1 movemyass.local" -ForegroundColor Yellow
  $url = $probe
}

if (-not $brave) {
  Write-Host "Brave was not found. Open $url in any browser instead." -ForegroundColor Yellow
  Start-Process $url
  exit 1
}

if (-not (AppIsUp)) {
  Write-Host "Starting Move My Ass..." -ForegroundColor Cyan
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-File", "`"$root\run.ps1`""
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (AppIsUp) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
  }
}

Start-Process $brave $url
