"""Builds Move drum rack presets.

The `.ablpreset` format is JSON, so a kit is an instrumentRack containing a
drumRack with 16 chains, one per pad. Each chain holds a drumCell whose
`deviceData.sampleUri` points at a sample.

Slicing a break does not cut audio: every pad references the same file and uses
`Voice_PlaybackStart` / `Voice_PlaybackLength`, both normalised to 0..1.

Structure, lock values and kit-type parameters follow the working implementation
in charlesvestal/extending-move.
"""

from __future__ import annotations

import array
import io
import json
import posixpath
import re
import struct
import wave
from dataclasses import dataclass
from urllib.parse import quote

from .effects import CATALOG as EFFECT_CATALOG

PAD_COUNT = 16
BASE_NOTE = 36

SCHEMA = "http://tech.ableton.com/schema/song/1.4.4/devicePreset.json"

# Envelope behaviour per kit flavour.
KIT_TYPES: dict[str, dict] = {
    "drum": {"hold": 0.6, "choke_group": None, "mode": "A-H-D"},
    "gate": {"hold": 0.6, "choke_group": None, "mode": "A-S-R"},
    "choke": {"hold": 60.0, "choke_group": 1, "mode": "A-H-D"},
}

# Two FX slots on a Move drum kit: a return-chain send (official default:
# reverb) and an insert after the drum rack (official default: saturator).
# Kinds match the Make effect catalog so kit menus stay in lockstep.
PRESET_PREFIX = "preset:"
EFFECT_KINDS: dict[str, str] = {item["kind"]: item["name"] for item in EFFECT_CATALOG}
DEFAULT_RETURN_EFFECT = "reverb"
DEFAULT_INSERT_EFFECT = "saturator"

# Pad order across Move's 4x4 grid. Pad 1 is bottom-left (MIDI 36). Bottom row
# is the backbone of a beat, then hats, toms, cymbals and colour.
ROLE_KEYWORDS: list[tuple[str, list[str]]] = [
    ("kick", ["kick", "bassdrum", "bass drum", "bd", "boom"]),
    ("snare", ["snare", "sd", "snr"]),
    ("clap", ["clap", "handclap", "cp"]),
    ("rim", ["rimshot", "rim", "stick", "click"]),
    ("pedal hat", ["pedalhat", "pedal hat", "phh", "pedal"]),
    ("open hat", ["openhat", "open hat", "hho", "ohh", "open"]),
    ("closed hat", ["closedhat", "closed hat", "hihat", "hi hat", "hhc", "chh", "hat", "hh"]),
    ("shaker", ["shaker", "tambourine", "tamb", "maraca"]),
    ("low tom", ["lowtom", "low tom", "tom low", "tom1", "lt"]),
    ("mid tom", ["midtom", "mid tom", "tom2", "mt"]),
    ("high tom", ["hightom", "high tom", "hitom", "tom3", "ht", "tom"]),
    ("cowbell", ["cowbell", "woodblock", "block", "clave", "cow"]),
    ("crash", ["crash", "cymbal", "cym"]),
    ("ride", ["ride", "rd"]),
    ("perc", ["perc", "bongo", "conga", "triangle", "agogo"]),
    ("fx", ["fx", "vocal", "vox", "riser", "noise", "zap", "laser"]),
]

PAD_ROLES = [role for role, _ in ROLE_KEYWORDS]
assert len(PAD_ROLES) == PAD_COUNT


@dataclass
class Pad:
    """One drum rack cell. An empty pad has no sample."""

    sample_uri: str | None = None
    playback_start: float | None = None
    playback_length: float | None = None
    label: str = ""


class AudioError(ValueError):
    pass


class EffectError(ValueError):
    pass


# Which user-library folder a kit can draw audio from. Move's own kits reference
# Recordings as readily as Samples.
SECTION_NAMES = {"samples": "Samples", "recordings": "Recordings"}


