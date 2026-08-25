"""Checks the audio-effect rack builder — mock only."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.move import effects  # noqa: E402

BASE = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8001")
EFFECTS = Path("mock-move/data/UserData/UserLibrary/Audio Effects")
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


rack = effects.build_preset("Space Echo", [
    {"kind": "reverb", "parameters": {"DecayTime": 2400, "MixDirect": 0.2}},
    {"kind": "delay", "parameters": {"Feedback": 0.4}},
])
check("top-level kind is audioEffectRack", rack["kind"] == "audioEffectRack", rack["kind"])
check("two devices in the chain", len(rack["chains"][0]["devices"]) == 2)
check("reverb decay was applied", rack["chains"][0]["devices"][0]["parameters"]["DecayTime"] == 2400)
check("delay keeps its name", rack["chains"][0]["devices"][1]["name"] == "Delay")

mapped = effects.build_preset("Macro Verb", [
    {"kind": "reverb", "parameters": {"DecayTime": 2400}},
], macros=[{"index": 0, "name": "Decay", "device": 0, "param": "DecayTime"}])
macro0 = mapped["parameters"]["Macro0"]
decay = mapped["chains"][0]["devices"][0]["parameters"]["DecayTime"]
check("named macro is an object", isinstance(macro0, dict), macro0)
check("macro shows on Move as Decay", macro0.get("customName") == "Decay", macro0)
check("decay stays 2400 under the mapping", decay["value"] == 2400, decay)
check("decay maps to macro 1", decay["macroMapping"]["macroIndex"] == 0, decay)
check("unused macros stay zero", mapped["parameters"]["Macro1"] == 0.0)

try:
    effects.build_preset("Nope", [
        {"kind": "reverb"},
    ], macros=[{"index": 0, "device": 0, "param": "RoomType"}])
    check("enum macros refused", False)
except effects.EffectError:
    check("enum macros refused", True)

try:
    effects.build_preset("Nope", [])
    check("empty chain refused", False)
except effects.EffectError:
    check("empty chain refused", True)

try:
    effects.build_preset("Nope", [
        {"kind": "reverb"},
        {"kind": "delay"},
        {"kind": "limiter"},
        {"kind": "chorus"},
        {"kind": "phaser"},
        {"kind": "saturator"},
        {"kind": "channelEq"},
        {"kind": "compressor"},
        {"kind": "redux2"},
    ])
    check("nine effects refused", False)
except effects.EffectError:
    check("nine effects refused", True)

trio = effects.build_preset("Trio", [
    {"kind": "reverb"},
    {"kind": "delay"},
    {"kind": "limiter"},
])
check("three effects stack in one rack", len(trio["chains"][0]["devices"]) == 3)

try:
    effects.build_preset("Nope", [{"kind": "waffle"}])
    check("unknown effect refused", False)
except effects.EffectError:
    check("unknown effect refused", True)

for kind in ("autoFilter", "autoPan", "autoShift", "erosion"):
    rack = effects.build_preset(kind, [{"kind": kind}])
    check(f"{kind} builds as {kind}", rack["chains"][0]["devices"][0]["kind"] == kind)

status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

catalog = get("/api/effects/catalog")
kinds = [item["kind"] for item in catalog["effects"]]
check("catalog lists the Move FX", kinds == [
    "reverb", "delay", "autoFilter", "chorus", "phaser", "autoPan", "autoShift",
    "erosion", "saturator", "channelEq", "compressor", "limiter", "redux2",
], kinds)
check("reverb exposes DecayTime",
      any(p["id"] == "DecayTime" for p in catalog["effects"][0]["params"]))
check("reverb suggests Move knobs", "DecayTime" in catalog["effects"][0].get("knobs", []))

built = post("/api/effects/build", {
    "name": "Smoke FX",
    "devices": [
        {"kind": "saturator", "parameters": {"DryWet": 0.6, "Type": "Analog Clip"}},
        {"kind": "limiter", "parameters": {}},
    ],
    "macros": [
        {"index": 0, "name": "Drive", "device": 0, "param": "PreDrive"},
        {"index": 1, "name": "Ceiling", "device": 1, "param": "Ceiling"},
    ],
})
check("save returns the effects path", built["path"] == "Smoke FX.ablpreset", built)
check("file landed in Audio Effects", (EFFECTS / "Smoke FX.ablpreset").is_file())
saved = json.loads((EFFECTS / "Smoke FX.ablpreset").read_text(encoding="utf-8"))
check("saved Drive macro name", saved["parameters"]["Macro0"]["customName"] == "Drive", saved["parameters"]["Macro0"])
check("drive is mapped to macro 1",
      saved["chains"][0]["devices"][0]["parameters"]["PreDrive"]["macroMapping"]["macroIndex"] == 0)

listing = get("/api/list?kind=effects")
names = [item["name"] for item in listing["items"]]
check("listing shows the new preset", "Smoke FX.ablpreset" in names, names)

try:
    post("/api/effects/build", {
        "name": "Too Many",
        "devices": [
            {"kind": "reverb"}, {"kind": "delay"}, {"kind": "limiter"},
            {"kind": "chorus"}, {"kind": "phaser"}, {"kind": "saturator"},
            {"kind": "channelEq"}, {"kind": "compressor"}, {"kind": "redux2"},
        ],
    })
    check("API refuses nine effects", False)
except urllib.error.HTTPError as exc:
    check("API refuses nine effects", exc.code == 400, exc.code)

try:
    post("/api/effects/build", {"name": "Smoke FX", "devices": [{"kind": "reverb"}]})
    check("duplicate name is rejected", False)
except urllib.error.HTTPError as exc:
    check("duplicate name is rejected", exc.code == 409, exc.code)

post("/api/delete", {"kind": "effects", "items": ["Smoke FX.ablpreset"]})
check("cleanup removed the smoke preset", not (EFFECTS / "Smoke FX.ablpreset").exists())

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
