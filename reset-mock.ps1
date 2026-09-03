# Wipes the fake device and rebuilds the pristine baseline.
# Safe to run with the app open: it asks the app to disconnect first, so undo
# history cannot resurrect the files being removed.

param(
    [int]$Port = 8000
)

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $sibling = Join-Path (Split-Path $PSScriptRoot -Parent) "v0\.venv\Scripts\python.exe"
    if (Test-Path $sibling) { $python = $sibling }
}
if (-not (Test-Path $python)) { $python = "python" }

& $python (Join-Path $PSScriptRoot "scripts\make_mock.py") --reset --port $Port
