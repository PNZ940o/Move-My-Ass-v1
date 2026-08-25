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
check("bare drift exposes filter params", "Filter_Frequency" in extracted["parameters"], extracted["parameters"])

stacked = presets.build_track_preset(
    "Warm Drift",
    extracted["device"],
    [{"kind": "reverb", "parameters": {"DecayTime": 2000}}],
    [
        {"index": 0, "name": "Cutoff", "device": 0, "param": "Filter_Frequency"},
        {"index": 1, "name": "Decay", "device": 1, "param": "DecayTime"},
    ],
    extracted["parameters"],
)
check("track preset is an instrumentRack", stacked["kind"] == "instrumentRack")
check("instrument stays first", stacked["chains"][0]["devices"][0]["kind"] == "drift")
check("effect is stacked after", stacked["chains"][0]["devices"][1]["kind"] == "reverb")
check("macro 1 is Cutoff", stacked["parameters"]["Macro0"]["customName"] == "Cutoff", stacked["parameters"]["Macro0"])
check("macro 2 is Decay", stacked["parameters"]["Macro1"]["customName"] == "Decay", stacked["parameters"]["Macro1"])
cutoff = stacked["chains"][0]["devices"][0]["parameters"]["Filter_Frequency"]
check(
    "cutoff is mapped on the instrument",
    isinstance(cutoff, dict) and cutoff.get("macroMapping", {}).get("macroIndex") == 0,
    cutoff,
)
decay = stacked["chains"][0]["devices"][1]["parameters"]["DecayTime"]
check(
    "decay is mapped on the reverb",
    isinstance(decay, dict) and decay.get("macroMapping", {}).get("macroIndex") == 1,
    decay,
)

solo = presets.build_track_preset(
    "Just Drift",
    extracted["device"],
    [],
    [{"index": 2, "name": "Reso", "device": 0, "param": "Filter_Resonance"}],
    extracted["parameters"],
)
check("instrument-only rack has no FX", len(solo["chains"][0]["devices"]) == 1, [d["kind"] for d in solo["chains"][0]["devices"]])
check("instrument-only macro name", solo["parameters"]["Macro2"]["customName"] == "Reso", solo["parameters"]["Macro2"])

core = json.loads(Path("mock-move/data/CoreLibrary/Track Presets/Mock Drift.json").read_text(encoding="utf-8"))
from_core = presets.extract_instrument(core)
check("core split keeps drift", from_core["kind"] == "drift", from_core["kind"])
check("core delay becomes an editable effect", from_core["effects"] and from_core["effects"][0]["kind"] == "delay", from_core["effects"])
check("core instrument has cutoff", "Filter_Frequency" in from_core["parameters"], from_core.get("parameters"))

try:
    presets.extract_instrument({"kind": "reverb", "parameters": {"Enabled": True}})
    check("effects are refused as instruments", False)
except presets.PresetError:
    check("effects are refused as instruments", True)

status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

catalog = get("/api/presets/catalog")
kinds = [item["kind"] for item in catalog["instruments"]]
check("catalog lists drift", "drift" in kinds, kinds)

listed = get("/api/presets/instruments")
paths = [f"{item['source']}:{item['path']}" for item in listed["instruments"]]
check("lists the mock core drift", any(item.endswith("Mock Drift.json") and item.startswith("factory:") for item in paths), paths)

loaded = get("/api/presets/load?source=factory&path=Track%20Presets/Mock%20Drift.json")
check("load returns drift", loaded["kind"] == "drift", loaded)
check("load returns the delay", loaded["effects"] and loaded["effects"][0]["kind"] == "delay", loaded.get("effects"))
check("load returns instrument params", "Filter_Frequency" in (loaded.get("parameters") or {}), loaded.get("parameters"))

built = post("/api/presets/build", {
    "name": "Smoke Preset",
    "instrument": {
        "source": "factory",
        "path": "Track Presets/Mock Drift.json",
        "parameters": {"Filter_Frequency": 1200, "Filter_Resonance": 0.4},
    },
    "devices": [
        {"kind": "reverb", "parameters": {"DecayTime": 1800}},
        {"kind": "delay", "parameters": {"Feedback": 0.5}},
    ],
    "macros": [
        {"index": 0, "name": "Cutoff", "device": 0, "param": "Filter_Frequency"},
        {"index": 1, "name": "Space", "device": 1, "param": "DecayTime"},
    ],
})
check("save lands in Track Presets", built["path"] == "Smoke Preset.ablpreset", built)
saved = json.loads((PRESETS / "Smoke Preset.ablpreset").read_text(encoding="utf-8"))
check("saved instrument is drift", saved["chains"][0]["devices"][0]["kind"] == "drift")
check("saved two effects", [d["kind"] for d in saved["chains"][0]["devices"][1:]] == ["reverb", "delay"])
check("saved Cutoff macro", saved["parameters"]["Macro0"]["customName"] == "Cutoff", saved["parameters"]["Macro0"])
check("saved Space macro", saved["parameters"]["Macro1"]["customName"] == "Space", saved["parameters"]["Macro1"])
saved_cut = saved["chains"][0]["devices"][0]["parameters"]["Filter_Frequency"]
check(
    "saved cutoff mapping",
    isinstance(saved_cut, dict) and saved_cut.get("value") == 1200 and saved_cut.get("macroMapping", {}).get("macroIndex") == 0,
    saved_cut,
)
saved_space = saved["chains"][0]["devices"][1]["parameters"]["DecayTime"]
check(
    "saved space mapping on reverb",
    isinstance(saved_space, dict) and saved_space.get("macroMapping", {}).get("macroIndex") == 1,
    saved_space,
)

parsed = post("/api/presets/parse", {"preset": core})
check("upload parse reads Mock Drift", parsed["name"] == "Mock Drift", parsed)
check("upload parse has params", "Filter_Frequency" in (parsed.get("parameters") or {}), parsed.get("parameters"))

reloaded = get("/api/presets/load?source=presets&path=Smoke%20Preset.ablpreset")
macro_names = {slot["name"]: slot for slot in reloaded.get("macros") or []}
check("edit load restores Cutoff on instrument", macro_names.get("Cutoff", {}).get("device") == 0, reloaded.get("macros"))
check("edit load restores Space on first FX", macro_names.get("Space", {}).get("device") == 1, reloaded.get("macros"))

post("/api/delete", {"kind": "presets", "items": ["Smoke Preset.ablpreset"]})
check("cleanup removed the smoke preset", not (PRESETS / "Smoke Preset.ablpreset").exists())

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
