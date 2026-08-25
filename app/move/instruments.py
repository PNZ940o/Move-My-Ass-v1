"""Editable controls for Move instruments in the Make preset window.

Parameter names and ranges follow the extending-move device schemas. Macros
attach the same way as in Make effect: `macroMapping` on the synth parameter,
plus named Macro0–7 on the outer instrument rack.
"""

from __future__ import annotations

from . import effects

SYNTH_KINDS = {"drift", "wavetable", "melodicSampler", "drumRack"}


def _num(pid, label, default, lo, hi, step=0.01, unit=""):
    return effects._num(pid, label, default, lo, hi, step, unit)


def _bool(pid, label, default=True):
    return effects._bool(pid, label, default)


def _enum(pid, label, default, choices):
    return effects._enum(pid, label, default, choices)


CATALOG: list[dict] = [
    {
        "kind": "drift",
        "name": "Drift",
        "knobs": [
            "Filter_Frequency", "Filter_Resonance", "Envelope1_Attack", "Envelope1_Decay",
            "Envelope1_Sustain", "Envelope1_Release", "Oscillator1_Shape", "Lfo_Amount",
        ],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Global_Volume", "Volume", 0.4, 0.0, 1.0, 0.01),
            _num("Filter_Frequency", "Cutoff", 2000.0, 20.0, 20000.0, 1, "Hz"),
            _num("Filter_Resonance", "Resonance", 0.2, 0.0, 1.0, 0.01),
            _enum("Filter_Type", "Filter", "II", ["I", "II"]),
            _num("Filter_HiPassFrequency", "High-pass", 10.0, 10.0, 20480.0, 1, "Hz"),
            _num("Envelope1_Attack", "Env1 attack", 0.001, 0.0, 20.0, 0.001, "s"),
            _num("Envelope1_Decay", "Env1 decay", 0.6, 0.005, 20.0, 0.001, "s"),
            _num("Envelope1_Sustain", "Env1 sustain", 0.5, 0.0, 1.0, 0.01),
            _num("Envelope1_Release", "Env1 release", 0.3, 0.01, 20.0, 0.001, "s"),
            _num("Envelope2_Attack", "Env2 attack", 0.001, 0.0, 20.0, 0.001, "s"),
            _num("Envelope2_Decay", "Env2 decay", 0.3, 0.005, 20.0, 0.001, "s"),
            _num("Envelope2_Sustain", "Env2 sustain", 0.0, 0.0, 1.0, 0.01),
            _num("Envelope2_Release", "Env2 release", 0.3, 0.01, 20.0, 0.001, "s"),
            _enum("Oscillator1_Type", "Osc 1", "Saw", ["Sine", "Triangle", "Shark Tooth", "Saturated", "Saw", "Pulse", "Rectangle"]),
            _num("Oscillator1_Shape", "Osc 1 shape", 0.0, 0.0, 1.0, 0.01),
            _num("Oscillator1_ShapeMod", "Osc 1 shape mod", 0.0, -1.0, 1.0, 0.01),
            _num("Oscillator1_Transpose", "Osc 1 oct", 0, -2, 3, 1, "oct"),
            _enum("Oscillator2_Type", "Osc 2", "Saw", ["Sine", "Triangle", "Saturated", "Saw", "Rectangle"]),
            _num("Oscillator2_Detune", "Osc 2 detune", 0.0, -7.0, 7.0, 0.01),
            _num("Oscillator2_Transpose", "Osc 2 trans", 0, -3, 2, 1, "st"),
            _bool("Mixer_OscillatorOn1", "Osc 1 on"),
            _bool("Mixer_OscillatorOn2", "Osc 2 on"),
            _num("Mixer_OscillatorGain1", "Osc 1 level", 0.8, 0.0, 1.0, 0.01),
            _num("Mixer_OscillatorGain2", "Osc 2 level", 0.0, 0.0, 1.0, 0.01),
            _bool("Mixer_NoiseOn", "Noise", False),
            _num("Mixer_NoiseLevel", "Noise level", 0.0, 0.0, 1.0, 0.01),
            _num("Lfo_Amount", "LFO amount", 0.0, 0.0, 1.0, 0.01),
            _num("Lfo_Rate", "LFO rate", 5.0, 0.17, 1700.0, 0.01, "Hz"),
            _num("Lfo_Time", "LFO time", 1.0, 0.1, 60.0, 0.01, "s"),
            _bool("Lfo_Retrigger", "LFO retrigger"),
            _num("Global_Glide", "Glide", 0.0, 0.0, 2.0, 0.01, "s"),
            _num("Global_Transpose", "Transpose", 0, -24, 24, 1, "st"),
            _num("Global_DriftDepth", "Drift", 0.25, 0.0, 1.0, 0.01),
            _num("Global_UnisonVoiceDepth", "Unison", 0.0, 0.0, 1.0, 0.01),
            _num("Filter_ModAmount1", "Filter mod 1", 0.0, -1.0, 1.0, 0.01),
            _num("Filter_ModAmount2", "Filter mod 2", 0.0, -1.0, 1.0, 0.01),
            _num("PitchModulation_Amount1", "Pitch mod 1", 0.0, -1.0, 1.0, 0.01),
            _num("PitchModulation_Amount2", "Pitch mod 2", 0.0, -1.0, 1.0, 0.01),
        ],
    },
    {
        "kind": "wavetable",
        "name": "Wavetable",
        "knobs": [
            "Voice_Filter1_Frequency", "Voice_Filter1_Resonance",
            "Voice_Modulators_AmpEnvelope_Times_Attack", "Voice_Modulators_AmpEnvelope_Times_Decay",
            "Voice_Modulators_AmpEnvelope_Sustain", "Voice_Modulators_AmpEnvelope_Times_Release",
            "Voice_Oscillator1_Wavetables_WavePosition", "Volume",
        ],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Volume", "Volume", 0.4, 0.0, 1.0, 0.01),
            _bool("Voice_Filter1_On", "Filter 1"),
            _num("Voice_Filter1_Frequency", "Cutoff", 2000.0, 20.0, 20000.0, 1, "Hz"),
            _num("Voice_Filter1_Resonance", "Resonance", 0.2, 0.0, 1.0, 0.01),
            _num("Voice_Filter1_Drive", "Drive", 0.0, 0.0, 24.0, 0.1, "dB"),
            _enum("Voice_Filter1_Type", "Filter type", "Lowpass", ["Bandpass", "Highpass", "Lowpass", "Morph", "Notch"]),
            _num("Voice_Modulators_AmpEnvelope_Times_Attack", "Attack", 0.01, 0.0, 20.0, 0.001, "s"),
            _num("Voice_Modulators_AmpEnvelope_Times_Decay", "Decay", 0.3, 0.0, 20.0, 0.001, "s"),
            _num("Voice_Modulators_AmpEnvelope_Sustain", "Sustain", 0.7, 0.0, 1.0, 0.01),
            _num("Voice_Modulators_AmpEnvelope_Times_Release", "Release", 0.3, 0.0, 20.0, 0.001, "s"),
            _bool("Voice_Oscillator1_On", "Osc 1"),
            _num("Voice_Oscillator1_Gain", "Osc 1 level", 0.8, 0.0, 1.0, 0.01),
            _num("Voice_Oscillator1_Wavetables_WavePosition", "Osc 1 position", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Oscillator1_Pitch_Transpose", "Osc 1 trans", 0, -24, 24, 1, "st"),
            _num("Voice_Oscillator1_Pitch_Detune", "Osc 1 detune", 0.0, -100.0, 100.0, 0.1, "ct"),
            _bool("Voice_Oscillator2_On", "Osc 2", False),
            _num("Voice_Oscillator2_Gain", "Osc 2 level", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Oscillator2_Wavetables_WavePosition", "Osc 2 position", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Oscillator2_Pitch_Transpose", "Osc 2 trans", 0, -24, 24, 1, "st"),
            _bool("Voice_SubOscillator_On", "Sub", False),
            _num("Voice_SubOscillator_Gain", "Sub level", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Unison_Amount", "Unison", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Global_Glide", "Glide", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_Global_Transpose", "Transpose", 0, -24, 24, 1, "st"),
            _num("Voice_Modulators_Lfo1_Time_Rate", "LFO 1 rate", 1.0, 0.01, 30.0, 0.01, "Hz"),
            _num("Voice_Modulators_Lfo1_Shape_Amount", "LFO 1 amount", 0.0, 0.0, 1.0, 0.01),
        ],
    },
    {
        "kind": "melodicSampler",
        "name": "Sampler",
        "knobs": [
            "Voice_Filter_Frequency", "Voice_Filter_Resonance",
            "Voice_AmplitudeEnvelope_Attack", "Voice_AmplitudeEnvelope_Decay",
            "Voice_AmplitudeEnvelope_Sustain", "Voice_AmplitudeEnvelope_Release",
            "Voice_Transpose", "Volume",
        ],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Volume", "Volume", 0.4, 0.0, 1.0, 0.01),
            _num("Voice_Gain", "Gain", 0.8, 0.0, 1.0, 0.01),
            _bool("Voice_Filter_On", "Filter"),
            _num("Voice_Filter_Frequency", "Cutoff", 2000.0, 30.0, 22000.0, 1, "Hz"),
            _num("Voice_Filter_Resonance", "Resonance", 0.0, 0.0, 90.0, 0.1),
            _num("Voice_AmplitudeEnvelope_Attack", "Attack", 0.005, 0.0001, 20.0, 0.001, "s"),
            _num("Voice_AmplitudeEnvelope_Decay", "Decay", 0.3, 0.001, 20.0, 0.001, "s"),
            _num("Voice_AmplitudeEnvelope_Sustain", "Sustain", 0.8, 0.0, 1.0, 0.01),
            _num("Voice_AmplitudeEnvelope_Release", "Release", 0.2, 0.001, 60.0, 0.001, "s"),
            _bool("Voice_FilterEnvelope_On", "Filter env", False),
            _num("Voice_FilterEnvelope_Attack", "F-env attack", 0.01, 0.0001, 20.0, 0.001, "s"),
            _num("Voice_FilterEnvelope_Decay", "F-env decay", 0.2, 0.001, 20.0, 0.001, "s"),
            _num("Voice_FilterEnvelope_Sustain", "F-env sustain", 0.0, 0.0, 1.0, 0.01),
            _num("Voice_FilterEnvelope_Release", "F-env release", 0.2, 0.001, 20.0, 0.001, "s"),
            _num("Voice_Transpose", "Transpose", 0, -48, 48, 1, "st"),
            _num("Voice_Detune", "Detune", 0.0, -100.0, 100.0, 0.1, "ct"),
            _num("Voice_PlaybackStart", "Start", 0.0, 0.0, 1.0, 0.001),
            _num("Voice_PlaybackLength", "Length", 1.0, 0.0, 1.0, 0.001),
            _bool("Voice_Lfo_On", "LFO", False),
            _num("Voice_Lfo_Rate", "LFO rate", 1.0, 0.01, 30.0, 0.01, "Hz"),
            _num("Voice_VelocityToVolume", "Vel → vol", 0.5, 0.0, 1.0, 0.01),
        ],
    },
    {
        "kind": "drumRack",
        "name": "Drum Rack",
        "knobs": ["Volume", "Voice_Filter_Frequency", "Voice_Envelope_Decay", "Voice_Gain", "Voice_Transpose"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Volume", "Volume", 0.8, 0.0, 1.0, 0.01),
            _num("Voice_Gain", "Pad gain", 0.8, 0.0, 1.0, 0.01),
            _bool("Voice_Filter_On", "Filter", False),
            _num("Voice_Filter_Frequency", "Cutoff", 8000.0, 20.0, 20000.0, 1, "Hz"),
            _num("Voice_Filter_Resonance", "Resonance", 0.2, 0.0, 1.0, 0.01),
            _num("Voice_Envelope_Attack", "Attack", 0.001, 0.0, 2.0, 0.001, "s"),
            _num("Voice_Envelope_Decay", "Decay", 0.2, 0.001, 8.0, 0.001, "s"),
            _num("Voice_Envelope_Hold", "Hold", 0.0, 0.0, 2.0, 0.001, "s"),
            _num("Voice_Transpose", "Transpose", 0, -24, 24, 1, "st"),
            _num("Voice_PlaybackStart", "Start", 0.0, 0.0, 1.0, 0.001),
            _num("Voice_PlaybackLength", "Length", 1.0, 0.0, 1.0, 0.001),
            _num("Voice_VelocityToVolume", "Vel → vol", 0.5, 0.0, 1.0, 0.01),
        ],
    },
]

