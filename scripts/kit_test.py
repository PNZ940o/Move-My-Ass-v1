"""Checks the drum kit builder: naming heuristics, preset shape, slicing, bundles."""

from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.move import kits  # noqa: E402

BASE = "http://127.0.0.1:8000"
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
        return response.headers, response.read()


print("--- filename heuristics ---")
cases = {
    "BD-808.wav": "kick",
    "Kick 01.wav": "kick",
    "SD_Tight.wav": "snare",
    "Clap Long.wav": "clap",
    "CH Hat.wav": "closed hat",
    "OpenHat 2.wav": "open hat",
    "pedal-hh.wav": "pedal hat",
    "Ride Bell.wav": "ride",
    "Crash 1.wav": "crash",
    "Cowbell.wav": "cowbell",
    "hightom.wav": "high tom",
    "Shaker Loop.wav": "shaker",
    "Vox Stab.wav": "fx",
    "wobble-thing.wav": None,
}
for filename, expected in cases.items():
    got = kits.classify(filename)
    check(f"{filename} -> {expected}", got == expected, got)

print("\n--- pad assignment ---")
slots, unplaced = kits.assign_smart(
    ["Kick.wav", "Snare.wav", "ClosedHat.wav", "OpenHat.wav", "mystery.wav"]
)
check("kick on pad 1", slots[0] == "Kick.wav", slots[0])
check("snare on pad 2", slots[1] == "Snare.wav", slots[1])
check("closed hat on its role pad", slots[kits.PAD_ROLES.index("closed hat")] == "ClosedHat.wav", slots)
check("open hat on its role pad", slots[kits.PAD_ROLES.index("open hat")] == "OpenHat.wav", slots)
check("unmatched sample still placed", "mystery.wav" in slots, slots)
check("nothing dropped", unplaced == [], unplaced)

duplicates = ["Kick 1.wav", "Kick 2.wav", "Kick 3.wav"]
slots, unplaced = kits.assign_smart(duplicates)
check("duplicate roles spill onto free pads",
      all(d in slots for d in duplicates) and unplaced == [], (slots, unplaced))

overflow = [f"thing{i}.wav" for i in range(20)]
slots, unplaced = kits.assign_smart(overflow)
check("overflow reports leftovers", len(unplaced) == 4 and all(slots), len(unplaced))

print("\n--- preset structure ---")
pads = [kits.Pad(kits.library_uri("Drums/Kick.wav"))] + [kits.Pad()] * 15
preset = kits.build_preset("Test Kit", pads, "choke")
rack = preset["chains"][0]["devices"][0]
check("outer device is an instrumentRack", preset["kind"] == "instrumentRack", preset["kind"])
check("inner device is a drumRack", rack["kind"] == "drumRack", rack["kind"])
check("has exactly 16 pads", len(rack["chains"]) == 16, len(rack["chains"]))

notes = [c["drumZoneSettings"]["receivingNote"] for c in rack["chains"]]
check("notes run 36..51", notes == list(range(36, 52)), notes)

cell = rack["chains"][0]["devices"][0]
check("pad 1 carries the sample uri",
      cell["deviceData"]["sampleUri"] == "ableton:/user-library/Samples/Drums/Kick.wav",
      cell["deviceData"]["sampleUri"])
check("empty pads have a null uri",
      rack["chains"][1]["devices"][0]["deviceData"]["sampleUri"] is None,
      rack["chains"][1]["devices"][0]["deviceData"])
check("choke kit sets a choke group",
      all(c["drumZoneSettings"]["chokeGroup"] == 1 for c in rack["chains"]), notes)
check("choke kit holds for 60s",
      cell["parameters"]["Voice_Envelope_Hold"] == 60.0, cell["parameters"])

drum_preset = kits.build_preset("D", pads, "drum")
drum_cell = drum_preset["chains"][0]["devices"][0]["chains"][0]["devices"][0]
check("drum kit has no choke group",
      drum_preset["chains"][0]["devices"][0]["chains"][0]["drumZoneSettings"]["chokeGroup"] is None,
      drum_preset["chains"][0]["devices"][0]["chains"][0]["drumZoneSettings"])
check("drum kit hold is short", drum_cell["parameters"]["Voice_Envelope_Hold"] == 0.6,
      drum_cell["parameters"])

check("spaces are percent-encoded in uris",
      kits.library_uri("Preset Samples/My Kick.wav")
      == "ableton:/user-library/Samples/Preset%20Samples/My%20Kick.wav",
      kits.library_uri("Preset Samples/My Kick.wav"))
# Matches a URI written by Move itself, read off a real device.
check("recordings uris use the Recordings section",
      kits.library_uri("Set 39 Rec 14.wav", "recordings")
      == "ableton:/user-library/Recordings/Set%2039%20Rec%2014.wav",
      kits.library_uri("Set 39 Rec 14.wav", "recordings"))

