"""Build Move track presets: one instrument plus the two hardware FX slots.

User presets live in `/data/UserData/UserLibrary/Track Presets`. Core Library
instruments (`.json` under `/data/CoreLibrary/Track Presets`) can be copied in
inline so the saved rack does not depend on editing factory files.

Factory synth presets chain the instrument then two inserts — those are Move's
two effect slots. v1 does not create instruments or effect racks; it copies an
existing instrument and hangs two catalog/preset devices after it.
"""

from __future__ import annotations

import json
import posixpath
from urllib.parse import unquote

from . import effects, instruments, kits, paths

SCHEMA = effects.SCHEMA
LOCK_ID = effects.LOCK_ID
LOCK_SEAL = -973461132
FACTORY_PRESETS = "Track Presets"
PRESET_SUFFIXES = {".ablpreset", ".json"}
AUDIO_FX_URI = "ableton:/user-library/Audio Effects/"

EFFECT_KINDS = set(effects.BY_KIND) | {"audioEffectRack"}

INSTRUMENT_FAMILIES = (
    ("drift", "Drift"),
    ("wavetable", "Wavetable"),
    ("melodicSampler", "Sampler"),
    ("drumRack", "Drum Rack"),
)
FAMILY_BY_KIND = dict(INSTRUMENT_FAMILIES)
FOLDER_ALIASES = {
    "drift": "drift",
    "analog": "drift",
    "wavetable": "wavetable",
    "melodicsampler": "melodicSampler",
    "melodic sampler": "melodicSampler",
    "sampler": "melodicSampler",
    "drumrack": "drumRack",
    "drum rack": "drumRack",
    "drums": "drumRack",
    "drum": "drumRack",
    "kits": "drumRack",
    "kit": "drumRack",
}
SOUND_ALIASES = {
    "guitar": "Guitars",
    "guitars": "Guitars",
    "gtr": "Guitars",
    "piano": "Pianos",
    "pianos": "Pianos",
    "key": "Keys",
    "keys": "Keys",
    "keyboard": "Keys",
    "keyboards": "Keys",
    "epiano": "Keys",
    "rhodes": "Keys",
    "bass": "Bass",
    "basses": "Bass",
    "pad": "Pads",
    "pads": "Pads",
    "atmosphere": "Pads",
    "ambient": "Pads",
    "lead": "Leads",
    "leads": "Leads",
    "pluck": "Plucks",
    "plucks": "Plucks",
    "string": "Strings",
    "strings": "Strings",
    "brass": "Brass",
    "horn": "Brass",
    "organ": "Organs",
    "organs": "Organs",
    "bell": "Mallets",
    "mallet": "Mallets",
    "mallets": "Mallets",
    "vocal": "Vocals",
    "vocals": "Vocals",
    "choir": "Vocals",
    "voice": "Vocals",
    "drum": "Drums",
    "drums": "Drums",
    "kit": "Drums",
    "perc": "Percussion",
    "percussion": "Percussion",
    "fx": "FX",
    "sfx": "FX",
    "flute": "Woodwinds",
    "sax": "Woodwinds",
    "woodwind": "Woodwinds",
}
NAME_PREFIXES = (
    ("analog", "drift"),
    ("drift", "drift"),
    ("wavetable", "wavetable"),
    ("wt", "wavetable"),
    ("fm", "wavetable"),
    ("sampler", "melodicSampler"),
    ("drum", "drumRack"),
)
SAMPLE_URI_PREFIXES = {
    "samples": "ableton:/user-library/Samples/",
    "recordings": "ableton:/user-library/Recordings/",
}
KIT_VARIANT_NAMES = {
    "drum": "Sample kit",
    "choke": "Choke kit",
    "gate": "Gate kit",
}

EMPTY_MIXER = {
    "pan": 0.0,
    "solo-cue": False,
    "speakerOn": True,
    "volume": 0.0,
    "sends": [],
}


class PresetError(ValueError):
    pass


def dest_path(folder: str, name: str) -> str:
    relative = posixpath.join((folder or "").strip("/"), f"{name}.ablpreset")
    return relative.lstrip("/")


def _strip_schema(value):
    if isinstance(value, dict):
        return {key: _strip_schema(item) for key, item in value.items() if key != "$schema"}
    if isinstance(value, list):
        return [_strip_schema(item) for item in value]
    return value