def library_uri(relative_path: str, section: str = "samples") -> str:
    """URI for audio already sitting in Move's user library.

    Verified against presets written by Move itself, which use
    `ableton:/user-library/Recordings/Set%2039%20Rec%2014.wav`.
    """
    folder = SECTION_NAMES.get(section, "Samples")
    return f"ableton:/user-library/{folder}/" + quote(relative_path.strip("/"))


def bundle_uri(filename: str) -> str:
    """URI for a sample carried inside an .ablpresetbundle."""
    return "Samples/" + quote(posixpath.basename(filename))


def _normalise(name: str) -> tuple[set[str], str]:
    stem = posixpath.splitext(posixpath.basename(name))[0].lower()
    spaced = re.sub(r"[^a-z0-9]+", " ", stem).strip()
    return set(spaced.split()), spaced.replace(" ", "")


def classify(name: str) -> str | None:
    """Guess a drum role from a filename, or None if nothing matches."""
    tokens, compact = _normalise(name)
    for role, keywords in ROLE_KEYWORDS:
        for keyword in keywords:
            # Short keywords only match whole words, so "bd" doesn't fire on
            # "bdrum-ish" filenames that happen to contain the letters.
            if len(keyword) <= 3:
                if keyword in tokens:
                    return role
            elif keyword.replace(" ", "") in compact:
                return role
    return None


def assign_smart(samples: list[str]) -> tuple[list[str | None], list[str]]:
    """Place samples on pads by guessed role, then fill gaps alphabetically.

    Returns the 16 pad slots and any samples that did not fit.
    """
    slots: list[str | None] = [None] * PAD_COUNT
    leftovers: list[str] = []

    for sample in sorted(samples, key=str.lower):
        role = classify(sample)
        if role is None:
            leftovers.append(sample)
            continue
        index = PAD_ROLES.index(role)
        if slots[index] is None:
            slots[index] = sample
        else:
            leftovers.append(sample)

    remaining = []
    for sample in leftovers:
        free = next((i for i, slot in enumerate(slots) if slot is None), None)
        if free is None:
            remaining.append(sample)
        else:
            slots[free] = sample

    return slots, remaining


def duration_seconds(data: bytes) -> float:
    """Length of a WAV file in seconds, read from its header."""
    try:
        with wave.open(io.BytesIO(data)) as handle:
            rate = handle.getframerate()
            if not rate:
                raise AudioError("file reports a sample rate of zero")
            return handle.getnframes() / float(rate)
    except wave.Error as exc:
        raise AudioError(f"not a readable WAV file: {exc}") from exc


WAVEFORM_BUCKETS = 320


def waveform_peaks(data: bytes, buckets: int = WAVEFORM_BUCKETS) -> list[float]:
    """Downsample a PCM WAV to `buckets` peak amplitudes in 0..1.

    Used to draw slice pads without shipping the audio to the browser twice.
    Unreadable or compressed files return an empty list so the UI can hide.
    """
    try:
        with wave.open(io.BytesIO(data)) as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            frames = handle.getnframes()
            raw = handle.readframes(frames)
    except wave.Error:
        return []
    if frames <= 0 or channels <= 0 or width <= 0 or not raw:
        return []

    samples = _pcm_samples(raw, frames * channels, width)
    if samples is None:
        return []

    buckets = max(1, min(int(buckets), frames))
    peaks = [0.0] * buckets
    scale = {1: 128.0, 2: 32768.0, 3: 8388608.0, 4: 2147483648.0}[width]
    for frame in range(frames):
        bucket = frame * buckets // frames
        amp = 0.0
        base = frame * channels
        for channel in range(channels):
            value = abs(samples[base + channel]) / scale
            if value > amp:
                amp = value
        if amp > peaks[bucket]:
            peaks[bucket] = amp

    loudest = max(peaks) or 1.0
    return [round(min(peak / loudest, 1.0), 4) for peak in peaks]


