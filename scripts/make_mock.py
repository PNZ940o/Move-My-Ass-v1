"""Builds a fake Move filesystem so the app can be developed without hardware.

Run:  python scripts/make_mock.py
"""

from __future__ import annotations

import json
import math
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.move import paths  # noqa: E402

SAMPLE_RATE = 44100


def write_tone(path: Path, freq: float, seconds: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(SAMPLE_RATE * seconds)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        payload = bytearray()
        for i in range(frames):
            decay = 1.0 - (i / frames)
            value = int(22000 * decay * math.sin(2 * math.pi * freq * i / SAMPLE_RATE))
            payload += struct.pack("<h", value)
        handle.writeframes(bytes(payload))


def local(move_path: str) -> Path:
    return settings.mock_root / move_path.lstrip("/")


def main() -> None:
    for root in paths.LIBRARY_ROOTS.values():
        local(root).mkdir(parents=True, exist_ok=True)

    drums = {"Kick": 55, "Snare": 220, "Clap": 440, "Hat": 1200, "Tom": 110, "Rim": 880}
    for name, freq in drums.items():
        write_tone(local(f"{paths.SAMPLES}/Drums/{name}.wav"), freq, 0.35)

    for index, freq in enumerate([261.6, 329.6, 392.0], start=1):
        write_tone(local(f"{paths.SAMPLES}/Melodic/Pad {index}.wav"), freq, 1.2)

    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/808/Kick.wav"), 50, 0.4)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/808/Snare.wav"), 200, 0.3)

    write_tone(local(f"{paths.RECORDINGS}/Set 1 Rec 1.wav"), 180, 0.8)

    def mock_set(uuid: str, name: str, pad_index: int, color_id: int) -> None:
        folder = local(f"{paths.SETS}/{uuid}/{name}")
        folder.mkdir(parents=True, exist_ok=True)
        encoded = name.replace(" ", "%20")
        song = {
            "$schema": "http://tech.ableton.com/schema/song/1.5.1/song.json",
            "tempo": 120.0,
            "tracks": [],
            "sample": f"ableton:/user-library/Sets/{uuid}/{encoded}/Samples/hit.wav",
        }
        (folder / "Song.abl").write_text(json.dumps(song, indent=2), encoding="utf-8")
        sidecar = local(f"{paths.SETS}/{uuid}/.xattrs.json")
        sidecar.write_text(
            json.dumps({"user.song-index": str(pad_index), "user.song-color": str(color_id)}),
            encoding="utf-8",
        )

    mock_set("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "Green Loop", 0, 9)
    mock_set("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "Night Drive", 11, 18)
    mock_set("cccccccc-3333-4333-8333-cccccccccccc", "Warm Pad", 31, 3)

    preset = {
        "$schema": "http://tech.ableton.com/schema/song/1.4.4/devicePreset.json",
        "kind": "instrumentRack",
        "name": "Mock Kit",
        "parameters": {"Enabled": True},
        "chains": [],
    }
    target = local(f"{paths.TRACK_PRESETS}/Mock Kit.ablpreset")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(preset, indent=2), encoding="utf-8")

    print(f"Mock Move built at {settings.mock_root}")


if __name__ == "__main__":
    main()