def _is_effect(device: dict | None) -> bool:
    return (device or {}).get("kind") in EFFECT_KINDS


def _slot_spec(device: dict | None) -> str:
    """Turn a saved FX device into a kit-style slot value (kind or preset:path)."""
    if not device:
        return ""
    uri = str(device.get("presetUri") or "")
    if uri.startswith(AUDIO_FX_URI):
        return kits.PRESET_PREFIX + unquote(uri[len(AUDIO_FX_URI) :])
    kind = device.get("kind") or ""
    if kind == "audioEffectRack":
        chains = device.get("chains") or []
        inner = list((chains[0].get("devices") or []) if chains else [])
        if len(inner) == 1:
            return _slot_spec(inner[0])
        return ""
    if kind in kits.EFFECT_KINDS:
        return kind
    return ""


def _sample_uri(device: dict | None) -> str:
    data = (device or {}).get("deviceData") or {}
    return str(data.get("sampleUri") or "")


def sample_spec_from_uri(uri: str) -> str:
    text = unquote(str(uri or ""))
    for section, prefix in SAMPLE_URI_PREFIXES.items():
        if text.startswith(prefix):
            return f"{section}:{text[len(prefix):]}"
    return ""


def sample_uri_from_spec(spec: str) -> str:
    spec = (spec or "").strip()
    if not spec or ":" not in spec:
        raise PresetError("pick a sample")
    section, relative = spec.split(":", 1)
    if section not in SAMPLE_URI_PREFIXES:
        raise PresetError("sample must come from Samples or Recordings")
    relative = relative.replace("\\", "/").strip("/")
    if not relative or ".." in relative.split("/"):
        raise PresetError("invalid sample path")
    return kits.library_uri(relative, section)


def apply_sample(device: dict, spec: str) -> dict:
    if not spec:
        return device
    synth = instruments.inner_synth(device) or device
    if synth.get("kind") != "melodicSampler":
        raise PresetError("only Sampler can take a sample")
    data = dict(synth.get("deviceData") or {})
    data["sampleUri"] = sample_uri_from_spec(spec)
    synth["deviceData"] = data
    return device


def default_device(kind: str, variant: str = "") -> dict:
    if kind == "drumRack":
        kit_type = variant if variant in kits.KIT_TYPES else "drum"
        rack = kits.build_preset(
            KIT_VARIANT_NAMES.get(kit_type, "Drum Rack"),
            [kits.Pad()] * kits.PAD_COUNT,
            kit_type,
            "",
            "",
        )
        device = rack["chains"][0]["devices"][0]
        device["name"] = KIT_VARIANT_NAMES.get(kit_type, "Drum Rack")
        return device
    item = instruments.BY_KIND.get(kind)
    if not item:
        raise PresetError("unknown instrument")
    return {
        "presetUri": None,
        "kind": kind,
        "name": item["name"],
        "parameters": instruments.defaults_for(kind),
        "deviceData": {},
    }


def load_default(kind: str, variant: str = "") -> dict:
    device = default_device(kind, variant)
    return {
        "name": device["name"],
        "kind": kind,
        "device": device,
        "sample": "",
        "slot1": "",
        "slot2": "",
        "source": "default",
        "path": "",
        "variant": variant if kind == "drumRack" else "",
    }