BY_KIND = {item["kind"]: item for item in CATALOG}


def catalog() -> list[dict]:
    return CATALOG


def inner_synth(device: dict | None) -> dict | None:
    """Walk nested instrument racks down to drift / wavetable / sampler / drums."""
    if not isinstance(device, dict):
        return None
    kind = device.get("kind")
    if kind in SYNTH_KINDS:
        return device
    if kind == "instrumentRack":
        for chain in device.get("chains") or []:
            for child in chain.get("devices") or []:
                found = inner_synth(child)
                if found:
                    return found
    return None


def defaults_for(kind: str) -> dict:
    item = BY_KIND.get(kind)
    if not item:
        return {"Enabled": True}
    return {param["id"]: param["default"] for param in item["params"]}


def _spec_for(kind: str, pid: str) -> dict | None:
    item = BY_KIND.get(kind)
    if not item:
        return None
    for param in item["params"]:
        if param["id"] == pid:
            return param
    return None


def _coerce(kind: str, pid: str, value):
    spec = _spec_for(kind, pid)
    if not spec:
        return value
    if spec["type"] == "bool":
        if isinstance(value, bool):
            return value
        if value in (0, 1, "0", "1", "true", "false", "True", "False"):
            return value in (1, True, "1", "true", "True")
        return spec["default"]
    if spec["type"] == "enum":
        text = str(value)
        return text if text in spec["choices"] else spec["default"]
    try:
        number = float(value)
    except (TypeError, ValueError):
        return spec["default"]
    number = max(spec["min"], min(spec["max"], number))
    if spec["step"] >= 1 and spec["min"] >= 0 and float(spec["step"]).is_integer():
        return int(round(number))
    return number


