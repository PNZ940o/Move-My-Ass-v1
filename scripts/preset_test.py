"""Checks the track-preset builder — mock only."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.move import presets  # noqa: E402

BASE = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8001")
PRESETS = Path("mock-move/data/UserData/UserLibrary/Track Presets")
failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


def get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as response:
        return json.loads(response.read())


def post(path: str, payload: dict):
    request = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(payload).encode(), method="POST"
    )
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


drift = {
    "kind": "drift",
    "name": "Plain Drift",
    "parameters": {"Enabled": True},
    "deviceData": {},
}
extracted = presets.extract_instrument(drift)
check("bare drift is an instrument", extracted["kind"] == "drift", extracted["kind"])

stacked = presets.build_track_preset(
    "Warm Drift",
    extracted["device"],
    [{"kind": "reverb", "parameters": {"DecayTime": 2000}}],
    [{"index": 0, "name": "Decay", "device": 0, "param": "DecayTime"}],
)
check("track preset is an instrumentRack", stacked["kind"] == "instrumentRack")
check("instrument stays first", stacked["chains"][0]["devices"][0]["kind"] == "drift")
check("effect is stacked after", stacked["chains"][0]["devices"][1]["kind"] == "reverb")
check("macro name is Decay", stacked["parameters"]["Macro0"]["customName"] == "Decay", stacked["parameters"]["Macro0"])

core = json.loads(Path("mock-move/data/CoreLibrary/Track Presets/Mock Drift.json").read_text(encoding="utf-8"))
from_core = presets.extract_instrument(core)
check("core split keeps drift", from_core["kind"] == "drift", from_core["kind"])
check("core delay becomes an editable effect", from_core["effects"] and from_core["effects"][0]["kind"] == "delay", from_core["effects"])

try:
    presets.extract_instrument({"kind": "reverb", "parameters": {"Enabled": True}})
    check("effects are refused as instruments", False)
except presets.PresetError:
    check("effects are refused as instruments", True)

status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

listed = get("/api/presets/instruments")
paths = [f"{item['source']}:{item['path']}" for item in listed["instruments"]]
check("lists the mock core drift", any(item.endswith("Mock Drift.json") and item.startswith("factory:") for item in paths), paths)

loaded = get("/api/presets/load?source=factory&path=Track%20Presets/Mock%20Drift.json")
check("load returns drift", loaded["kind"] == "drift", loaded)
check("load returns the delay", loaded["effects"] and loaded["effects"][0]["kind"] == "delay", loaded.get("effects"))

built = post("/api/presets/build", {
    "name": "Smoke Preset",
    "instrument": {"source": "factory", "path": "Track Presets/Mock Drift.json"},
    "devices": [
        {"kind": "reverb", "parameters": {"DecayTime": 1800}},
        {"kind": "delay", "parameters": {"Feedback": 0.5}},
    ],
    "macros": [{"index": 0, "name": "Space", "device": 0, "param": "DecayTime"}],
})
check("save lands in Track Presets", built["path"] == "Smoke Preset.ablpreset", built)
saved = json.loads((PRESETS / "Smoke Preset.ablpreset").read_text(encoding="utf-8"))
check("saved instrument is drift", saved["chains"][0]["devices"][0]["kind"] == "drift")
check("saved two effects", [d["kind"] for d in saved["chains"][0]["devices"][1:]] == ["reverb", "delay"])
check("saved Space macro", saved["parameters"]["Macro0"]["customName"] == "Space", saved["parameters"]["Macro0"])

parsed = post("/api/presets/parse", {"preset": core})
check("upload parse reads Mock Drift", parsed["name"] == "Mock Drift", parsed)

reloaded = get("/api/presets/load?source=presets&path=Smoke%20Preset.ablpreset")
check("edit load restores Space", reloaded["macros"] and reloaded["macros"][0]["name"] == "Space", reloaded.get("macros"))

post("/api/delete", {"kind": "presets", "items": ["Smoke Preset.ablpreset"]})
check("cleanup removed the smoke preset", not (PRESETS / "Smoke Preset.ablpreset").exists())

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