devices = drum_preset["chains"][0]["devices"]
check("default insert is saturator", devices[1]["kind"] == "saturator", devices[1].get("kind"))
check("default return is reverb",
      devices[0]["returnChains"][0]["devices"][0]["kind"] == "reverb",
      devices[0]["returnChains"][0]["devices"][0].get("kind"))

bare = kits.build_preset("Bare", pads, "drum", return_effect="", insert_effect="")
check("off insert leaves only the drum rack",
      len(bare["chains"][0]["devices"]) == 1, len(bare["chains"][0]["devices"]))
check("off return has no return chain",
      bare["chains"][0]["devices"][0]["returnChains"] == [],
      bare["chains"][0]["devices"][0]["returnChains"])

swapped = kits.build_preset("Swap", pads, "drum", return_effect="delay", insert_effect="chorus")
swap_devices = swapped["chains"][0]["devices"]
check("chosen return is delay",
      swap_devices[0]["returnChains"][0]["devices"][0]["kind"] == "delay",
      swap_devices[0]["returnChains"][0]["devices"][0]["kind"])
check("chosen insert is chorus", swap_devices[1]["kind"] == "chorus", swap_devices[1]["kind"])

try:
    kits.build_preset("Bad", pads, "drum", return_effect="nope")
    check("unknown effect refused", False, "did not raise")
except kits.EffectError:
    check("unknown effect refused", True)

print("\n--- slicing maths ---")
slices = kits.equal_slices(4, 2.0)
check("four equal slices", len(slices) == 4, len(slices))
check("starts are normalised", [s["start"] for s in slices] == [0, 0.25, 0.5, 0.75],
      [s["start"] for s in slices])
check("lengths are normalised", all(s["length"] == 0.25 for s in slices), slices[0])
check("seconds are derived from duration",
      slices[1]["start_seconds"] == 0.5 and slices[1]["length_seconds"] == 0.5, slices[1])
check("slice count is clamped to 16", len(kits.equal_slices(99, 1.0)) == 16,
      len(kits.equal_slices(99, 1.0)))

regions = kits.slices_from_regions([{"start": 0.5, "end": 1.0}], 2.0)
check("explicit regions normalise", regions[0]["start"] == 0.25 and regions[0]["length"] == 0.25,
      regions[0])

print("\n--- waveform peaks ---")
import math
import struct
import wave as wavmod

