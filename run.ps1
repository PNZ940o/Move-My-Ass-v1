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

Write-Host "Move My Ass -> $($env:MOVE_BACKEND) ($MoveUser@$MoveHost)" -ForegroundColor Cyan
Write-Host "Open http://127.0.0.1:$Port" -ForegroundColor Cyan

& "$PSScriptRoot\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port $Port