def parse_synth(device: dict | None) -> dict:
    """Return `{kind, parameters, macros}` for the inner synth, or empty."""
    synth = inner_synth(device)
    if not synth:
        return {"kind": (device or {}).get("kind") or "", "parameters": {}, "macros": []}
    kind = synth.get("kind") or ""
    catalogued = kind in BY_KIND
    parameters = defaults_for(kind) if catalogued else {}
    macros: list[dict] = []
    seen: set[int] = set()
    for pid, raw in (synth.get("parameters") or {}).items():
        if pid.startswith("Macro"):
            continue
        value, mapping = effects._decode_param(raw)
        spec = _spec_for(kind, pid)
        if spec:
            parameters[pid] = _coerce(kind, pid, value)
        elif not catalogued:
            parameters[pid] = value
        if not mapping or not spec or spec["type"] == "enum":
            continue
        try:
            index = int(mapping.get("macroIndex", -1))
        except (TypeError, ValueError):
            continue
        if index < 0 or index > 7 or index in seen:
            continue
        seen.add(index)
        if spec["type"] == "bool":
            lo, hi = 0.0, 1.0
        else:
            lo = mapping.get("rangeMin")
            hi = mapping.get("rangeMax")
            try:
                lo = spec["min"] if lo is None else float(lo)
                hi = spec["max"] if hi is None else float(hi)
            except (TypeError, ValueError):
                lo, hi = spec["min"], spec["max"]
        macros.append({
            "index": index,
            "name": spec["label"],
            "device": 0,
            "param": pid,
            "min": lo,
            "max": hi,
        })
    return {"kind": kind, "parameters": parameters, "macros": macros}