def _read_preset(backend, source: str, relative: str) -> dict:
    source = (source or "").strip().lower()
    relative = (relative or "").replace("\\", "/").strip("/")
    if not relative or ".." in relative.split("/"):
        raise PresetError("invalid preset path")
    if source == "presets":
        absolute = paths.resolve("presets", relative)
    elif source == "factory":
        if relative != FACTORY_PRESETS and not relative.startswith(FACTORY_PRESETS + "/"):
            raise PresetError("core instruments live in Track Presets")
        absolute = paths.resolve("factory", relative)
    else:
        raise PresetError("instrument must come from Presets or Core Library")
    if not backend.exists(absolute) or backend.is_dir(absolute):
        raise PresetError("instrument preset not found")
    suffix = posixpath.splitext(absolute)[1].lower()
    if suffix not in PRESET_SUFFIXES:
        raise PresetError("select an .ablpreset or .json instrument")
    try:
        payload = json.loads(backend.read_file(absolute).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PresetError("instrument preset is not readable") from exc
    if not isinstance(payload, dict) or not payload.get("kind"):
        raise PresetError("this file is not a Move preset")
    return payload


def extract_instrument(payload: dict) -> dict:
    """Split a track preset into one instrument device plus two FX slot values."""
    payload = _strip_schema(payload)
    kind = payload.get("kind")
    if not kind:
        raise PresetError("this file is not a Move preset")
    if kind in EFFECT_KINDS:
        raise PresetError("that's an audio effect — pick an instrument")

    if kind != "instrumentRack":
        synth = instruments.inner_synth(payload) or payload
        return {
            "name": str(payload.get("name") or kind),
            "kind": synth.get("kind") or kind,
            "device": payload,
            "sample": _sample_uri(synth),
            "slot1": "",
            "slot2": "",
        }

    chains = payload.get("chains") or []
    devices = list((chains[0].get("devices") or []) if chains else [])
    instrument_parts: list[dict] = []
    fx_parts: list[dict] = []
    seen_fx = False
    for device in devices:
        if seen_fx or _is_effect(device):
            seen_fx = True
            fx_parts.append(device)
            continue
        instrument_parts.append(device)

    if not instrument_parts:
        raise PresetError("this preset has no instrument")

    if len(instrument_parts) == 1:
        device = instrument_parts[0]
    else:
        device = {
            "presetUri": None,
            "kind": "instrumentRack",
            "name": payload.get("name") or "Instrument",
            "parameters": {"Enabled": True, **{f"Macro{i}": 0.0 for i in range(8)}},
            "chains": [
                {
                    "name": "",
                    "color": 0,
                    "devices": instrument_parts,
                    "mixer": dict(EMPTY_MIXER),
                }
            ],
        }

    expanded_fx: list[dict] = []
    for fx_device in fx_parts:
        fx_kind = (fx_device or {}).get("kind")
        if fx_kind == "audioEffectRack":
            for chain in fx_device.get("chains") or []:
                expanded_fx.extend(chain.get("devices") or [])
        else:
            expanded_fx.append(fx_device)

    synth = instruments.inner_synth(device) or device
    return {
        "name": str(payload.get("name") or device.get("name") or synth.get("kind") or "Instrument"),
        "kind": synth.get("kind") or device.get("kind") or "instrument",
        "device": device,
        "sample": _sample_uri(synth),
        "slot1": _slot_spec(expanded_fx[0] if expanded_fx else None),
        "slot2": _slot_spec(expanded_fx[1] if len(expanded_fx) > 1 else None),
    }


def load_instrument(backend, source: str, relative: str) -> dict:
    extracted = extract_instrument(_read_preset(backend, source, relative))
    extracted["source"] = source
    extracted["path"] = relative.replace("\\", "/").strip("/")
    return extracted


def load_inline(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise PresetError("uploaded file is not a Move preset")
    extracted = extract_instrument(payload)
    extracted["source"] = "upload"
    extracted["path"] = ""
    return extracted


def _alias_key(value: str) -> str:
    return value.strip().lower().replace("-", " ")


def _canonical_category(name: str) -> str:
    key = _alias_key(name).replace(" ", "")
    if key in SOUND_ALIASES:
        return SOUND_ALIASES[key]
    compact = name.strip()
    return compact[:1].upper() + compact[1:] if compact else ""


def _category_from_name(name: str) -> str:
    compact = name.lower().replace("-", "").replace("_", "").replace(" ", "")
    for key, label in sorted(SOUND_ALIASES.items(), key=lambda item: -len(item[0])):
        if key and key in compact:
            return label
    return ""


def _family_from_path(source: str, relative: str) -> tuple[str, str]:
    """Engine kind plus a sound category (Pianos, Guitars, …)."""
    stem = posixpath.splitext(relative.replace("\\", "/"))[0]
    if source == "factory":
        rest = stem[len(FACTORY_PRESETS) + 1 :] if stem.startswith(FACTORY_PRESETS + "/") else stem
    else:
        rest = stem
    parts = [part for part in rest.split("/") if part]
    folders = parts[:-1]
    basename = posixpath.basename(stem)
    engine = ""
    category = ""
    for folder in folders:
        alias = FOLDER_ALIASES.get(_alias_key(folder), "")
        if not alias:
            compact = folder.lower().replace(" ", "").replace("-", "")
            for name, value in FOLDER_ALIASES.items():
                if name.replace(" ", "") == compact:
                    alias = value
                    break
        if alias and not engine:
            engine = alias
            continue
        if not alias and not category:
            category = _canonical_category(folder)
    if not engine:
        blob = basename.lower().replace(" ", "").replace("-", "")
        for prefix, value in NAME_PREFIXES:
            if blob.startswith(prefix):
                engine = value
                break
    if not category:
        category = _category_from_name(basename)
    blob = basename.lower().replace(" ", "").replace("-", "")
    if not engine and (category == "Drums" or any(marker in blob for marker in ("kit", "choke", "drumrack"))):
        engine = "drumRack"
        if not category:
            category = "Drums"
    return engine, category


def _walk_instruments(backend, kind: str, root: str, source: str, found: list[dict], limit: int) -> None:
    def walk(relative: str) -> None:
        if len(found) >= limit:
            return
        try:
            entries = backend.list_dir(paths.resolve(kind, relative))
        except OSError:
            return
        for entry in sorted(entries, key=lambda item: item.name.lower()):
            if len(found) >= limit:
                return
            if entry.name.startswith("."):
                continue
            rel = paths.relative_to(kind, entry.path)
            if entry.is_dir:
                walk(rel)
                continue
            if posixpath.splitext(entry.name)[1].lower() not in PRESET_SUFFIXES:
                continue
            stem = posixpath.splitext(rel)[0]
            if kind == "factory":
                label_path = stem[len(FACTORY_PRESETS) + 1 :] if stem.startswith(FACTORY_PRESETS + "/") else stem
            else:
                label_path = stem
            family, category = _family_from_path(source, rel)
            found.append({
                "source": source,
                "path": rel,
                "name": posixpath.basename(stem),
                "label": label_path.replace("/", " / ") or posixpath.basename(stem),
                "kind": family,
                "category": category,
                "group": category or FAMILY_BY_KIND.get(family, ""),
            })

    walk(root)


def list_instruments(backend, limit: int = 500) -> list[dict]:
    """User Track Presets first, then Core Library Track Presets."""
    found: list[dict] = []
    _walk_instruments(backend, "presets", "", "presets", found, limit)
    factory_root = paths.resolve("factory", FACTORY_PRESETS)
    if backend.exists(factory_root) and backend.is_dir(factory_root):
        _walk_instruments(backend, "factory", FACTORY_PRESETS, "factory", found, limit)
    return found


def list_samples(backend, limit: int = 400) -> list[dict]:
    """User Samples and Recordings for the Sampler picker."""
    found: list[dict] = []

    def walk(section: str, relative: str = "") -> None:
        if len(found) >= limit:
            return
        try:
            entries = backend.list_dir(paths.resolve(section, relative))
        except OSError:
            return
        for entry in sorted(entries, key=lambda item: item.name.lower()):
            if len(found) >= limit:
                return
            if entry.name.startswith("."):
                continue
            rel = paths.relative_to(section, entry.path)
            if entry.is_dir:
                walk(section, rel)
                continue
            if posixpath.splitext(entry.name)[1].lower() not in paths.AUDIO_SUFFIXES:
                continue
            stem = posixpath.splitext(rel)[0]
            found.append({
                "section": section,
                "path": rel,
                "name": posixpath.basename(stem),
                "label": rel.replace("/", " / "),
                "value": f"{section}:{rel}",
            })

    walk("samples")
    walk("recordings")
    return found


def build_track_preset(name: str, instrument: dict, slot1=None, slot2=None) -> dict:
    """instrumentRack: copied instrument, then Move's two effect slots."""
    name = (name or "").strip()
    if not name:
        raise PresetError("give the preset a name")
    device = json.loads(json.dumps(_strip_schema(instrument or {})))
    if not device.get("kind") or device.get("kind") in EFFECT_KINDS:
        raise PresetError("pick an instrument")

    chain: list[dict] = [device]
    try:
        for spec in (slot1, slot2):
            fx_device = kits.slot_device(spec, "")
            if fx_device:
                chain.append(fx_device)
    except kits.EffectError as exc:
        raise PresetError(str(exc)) from exc

    return {
        "$schema": SCHEMA,
        "kind": "instrumentRack",
        "name": name,
        "lockId": LOCK_ID,
        "lockSeal": LOCK_SEAL,
        "parameters": {"Enabled": True, **{f"Macro{i}": 0.0 for i in range(8)}},
        "chains": [
            {
                "name": "",
                "color": 0,
                "devices": chain,
                "mixer": dict(EMPTY_MIXER),
            }
        ],
    }
