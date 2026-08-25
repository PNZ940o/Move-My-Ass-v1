"""Build Move track presets: an instrument plus stacked effects and macros.

User presets live in `/data/UserData/UserLibrary/Track Presets`. Core Library
instruments (`.json` under `/data/CoreLibrary/Track Presets`) can be copied in
inline so the saved rack does not depend on editing factory files.
"""

from __future__ import annotations

import json
import posixpath

from . import effects, instruments, paths

SCHEMA = effects.SCHEMA
LOCK_ID = effects.LOCK_ID
LOCK_SEAL = -973461132
MAX_FX = effects.MAX_DEVICES
FACTORY_PRESETS = "Track Presets"
PRESET_SUFFIXES = {".ablpreset", ".json"}

EFFECT_KINDS = set(effects.BY_KIND) | {"audioEffectRack"}
INSTRUMENT_KINDS = {
    "drift",
    "wavetable",
    "drumRack",
    "melodicSampler",
    "instrumentRack",
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
    """Split a track preset into one instrument device plus editable effects."""
    payload = _strip_schema(payload)
    kind = payload.get("kind")
    if not kind:
        raise PresetError("this file is not a Move preset")
    if kind in EFFECT_KINDS:
        raise PresetError("that's an audio effect — pick an instrument")

    if kind != "instrumentRack":
        synth = instruments.parse_synth(payload)
        return {
            "name": str(payload.get("name") or synth["kind"] or kind),
            "kind": synth["kind"] or kind,
            "device": payload,
            "parameters": synth["parameters"],
            "effects": [],
            "macros": synth["macros"],
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
    catalog_fx = [item for item in expanded_fx if (item or {}).get("kind") in effects.BY_KIND]
    parsed_fx: list[dict] = []
    synth = instruments.parse_synth(device)
    macros: list[dict] = list(synth["macros"])
    seen = {slot["index"] for slot in macros}
    if catalog_fx:
        fake = {
            "kind": "audioEffectRack",
            "name": payload.get("name") or "fx",
            "parameters": payload.get("parameters") if kind == "instrumentRack" else {},
            "chains": [{"devices": catalog_fx}],
        }
        parsed = effects.parse_preset(json.dumps(fake).encode())
        parsed_fx = parsed["devices"]
        for slot in parsed["macros"]:
            index = slot["index"]
            if index in seen:
                continue
            seen.add(index)
            macros.append({**slot, "device": slot["device"] + 1})

    rack_params = payload.get("parameters") or {} if kind == "instrumentRack" else {}
    for slot in macros:
        named = rack_params.get(f"Macro{slot['index']}")
        if isinstance(named, dict) and named.get("customName"):
            slot["name"] = str(named["customName"]).strip()[:24] or slot["name"]

    return {
        "name": str(payload.get("name") or device.get("name") or synth["kind"] or device.get("kind") or "Instrument"),
        "kind": synth["kind"] or device.get("kind") or "instrument",
        "device": device,
        "parameters": synth["parameters"],
        "effects": parsed_fx,
        "macros": sorted(macros, key=lambda item: item["index"]),
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
            found.append({
                "source": source,
                "path": rel,
                "name": posixpath.basename(stem),
                "label": label_path.replace("/", " / ") or posixpath.basename(stem),
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


def _macro_name(macros: list[dict] | None, index: int, fallback: str) -> str:
    for entry in macros or []:
        try:
            if int(entry.get("index", -1)) != index:
                continue
        except (TypeError, ValueError):
            continue
        text = str(entry.get("name") or "").strip()
        if text:
            return text[:24]
    return fallback


def build_track_preset(
    name: str,
    instrument: dict,
    devices: list[dict],
    macros: list[dict] | None = None,
    instrument_parameters: dict | None = None,
) -> dict:
    """instrumentRack: copied instrument, stacked FX, macros on instrument (0) then FX (1+)."""
    name = (name or "").strip()
    if not name:
        raise PresetError("give the preset a name")
    device = json.loads(json.dumps(_strip_schema(instrument or {})))
    if not device.get("kind") or device.get("kind") in EFFECT_KINDS:
        raise PresetError("pick an instrument")
    if len(devices) > MAX_FX:
        raise PresetError(f"a rack can hold {MAX_FX} effects")

    synth = instruments.inner_synth(device)
    kind = (synth or {}).get("kind") or ""
    mappings = instruments.slot_mappings(macros, kind)
    instruments.apply_synth(device, instrument_parameters, mappings)

    rack_macros: dict = {f"Macro{i}": 0.0 for i in range(8)}
    occupied: set[int] = set()
    merged = {**instruments.defaults_for(kind), **(instrument_parameters or {})}
    for pid, mapping in mappings.items():
        spec = instruments._spec_for(kind, pid)
        if not spec:
            continue
        current = instruments._coerce(kind, pid, merged.get(pid, spec["default"]))
        index = mapping["index"]
        rack_macros[f"Macro{index}"] = {
            "value": effects._macro_position(current, mapping["min"], mapping["max"]),
            "customName": _macro_name(macros, index, spec["label"]),
        }
        occupied.add(index)

    fx_macros: list[dict] = []
    for entry in macros or []:
        try:
            device_index = int(entry.get("device", -1))
        except (TypeError, ValueError) as exc:
            raise PresetError("macro device must be a chain index") from exc
        if device_index < 1:
            continue
        fx_macros.append({**entry, "device": device_index - 1})

    built_fx: list[dict] = []
    if devices:
        try:
            fx_rack = effects.build_preset(name, devices, fx_macros)
        except effects.EffectError as exc:
            raise PresetError(str(exc)) from exc
        built_fx = list((fx_rack.get("chains") or [{}])[0].get("devices") or [])
        params = fx_rack.get("parameters") or {}
        for i in range(8):
            if i in occupied:
                continue
            rack_macros[f"Macro{i}"] = params.get(f"Macro{i}", 0.0)
    elif fx_macros:
        raise PresetError("macro points at a missing effect")

    return {
        "$schema": SCHEMA,
        "kind": "instrumentRack",
        "name": name,
        "lockId": LOCK_ID,
        "lockSeal": LOCK_SEAL,
        "parameters": {"Enabled": True, **rack_macros},
        "chains": [
            {
                "name": "",
                "color": 0,
                "devices": [device, *built_fx],
                "mixer": dict(EMPTY_MIXER),
            }
        ],
    }