def apply_synth(device: dict, parameters: dict | None, mappings: dict | None) -> dict:
    """Write editor values (and optional macro maps) onto the inner synth."""
    synth = inner_synth(device)
    if not synth:
        return device
    kind = synth.get("kind") or ""
    params = dict(synth.get("parameters") or {})
    if kind in BY_KIND:
        merged = defaults_for(kind)
        merged.update(parameters or {})
        for pid, value in merged.items():
            spec = _spec_for(kind, pid)
            if not spec:
                continue
            coerced = _coerce(kind, pid, value)
            params[pid] = effects._encode_param(coerced, (mappings or {}).get(pid))
    else:
        for pid, value in (parameters or {}).items():
            if pid.startswith("Macro"):
                continue
            params[pid] = effects._encode_param(value, (mappings or {}).get(pid))
    synth["parameters"] = params
    return device


def slot_mappings(macros: list[dict] | None, kind: str) -> dict:
    """`param -> {index, min, max}` for instrument (device 0) mappings."""
    found: dict[str, dict] = {}
    for entry in macros or []:
        try:
            if int(entry.get("device", -1)) != 0:
                continue
            index = int(entry.get("index", -1))
        except (TypeError, ValueError):
            continue
        if index < 0 or index > 7:
            continue
        param = str(entry.get("param") or "")
        spec = _spec_for(kind, param)
        if not spec or spec["type"] == "enum":
            continue
        if spec["type"] == "bool":
            lo, hi = 0.0, 1.0
        else:
            lo = spec["min"] if entry.get("min") is None else float(entry["min"])
            hi = spec["max"] if entry.get("max") is None else float(entry["max"])
        found[param] = {"index": index, "min": lo, "max": hi}
    return found
