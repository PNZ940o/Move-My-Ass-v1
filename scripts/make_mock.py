"""Builds a fake Move filesystem so the app can be developed without hardware.

Run:  python scripts/make_mock.py            # fill in anything missing
      python scripts/make_mock.py --reset    # wipe it and rebuild the baseline

The build is deterministic — fixed UUIDs, tones from formulas — so --reset always
lands on the same baseline. That is what makes it safe to wreck the mock while
testing and then come back to a known state.

The test scripts lean on some of this content, so keep these exact:
  * Samples/Drums holds exactly six drums     - kit_test counts them
  * Samples/Melodic/Pad 1.wav lasts 1.2s      - kit_test reads its duration
  * Recordings holds "Set 1 Rec 1.wav"        - smoke_test copies it around
  * three Sets only, on pads 0, 11 and 31     - set_test counts and sorts them
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.move import paths  # noqa: E402

SAMPLE_RATE = 44100
DEFAULT_PORT = 8000

# Exactly six, and kit_test expects Kick/Snare/Hat to land on their role pads.
DRUMS = {"Kick": 55, "Snare": 220, "Clap": 440, "Hat": 1200, "Tom": 110, "Rim": 880}


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


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def release_running_app(port: int) -> bool:
    """Ask a running app to drop its backend, and report whether one answered.

    Undo snapshots live in the system temp dir rather than in the mock, so wiping
    the mock underneath a live server would leave Ctrl+Z able to resurrect files
    that reset just removed. Disconnecting clears that stack.
    """
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/disconnect", data=b"", method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=3):
            return True
    except urllib.error.HTTPError:
        # Something is listening and it spoke HTTP, which is enough for our purpose.
        return True
    except (urllib.error.URLError, OSError):
        return False


def wipe() -> None:
    root = settings.mock_root
    if root.exists():
        shutil.rmtree(root)


def build() -> None:
    from app.move import effects, instruments, kits, presets

    for root in paths.LIBRARY_ROOTS.values():
        local(root).mkdir(parents=True, exist_ok=True)

    # --- Samples -----------------------------------------------------------
    for name, freq in DRUMS.items():
        write_tone(local(f"{paths.SAMPLES}/Drums/{name}.wav"), freq, 0.35)

    for index, freq in enumerate([261.6, 329.6, 392.0], start=1):
        write_tone(local(f"{paths.SAMPLES}/Melodic/Pad {index}.wav"), freq, 1.2)

    write_tone(local(f"{paths.SAMPLES}/Loops/Break 90.wav"), 200, 2.0)
    write_tone(local(f"{paths.SAMPLES}/Loops/Chord Stab.wav"), 330, 0.6)
    write_tone(local(f"{paths.SAMPLES}/Loops/Rise.wav"), 500, 1.5)

    # Nested on purpose, so moving, copying and zipping folder trees has a
    # subject that is more than one level deep.
    write_tone(local(f"{paths.SAMPLES}/Vocals/Takes/Take 1.wav"), 420, 0.9)
    write_tone(local(f"{paths.SAMPLES}/Vocals/Takes/Take 2.wav"), 460, 0.7)
    write_tone(local(f"{paths.SAMPLES}/Vocals/Adlib.wav"), 380, 0.5)

    # --- Recordings --------------------------------------------------------
    write_tone(local(f"{paths.RECORDINGS}/Set 1 Rec 1.wav"), 180, 0.8)
    write_tone(local(f"{paths.RECORDINGS}/Set 1 Rec 2.wav"), 240, 1.0)
    write_tone(local(f"{paths.RECORDINGS}/Set 2 Rec 1.wav"), 150, 1.4)
    write_tone(local(f"{paths.RECORDINGS}/Set 7 Rec 3.wav"), 300, 0.5)

    # --- Sets --------------------------------------------------------------
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

    # --- Track Presets -----------------------------------------------------
    kit_pads = [kits.Pad(kits.library_uri(f"Drums/{name}.wav")) for name in DRUMS]
    kit_pads += [kits.Pad()] * (kits.PAD_COUNT - len(kit_pads))
    write_json(
        local(f"{paths.TRACK_PRESETS}/Mock Kit.ablpreset"),
        kits.build_preset("Mock Kit", kit_pads, "drum"),
    )
    write_json(
        local(f"{paths.TRACK_PRESETS}/Warm Drift.ablpreset"),
        presets.build_track_preset("Warm Drift", presets.default_device("drift"), "reverb", ""),
    )
    write_json(
        local(f"{paths.TRACK_PRESETS}/Simple Wave.ablpreset"),
        presets.build_track_preset("Simple Wave", presets.default_device("wavetable"), "", ""),
    )

    # --- Audio Effects (user racks) ----------------------------------------
    def write_rack(relative: str, kind: str, name: str) -> None:
        write_json(local(f"{paths.AUDIO_EFFECTS}/{relative}"), effects.build_preset(name, [{"kind": kind}]))

    write_rack("Reverb/My Hall.ablpreset", "reverb", "My Hall")
    write_rack("Saturator/Warm Clip.ablpreset", "saturator", "Warm Clip")
    write_rack("Delay/Ping Pong.ablpreset", "delay", "Ping Pong")
    write_rack("Compressor/Glue.ablpreset", "compressor", "Glue")

    # --- Core Library (read-only stock content) ----------------------------
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/808/Kick.wav"), 50, 0.4)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/808/Snare.wav"), 200, 0.3)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/Acoustic/Rim Shot.wav"), 900, 0.2)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/Acoustic/Brush Snare.wav"), 260, 0.3)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/Percussion/Conga.wav"), 190, 0.3)
    write_tone(local(f"{paths.CORE_LIBRARY}/Samples/Percussion/Shaker.wav"), 1500, 0.2)

    def write_device(relative: str, kind: str, name: str) -> None:
        device = effects.build_device(kind)
        device["name"] = name
        write_json(local(f"{paths.CORE_LIBRARY}/Audio Effects/{relative}"), {"$schema": effects.SCHEMA, **device})

    write_device("Reverb/Hall Bright.json", "reverb", "Hall Bright")
    write_device("Reverb/Arena Tail.json", "reverb", "Arena Tail")
    write_device("Saturator/808 Shaper.json", "saturator", "808 Shaper")
    write_device("Delay/16th Clean.json", "delay", "16th Clean")
    write_device("Chorus/Wide Sweep.json", "chorus", "Wide Sweep")
    write_device("Compressor/Bus Glue.json", "compressor", "Bus Glue")

    # A stock instrument to load in the preset builder, which reads its
    # instrument list out of the Core Library as well as the user library.
    write_json(
        local(f"{paths.CORE_LIBRARY}/Track Presets/Mock Drift.json"),
        presets.build_track_preset("Mock Drift", presets.default_device("drift"), "delay", ""),
    )

    assert instruments.BY_KIND, "instrument catalog is empty"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete the mock folder first, so you get the pristine baseline back",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"port the app is served on, checked before a reset (default {DEFAULT_PORT})",
    )
    args = parser.parse_args()

    if args.reset:
        if release_running_app(args.port):
            print(f"Asked the app on port {args.port} to disconnect so undo history won't outlive the wipe.")
        wipe()
        print(f"Wiped {settings.mock_root}")

    build()
    action = "rebuilt" if args.reset else "topped up"
    print(f"Mock Move {action} at {settings.mock_root}")


if __name__ == "__main__":
    main()
