# Starts Move My Ass pointed at a real device.
# Use -Mock to run against the local fake device instead.

param(
    [switch]$Mock,
    [string]$MoveHost = "move.local",
    [string]$MoveUser = "ableton",
    [string]$Key = "~/.ssh/id_ed25519_move",
    [int]$Port = 8000
)

$env:MOVE_BACKEND = if ($Mock) { "mock" } else { "sftp" }
$env:MOVE_HOST = $MoveHost
$env:MOVE_USER = $MoveUser
$env:MOVE_KEY = $Key

$AppHost = "movemyass.local"
$AppUrl = "http://${AppHost}:$Port"

function Ensure-AppHost {
    $hostsFile = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
    $mapped = Select-String -Path $hostsFile -Pattern "movemyass\.local" -Quiet -ErrorAction SilentlyContinue
    if ($mapped) { return $true }
    $line = "127.0.0.1 movemyass.local"
    try {
        Add-Content -Path $hostsFile -Value $line -ErrorAction Stop
        return $true
    } catch {
        Write-Host "Could not write hosts file. Add this line as Administrator:" -ForegroundColor Yellow
        Write-Host "  $line" -ForegroundColor Yellow
        return $false
    }
}

Ensure-AppHost | Out-Null

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $sibling = Join-Path (Split-Path $PSScriptRoot -Parent) "v0\.venv\Scripts\python.exe"
    if (Test-Path $sibling) { $python = $sibling }
}
if (-not (Test-Path $python)) {
    Write-Host "No .venv here. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt" -ForegroundColor Red
    exit 1
}

Write-Host "Move My Ass v1 -> $($env:MOVE_BACKEND) ($MoveUser@$MoveHost)" -ForegroundColor Cyan
Write-Host "Open $AppUrl" -ForegroundColor Cyan

& $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
