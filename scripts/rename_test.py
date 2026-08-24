"""Checks that renaming preserves a file's extension. Mock backend only."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
PRESETS = Path("mock-move/data/UserData/UserLibrary/Track Presets")
SAMPLES = Path("mock-move/data/UserData/UserLibrary/Samples")
failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


def post(path: str, payload: dict):
    request = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(payload).encode(), method="POST"
    )
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def rename(kind: str, path: str, new_name: str):
    return post("/api/rename", {"kind": kind, "path": path, "new_name": new_name})


status = json.loads(urllib.request.urlopen(f"{BASE}/api/status", timeout=10).read())
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

PRESETS.mkdir(parents=True, exist_ok=True)

print("--- extension is re-attached ---")
(PRESETS / "Alpha.ablpreset").write_text("{}", encoding="utf-8")
result = rename("presets", "Alpha.ablpreset", "Beta")
check("bare name regains .ablpreset", result["name"] == "Beta.ablpreset", result)
check("file exists under the new name", (PRESETS / "Beta.ablpreset").exists(), result)
(PRESETS / "Beta.ablpreset").unlink()

print("\n--- a name the user already suffixed is left alone ---")
(PRESETS / "Gamma.ablpreset").write_text("{}", encoding="utf-8")
result = rename("presets", "Gamma.ablpreset", "Delta.ablpreset")
check("no double extension", result["name"] == "Delta.ablpreset", result)
check("only one file remains",
      (PRESETS / "Delta.ablpreset").exists()
      and not (PRESETS / "Delta.ablpreset.ablpreset").exists(), result)
(PRESETS / "Delta.ablpreset").unlink()

print("\n--- case insensitivity ---")
(PRESETS / "Eps.ablpreset").write_text("{}", encoding="utf-8")
result = rename("presets", "Eps.ablpreset", "Zeta.ABLPRESET")
check("uppercase extension not doubled", result["name"] == "Zeta.ABLPRESET", result)
(PRESETS / "Zeta.ABLPRESET").unlink()

print("\n--- a dot inside the name is not mistaken for an extension ---")
(PRESETS / "Eta.ablpreset").write_text("{}", encoding="utf-8")
result = rename("presets", "Eta.ablpreset", "Kit 2.0")
check("'Kit 2.0' still gets .ablpreset", result["name"] == "Kit 2.0.ablpreset", result)
check("the file is really there", (PRESETS / "Kit 2.0.ablpreset").exists(), result)
(PRESETS / "Kit 2.0.ablpreset").unlink()

print("\n--- the same rule protects other sections ---")
result = rename("samples", "Drums/Kick.wav", "Thump")
check("samples keep .wav", result["name"] == "Thump.wav", result)
rename("samples", "Drums/Thump.wav", "Kick.wav")
check("renamed back for cleanliness", (SAMPLES / "Drums" / "Kick.wav").exists(), "")

print("\n--- folders are left alone ---")
result = rename("samples", "Melodic", "Melodic Renamed")
check("folder gets no extension", result["name"] == "Melodic Renamed", result)
rename("samples", "Melodic Renamed", "Melodic")
check("folder renamed back", (SAMPLES / "Melodic").exists(), "")

print("\n--- collisions are refused ---")
(PRESETS / "One.ablpreset").write_text("{}", encoding="utf-8")
(PRESETS / "Two.ablpreset").write_text("{}", encoding="utf-8")
try:
    rename("presets", "One.ablpreset", "Two")
    check("overwriting an existing preset is refused", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("overwriting an existing preset is refused", exc.code == 409, exc.code)
check("neither file was lost",
      (PRESETS / "One.ablpreset").exists() and (PRESETS / "Two.ablpreset").exists(), "")
(PRESETS / "One.ablpreset").unlink()
(PRESETS / "Two.ablpreset").unlink()

print("\n--- still rejects bad names ---")
(PRESETS / "Theta.ablpreset").write_text("{}", encoding="utf-8")
for bad in ["../escape", "a/b", "", "."]:
    try:
        rename("presets", "Theta.ablpreset", bad)
        check(f"rejects {bad!r}", False, "request succeeded")
    except urllib.error.HTTPError as exc:
        check(f"rejects {bad!r}", exc.code == 400, exc.code)
(PRESETS / "Theta.ablpreset").unlink()

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