def _pcm_samples(raw: bytes, count: int, width: int) -> array.array | list[int] | None:
    """Signed sample values, one per channel-frame. 8-bit WAV is stored unsigned."""
    if width == 1:
        return [byte - 128 for byte in raw[:count]]
    if width == 2:
        samples = array.array("h")
        samples.frombytes(raw[: count * 2])
        return samples
    if width == 3:
        values = []
        span = min(len(raw), count * 3)
        for index in range(0, span - 2, 3):
            packed = raw[index] | (raw[index + 1] << 8) | (raw[index + 2] << 16)
            if packed & 0x800000:
                packed -= 0x1000000
            values.append(packed)
        return values
    if width == 4:
        return list(struct.unpack_from(f"<{count}i", raw))
    return None


def equal_slices(count: int, total_seconds: float) -> list[dict]:
    """Split a sample into `count` equal regions, normalised to 0..1."""
    count = max(1, min(count, PAD_COUNT))
    slices = []
    for index in range(count):
        start = index / count
        slices.append(
            {
                "index": index,
                "start": start,
                "length": 1 / count,
                "start_seconds": start * total_seconds,
                "length_seconds": total_seconds / count,
            }
        )
    return slices


def slices_from_regions(regions: list[dict], total_seconds: float) -> list[dict]:
    """Convert explicit second-based regions into normalised pad slices."""
    if total_seconds <= 0:
        raise AudioError("sample duration is zero")
    slices = []
    for index, region in enumerate(regions[:PAD_COUNT]):
        start = max(0.0, float(region.get("start", 0.0)))
        end = max(start, float(region.get("end", start)))
        slices.append(
            {
                "index": index,
                "start": start / total_seconds,
                "length": (end - start) / total_seconds,
                "start_seconds": start,
                "length_seconds": end - start,
            }
        )
    return slices


def slices_from_normalised(regions: list[dict], total_seconds: float) -> list[dict]:
    """Pad slices from client 0..1 start/length values, clamped into range."""
    slices = []
    for index, region in enumerate(regions[:PAD_COUNT]):
        start = max(0.0, min(1.0, float(region.get("start", 0.0))))
        length = max(0.0, min(1.0 - start, float(region.get("length", 0.0))))
        slices.append(
            {
                "index": index,
                "start": start,
                "length": length,
                "start_seconds": start * total_seconds,
                "length_seconds": length * total_seconds,
            }
        )
    return slices


def effect_uri(relative_path: str) -> str:
    """URI for an Audio Effects preset already sitting in Move's user library."""
    return "ableton:/user-library/Audio Effects/" + quote(relative_path.strip("/"))


def device_from_preset(data: bytes, relative: str) -> dict:
    """Turn a saved `.ablpreset` into a device that can sit on a kit FX slot."""
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EffectError("effect preset is not readable") from exc
    if not isinstance(payload, dict) or not payload.get("kind"):
        raise EffectError("effect preset is not a Move device")
    device = {key: value for key, value in payload.items() if key != "$schema"}
    device["presetUri"] = effect_uri(relative)
    if not device.get("name"):
        device["name"] = posixpath.splitext(posixpath.basename(relative))[0]
    return device


def _normalise_effect(kind: str | None, default: str) -> str:
    """Resolve an FX slot: None keeps the official default, '' turns the slot off."""
    if kind is None:
        return default
    kind = str(kind).strip()
    if kind in ("", "off", "none"):
        return ""
    if kind.startswith(PRESET_PREFIX):
        path = kind[len(PRESET_PREFIX) :].strip().replace("\\", "/").lstrip("/")
        if not path or ".." in path.split("/"):
            raise EffectError("invalid effect preset")
        return PRESET_PREFIX + path
    if kind not in EFFECT_KINDS:
        raise EffectError(f"unknown effect: {kind}")
    return kind