def _tone(seconds: float, freq: float, decay: bool = True) -> bytes:
    rate = 44100
    frames = int(rate * seconds)
    buf = io.BytesIO()
    with wavmod.open(buf, "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        payload = bytearray()
        for i in range(frames):
            envelope = 1.0 - (i / frames) if decay else 1.0
            value = int(22000 * envelope * math.sin(2 * math.pi * freq * i / rate))
            payload += struct.pack("<h", value)
        handle.writeframes(bytes(payload))
    return buf.getvalue()

peaks = kits.waveform_peaks(_tone(0.4, 220), 32)
check("peak count matches request", len(peaks) == 32, len(peaks))
check("peaks sit in 0..1", all(0 <= p <= 1 for p in peaks), peaks[:4])
check("decaying tone is louder at the start", sum(peaks[:8]) > sum(peaks[-8:]),
      (sum(peaks[:8]), sum(peaks[-8:])))
check("garbage bytes draw nothing", kits.waveform_peaks(b"not a wav") == [], "")

print("\n--- live endpoints ---")
_, raw = post("/api/kit/plan-pads", {"folder": "Drums"})
plan = json.loads(raw)
check("plan finds the mock drums", len(plan["available"]) == 6, plan["available"])
by_role = {p["role"]: p["sample"] for p in plan["pads"]}
check("Kick.wav landed on the kick pad", by_role["kick"] == "Kick.wav", by_role)
check("Snare.wav landed on the snare pad", by_role["snare"] == "Snare.wav", by_role)
check("Hat.wav landed on closed hat", by_role["closed hat"] == "Hat.wav", by_role)

_, raw = post("/api/kit/plan-pads", {"folder": "", "section": "recordings"})
rec_plan = json.loads(raw)
check("recordings can seed a kit", len(rec_plan["available"]) >= 1, rec_plan["available"])

try:
    post("/api/kit/plan-pads", {"folder": "", "section": "presets"})
    check("non-audio sections refused", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("non-audio sections refused", exc.code == 400, exc.code)

_, raw = post("/api/kit/build", {
    "name": "Rec Kit", "mode": "pads", "section": "recordings", "folder": "",
    "pads": [rec_plan["available"][0]], "output": "device",
})
rec_built = Path("mock-move/data/UserData/UserLibrary/Track Presets/Rec Kit.ablpreset")
check("recordings kit written", rec_built.exists(), rec_built)
if rec_built.exists():
    uri = json.loads(rec_built.read_text(encoding="utf-8"))["chains"][0]["devices"][0]["chains"][0]["devices"][0]["deviceData"]["sampleUri"]
    check("recordings kit points at Recordings",
          uri.startswith("ableton:/user-library/Recordings/"), uri)
    rec_built.unlink()

_, raw = post("/api/kit/plan-slices", {"sample": "Melodic/Pad 1.wav", "count": 8})
sliced = json.loads(raw)
check("duration read from wav header", abs(sliced["duration"] - 1.2) < 0.01, sliced["duration"])
check("eight slices planned", len(sliced["slices"]) == 8, len(sliced["slices"]))
check("slice plan includes a waveform", len(sliced.get("peaks") or []) >= 16, sliced.get("peaks"))

try:
    post("/api/kit/plan-slices", {"sample": "Drums/../../etc/passwd", "count": 4})
    check("slice plan refuses traversal", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("slice plan refuses traversal", exc.code == 400, exc.code)

# build onto the mock device
_, raw = post("/api/kit/build", {
    "name": "Smoke Kit", "kit_type": "drum", "mode": "pads", "folder": "Drums",
    "pads": [p["sample"] for p in plan["pads"]], "output": "device",
})
built = json.loads(raw)
check("build reports six filled pads", built["filled_pads"] == 6, built)
check("preset written to Track Presets",
      built["path"] == "/data/UserData/UserLibrary/Track Presets/Smoke Kit.ablpreset", built)

written = Path("mock-move/data/UserData/UserLibrary/Track Presets/Smoke Kit.ablpreset")
check("preset file exists on disk", written.exists(), written)
if written.exists():
    saved = json.loads(written.read_text(encoding="utf-8"))
    saved_rack = saved["chains"][0]["devices"][0]
    uris = [c["devices"][0]["deviceData"]["sampleUri"] for c in saved_rack["chains"]]
    check("saved preset points into the Drums folder",
          uris[0] == "ableton:/user-library/Samples/Drums/Kick.wav", uris[0])
    check("saved preset has 10 empty pads", uris.count(None) == 10, uris.count(None))
    written.unlink()

# refuse samples that aren't there
try:
    post("/api/kit/build", {
        "name": "Bad Kit", "mode": "pads", "folder": "Drums",
        "pads": ["Nope.wav"], "output": "device",
    })
    check("build rejects missing samples", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("build rejects missing samples", exc.code == 400, exc.code)

# bundle output
headers, raw = post("/api/kit/build", {
    "name": "Bundle Kit", "kit_type": "choke", "mode": "slices",
    "sample": "Melodic/Pad 1.wav", "count": 4, "output": "bundle",
})
check("bundle is served as an attachment",
      "Bundle Kit.ablpresetbundle" in headers.get("Content-Disposition", ""),
      headers.get("Content-Disposition"))
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    members = sorted(n.replace("\\", "/") for n in archive.namelist())
    bundled = json.loads(archive.read("Preset.ablpreset"))
check("bundle holds preset plus one sample",
      members == ["Preset.ablpreset", "Samples/Pad 1.wav"], members)

bundle_cells = [c["devices"][0] for c in bundled["chains"][0]["devices"][0]["chains"]]
check("bundle uris are relative",
      bundle_cells[0]["deviceData"]["sampleUri"] == "Samples/Pad%201.wav",
      bundle_cells[0]["deviceData"]["sampleUri"])
check("all four slices share one file",
      len({c["deviceData"]["sampleUri"] for c in bundle_cells[:4]}) == 1, bundle_cells[0])
check("playback offsets differ per pad",
      [c["parameters"]["Voice_PlaybackStart"] for c in bundle_cells[:4]] == [0, 0.25, 0.5, 0.75],
      [c["parameters"].get("Voice_PlaybackStart") for c in bundle_cells[:4]])
check("playback length set on slices",
      bundle_cells[0]["parameters"]["Voice_PlaybackLength"] == 0.25,
      bundle_cells[0]["parameters"])
check("unused pads carry no playback offset",
      "Voice_PlaybackStart" not in bundle_cells[5]["parameters"],
      bundle_cells[5]["parameters"])

# name sanitising
_, raw = post("/api/kit/build", {
    "name": "bad/name:kit", "mode": "pads", "folder": "Drums",
    "pads": ["Kick.wav"], "output": "device",
})
sanitised = json.loads(raw)["path"]
check("unsafe characters stripped from filename",
      sanitised.endswith("bad_name_kit.ablpreset"), sanitised)
Path("mock-move/data/UserData/UserLibrary/Track Presets/bad_name_kit.ablpreset").unlink(missing_ok=True)

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
