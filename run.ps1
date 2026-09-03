# Starts Move My Ass. On Windows this is a convenience wrapper around run.py,
# which is the real entry point and the one to hand to anyone on macOS or Linux.
#
#   .\run.ps1            # a real Move over SFTP
#   .\run.ps1 -Mock      # local fake device, no hardware needed

param(
    [switch]$Mock,
    [string]$MoveHost = "",
    [string]$MoveUser = "",
    [string]$Key = "",
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $sibling = Join-Path (Split-Path $PSScriptRoot -Parent) "v0\.venv\Scripts\python.exe"
    if (Test-Path $sibling) { $python = $sibling }
}
if (-not (Test-Path $python)) { $python = "python" }

$flags = @((Join-Path $PSScriptRoot "run.py"), "--port", "$Port")
if ($Mock) { $flags += "--mock" } else { $flags += "--device" }
if ($MoveHost) { $flags += "--move-host"; $flags += $MoveHost }
if ($MoveUser) { $flags += "--user"; $flags += $MoveUser }
if ($Key) { $flags += "--key"; $flags += $Key }
if ($NoBrowser) { $flags += "--no-browser" }

& $python @flags
exit $LASTEXITCODE