def _effect_device(kind: str) -> dict:
    return {
        "presetUri": None,
        "kind": kind,
        "name": EFFECT_KINDS[kind],
        "parameters": {},
        "deviceData": {},
    }


def slot_device(value, default: str) -> dict | None:
    """Build the device for one kit FX slot, or None when the slot is off.

    `value` is a catalog kind, `preset:path`, a ready device dict, None (default),
    or empty (off). Preset paths must already be loaded into a device dict.
    """
    if isinstance(value, dict):
        if not value.get("kind"):
            raise EffectError("effect preset is missing a kind")
        return value
    kind = _normalise_effect(value, default)
    if not kind:
        return None
    if kind.startswith(PRESET_PREFIX):
        raise EffectError("effect preset was not loaded")
    return _effect_device(kind)


def _return_chains_from_device(device: dict | None) -> list:
    if not device:
        return []
    return [
        {
            "name": "",
            "color": 0,
            "devices": [device],
            "mixer": {
                "pan": 0.0,
                "solo-cue": False,
                "speakerOn": True,
                "volume": 0.0,
                "sends": [{"isEnabled": False, "amount": -70.0}],
            },
        }
    ]


def _drum_cell(pad: Pad, index: int, spec: dict) -> dict:
    parameters: dict = {
        "Voice_Envelope_Hold": spec["hold"],
        "Voice_Envelope_Mode": spec["mode"],
    }
    if pad.playback_start is not None:
        parameters["Voice_PlaybackStart"] = pad.playback_start
        parameters["Voice_Envelope_Decay"] = 0.0
    if pad.playback_length is not None:
        parameters["Voice_PlaybackLength"] = pad.playback_length

    return {
        "name": "",
        "color": 0,
        "devices": [
            {
                "presetUri": None,
                "kind": "drumCell",
                "name": "",
                "parameters": parameters,
                "deviceData": {"sampleUri": pad.sample_uri},
            }
        ],
        "mixer": {
            "pan": 0.0,
            "solo-cue": False,
            "speakerOn": True,
            "volume": 0.0,
            "sends": [{"isEnabled": True, "amount": -70.0}],
        },
        "drumZoneSettings": {
            "receivingNote": BASE_NOTE + index,
            "sendingNote": 60,
            "chokeGroup": spec["choke_group"],
        },
    }


def build_preset(
    name: str,
    pads: list[Pad],
    kit_type: str = "drum",
    return_effect: str | None = None,
    insert_effect: str | None = None,
) -> dict:
    """Assemble a complete drum kit preset around 16 pads."""
    spec = KIT_TYPES.get(kit_type, KIT_TYPES["drum"])
    padded = (pads + [Pad()] * PAD_COUNT)[:PAD_COUNT]
    macros = {f"Macro{i}": 0.0 for i in range(8)}
    ret = slot_device(return_effect, DEFAULT_RETURN_EFFECT)
    ins = slot_device(insert_effect, DEFAULT_INSERT_EFFECT)

    devices: list[dict] = [
        {
            "presetUri": None,
            "kind": "drumRack",
            "name": "",
            "lockId": 1001,
            "lockSeal": 830049224,
            "parameters": {"Enabled": True, **macros},
            "chains": [
                _drum_cell(pad, index, spec) for index, pad in enumerate(padded)
            ],
            "returnChains": _return_chains_from_device(ret),
        }
    ]
    if ins:
        devices.append(ins)

    return {
        "$schema": SCHEMA,
        "kind": "instrumentRack",
        "name": name,
        "lockId": 1001,
        "lockSeal": -973461132,
        "parameters": {"Enabled": True, **macros},
        "chains": [
            {
                "name": "",
                "color": 0,
                "devices": devices,
                "mixer": {
                    "pan": 0.0,
                    "solo-cue": False,
                    "speakerOn": True,
                    "volume": 0.0,
                    "sends": [],
                },
            }
        ],
    }
