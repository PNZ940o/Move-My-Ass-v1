"""Build Move audio-effect racks as `.ablpreset` files.

Audio Effects live in `/data/UserData/UserLibrary/Audio Effects`. A preset is an
`audioEffectRack` whose single chain holds the chosen devices in order. Parameter
names and defaults come from factory kits and Note/Move example sets.
"""

from __future__ import annotations

import json
import posixpath

from . import paths

SCHEMA = "http://tech.ableton.com/schema/song/1.4.4/devicePreset.json"

LOCK_ID = 1001
LOCK_SEAL = -100211998
MAX_DEVICES = 8


FACTORY_EFFECTS = "Audio Effects"
PRESET_SUFFIXES = {".ablpreset", ".json"}


class EffectError(ValueError):
    pass


def _num(pid: str, label: str, default: float, lo: float, hi: float, step: float = 0.01, unit: str = "") -> dict:
    return {
        "id": pid, "label": label, "type": "number",
        "default": default, "min": lo, "max": hi, "step": step, "unit": unit,
    }


def _bool(pid: str, label: str, default: bool = True) -> dict:
    return {"id": pid, "label": label, "type": "bool", "default": default}


def _enum(pid: str, label: str, default: str, choices: list[str]) -> dict:
    return {"id": pid, "label": label, "type": "enum", "default": default, "choices": choices}


SIXTEENTHS = [str(i) for i in range(1, 17)]

CATALOG: list[dict] = [
    {
        "kind": "reverb",
        "name": "Reverb",
        "knobs": ["DecayTime", "PreDelay", "RoomSize", "MixDirect", "MixReflect", "MixDiffuse", "StereoSeparation", "FreezeOn"],
        "params": [
            _bool("Enabled", "Enabled"),
            _bool("FreezeOn", "Freeze", False),
            _num("DecayTime", "Decay", 1200.0, 20.0, 60000.0, 1, "ms"),
            _num("PreDelay", "Pre-delay", 2.5, 0.0, 250.0, 0.1, "ms"),
            _num("RoomSize", "Size", 100.0, 0.2, 500.0, 0.1),
            _enum("RoomType", "Room type", "SuperEco", ["SuperEco"]),
            _num("MixDirect", "Dry", 0.25, 0.0, 1.0, 0.01),
            _num("MixReflect", "Early reflections", 1.0, 0.0, 2.0, 0.01),
            _num("MixDiffuse", "Diffuse", 1.0, 0.0, 2.0, 0.01),
            _num("DiffuseDelay", "Diffuse delay", 0.5, 0.0, 1.0, 0.01),
            _num("StereoSeparation", "Stereo", 100.0, 0.0, 120.0, 0.1),
            _bool("ChorusOn", "Chorus"),
            _bool("SpinOn", "Spin"),
            _bool("CutOn", "Cut", False),
            _bool("FlatOn", "Flat", False),
            _enum("HighFilterType", "High filter", "Shelf", ["Shelf"]),
            _enum("SizeSmoothing", "Size smoothing", "Fast", ["Fast"]),
            _bool("ShelfLowOn", "Low shelf"),
            _num("ShelfLoFreq", "Low shelf freq", 90.0, 20.0, 2000.0, 1, "Hz"),
            _num("ShelfLoGain", "Low shelf gain", 1.0, 0.0, 2.0, 0.01),
            _bool("ShelfHighOn", "High shelf"),
            _num("ShelfHiFreq", "High shelf freq", 4500.0, 200.0, 16000.0, 1, "Hz"),
            _num("ShelfHiGain", "High shelf gain", 0.7, 0.0, 2.0, 0.01),
            _bool("BandLowOn", "Low band"),
            _bool("BandHighOn", "High band", False),
            _num("BandFreq", "Band freq", 830.0, 50.0, 16000.0, 1, "Hz"),
            _num("BandWidth", "Band width", 5.85, 0.5, 12.0, 0.01),
            _num("AllPassGain", "All-pass gain", 0.6, 0.0, 1.0, 0.01),
            _num("AllPassSize", "All-pass size", 0.4, 0.0, 1.0, 0.01),
            _num("EarlyReflectModDepth", "ER mod depth", 17.5, 0.0, 25.0, 0.01),
            _num("EarlyReflectModFreq", "ER mod freq", 0.3, 0.01, 8.0, 0.01, "Hz"),
            _num("SizeModDepth", "Size mod", 0.02, 0.0, 4.0, 0.01),
            _num("SizeModFreq", "Size mod freq", 0.02, 0.01, 8.0, 0.01, "Hz"),
        ],
    },
    {
        "kind": "delay",
        "name": "Delay",
        "knobs": ["DryWet", "Feedback", "Filter_Frequency", "Filter_Bandwidth", "DelayLine_TimeL", "DelayLine_TimeR", "Freeze", "DelayLine_PingPong"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("DryWet", "Dry/Wet", 0.35, 0.0, 1.0, 0.01),
            _enum("DryWetMode", "Mix mode", "Equal-loudness", ["Equal-loudness", "Linear"]),
            _num("Feedback", "Feedback", 0.45, 0.0, 0.95, 0.01),
            _bool("Freeze", "Freeze", False),
            _bool("DelayLine_PingPong", "Ping pong", False),
            _bool("DelayLine_Link", "Link L/R"),
            _bool("DelayLine_SyncL", "Sync L"),
            _bool("DelayLine_SyncR", "Sync R"),
            _enum("DelayLine_SyncedSixteenthL", "Time L", "3", SIXTEENTHS),
            _enum("DelayLine_SyncedSixteenthR", "Time R", "4", SIXTEENTHS),
            _num("DelayLine_TimeL", "Delay L", 0.375, 0.001, 2.0, 0.001, "s"),
            _num("DelayLine_TimeR", "Delay R", 0.375, 0.001, 2.0, 0.001, "s"),
            _num("DelayLine_SimpleDelayTimeL", "Simple time L", 100.0, 1.0, 2000.0, 1, "ms"),
            _num("DelayLine_SimpleDelayTimeR", "Simple time R", 100.0, 1.0, 2000.0, 1, "ms"),
            _num("DelayLine_OffsetL", "Offset L", 0.0, -0.5, 0.5, 0.001),
            _num("DelayLine_OffsetR", "Offset R", 0.0, -0.5, 0.5, 0.001),
            _num("DelayLine_PingPongDelayTimeL", "Ping-pong L", 1.0, 0.1, 4.0, 0.01),
            _num("DelayLine_PingPongDelayTimeR", "Ping-pong R", 1.0, 0.1, 4.0, 0.01),
            _enum("DelayLine_SmoothingMode", "Smoothing", "Repitch", ["Repitch", "Fade", "Jump"]),
            _enum("DelayLine_CompatibilityMode", "Compatibility", "D", ["D"]),
            _bool("Filter_On", "Filter"),
            _num("Filter_Frequency", "Filter freq", 1000.0, 20.0, 18000.0, 1, "Hz"),
            _num("Filter_Bandwidth", "Filter width", 8.0, 0.5, 12.0, 0.01),
            _num("Modulation_AmountTime", "Time mod", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_AmountFilter", "Filter mod", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_Frequency", "Mod rate", 0.5, 0.01, 20.0, 0.01, "Hz"),
            _bool("EcoProcessing", "Eco"),
        ],
    },
    {
        "kind": "autoFilter",
        "name": "Auto Filter",
        "knobs": ["Filter_Frequency", "Filter_Resonance", "Lfo_Amount", "Lfo_Frequency", "Envelope_Amount", "DryWet", "Filter_Drive", "Output"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("DryWet", "Dry/Wet", 0.8, 0.0, 1.0, 0.01),
            _num("Output", "Output", 0.5, 0.0, 1.0, 0.01),
            _enum("Filter_Type", "Type", "Low-pass", ["Low-pass", "High-pass", "Band-pass", "Notch", "Morph", "DJ", "Comb", "Resampling", "Notch+LP", "Vowel"]),
            _num("Filter_Frequency", "Frequency", 2000.0, 20.0, 18000.0, 1, "Hz"),
            _num("Filter_Resonance", "Resonance", 0.3, 0.0, 1.0, 0.01),
            _num("Filter_Drive", "Drive", 0.0, 0.0, 1.0, 0.01),
            _enum("Filter_Slope", "Slope", "24dB", ["12dB", "24dB"]),
            _enum("Filter_Circuit", "Circuit", "SVF", ["SVF", "DFM", "MS2", "PRD"]),
            _num("Filter_Morph", "Morph", 0.0, 0.0, 1.0, 0.01),
            _enum("Filter_MorphSlope", "Morph slope", "24dB", ["12dB", "24dB"]),
            _num("Filter_DjControl", "DJ", 0.0, -1.0, 1.0, 0.01),
            _num("Filter_VowelFormant", "Vowel", 0.0, 0.0, 1.0, 0.01),
            _num("Filter_VowelPitch", "Vowel pitch", 0, -24, 24, 1),
            _num("Lfo_Amount", "LFO amount", 0.2, 0.0, 1.0, 0.01),
            _num("Lfo_Frequency", "LFO freq", 1.0, 0.01, 30.0, 0.01, "Hz"),
            _enum("Lfo_Waveform", "LFO shape", "Sine", ["Sine", "Triangle", "Ramp Up", "Ramp Down", "Square", "Wander", "S&H"]),
            _enum("Lfo_TimeMode", "LFO time", "Rate", ["Rate", "Synced", "Sixteenth"]),
            _num("Lfo_SyncedRate", "LFO sync", 4, 1, 32, 1),
            _num("Lfo_Sixteenth", "LFO 16ths", 16, 1, 32, 1),
            _num("Lfo_Time", "LFO time", 1.0, 0.01, 8.0, 0.01, "s"),
            _num("Lfo_Phase", "LFO phase", 0.0, 0.0, 360.0, 1, "°"),
            _num("Lfo_PhaseOffset", "Phase offset", 0.0, 0.0, 360.0, 1, "°"),
            _num("Lfo_Morph", "LFO morph", 0.0, 0.0, 1.0, 0.01),
            _num("Lfo_Spin", "LFO spin", 0.0, 0.0, 1.0, 0.01),
            _enum("Lfo_StereoMode", "LFO stereo", "Phase", ["Phase", "Spin"]),
            _enum("Lfo_QuantizationMode", "LFO quantize", "None", ["None", "8th", "16th", "32nd"]),
            _num("Lfo_Steps", "LFO steps", 8, 2, 16, 1),
            _num("Lfo_Smoothing", "LFO smooth", 0.0, 0.0, 1.0, 0.01),
            _num("Lfo_SahRate", "S&H rate", -4, -12, 8, 1),
            _num("Envelope_Amount", "Env amount", 0.0, -1.0, 1.0, 0.01),
            _num("Envelope_Attack", "Env attack", 0.001, 0.0, 2.0, 0.001, "s"),
            _num("Envelope_Release", "Env release", 0.25, 0.01, 4.0, 0.01, "s"),
            _bool("Envelope_HoldOn", "Env hold"),
            _bool("Envelope_SahOn", "Env S&H", False),
            _num("Envelope_SahRate", "Env S&H rate", -4, -12, 8, 1),
            _bool("SideChainEq_On", "Sidechain EQ", False),
            _enum("SideChainEq_Mode", "Sidechain mode", "High pass", ["High pass", "Low pass", "Band pass"]),
            _num("SideChainEq_Freq", "Sidechain freq", 200.0, 20.0, 15000.0, 1, "Hz"),
            _num("SideChainEq_Gain", "Sidechain gain", 0.0, -24.0, 24.0, 0.1, "dB"),
            _num("SideChainEq_Q", "Sidechain Q", 0.707, 0.1, 4.0, 0.01),
            _bool("SideChainListen", "Sidechain listen", False),
            _bool("SideChainMono", "Sidechain mono"),
            _bool("SoftClipOn", "Soft clip", False),
            _bool("HiQuality", "Hi quality", False),
            _num("InternalSideChainGain", "Sidechain in", 1.0, 0.1, 4.0, 0.01),
        ],
    },
    {
        "kind": "chorus",
        "name": "Chorus-Ensemble",
        "knobs": ["DryWet", "Amount", "Rate", "Feedback", "Width", "Warmth", "HighpassFrequency", "HighpassEnabled"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Mode", "Mode", "Classic", ["Classic", "Vibrato"]),
            _num("DryWet", "Dry/Wet", 0.25, 0.0, 1.0, 0.01),
            _num("Amount", "Amount", 0.63, 0.0, 1.0, 0.01),
            _num("Rate", "Rate", 0.97, 0.01, 20.0, 0.01, "Hz"),
            _num("Feedback", "Feedback", 0.0, 0.0, 0.95, 0.01),
            _num("Width", "Width", 1.0, 0.0, 1.0, 0.01),
            _num("Warmth", "Warmth", 0.0, 0.0, 1.0, 0.01),
            _num("Shaping", "Shaping", 0.0, 0.0, 1.0, 0.01),
            _num("VibratoOffset", "Vibrato offset", 0.0, 0.0, 1.0, 0.01),
            _num("OutputGain", "Output", 1.0, 0.1, 4.0, 0.01),
            _bool("HighpassEnabled", "High-pass"),
            _num("HighpassFrequency", "High-pass freq", 20.0, 20.0, 2000.0, 1, "Hz"),
            _bool("InvertFeedback", "Invert feedback", False),
        ],
    },
    {
        "kind": "phaser",
        "name": "Phaser-Flanger",
        "knobs": ["DryWet", "CenterFrequency", "Feedback", "Notches", "Spread", "Modulation_Amount", "Modulation_Frequency", "Warmth"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Mode", "Mode", "Phaser", ["Phaser", "Flanger", "Doubler"]),
            _num("DryWet", "Dry/Wet", 0.5, 0.0, 1.0, 0.01),
            _num("CenterFrequency", "Frequency", 1000.0, 20.0, 18000.0, 1, "Hz"),
            _num("Feedback", "Feedback", 0.35, 0.0, 0.95, 0.01),
            _num("Notches", "Notches", 4, 1, 40, 1),
            _num("Spread", "Spread", 0.5, 0.0, 1.0, 0.01),
            _num("Warmth", "Warmth", 0.0, 0.0, 1.0, 0.01),
            _num("OutputGain", "Output", 1.0, 0.1, 4.0, 0.01),
            _num("FlangerDelayTime", "Flanger delay", 0.0025, 0.0001, 0.02, 0.0001, "s"),
            _num("DoublerDelayTime", "Doubler delay", 0.08, 0.001, 0.2, 0.001, "s"),
            _bool("InvertWet", "Invert wet", False),
            _num("Modulation_Amount", "LFO amount", 0.5, 0.0, 1.0, 0.01),
            _enum("Modulation_Waveform", "LFO shape", "Sine", ["Sine", "Triangle"]),
            _bool("Modulation_Sync", "LFO sync"),
            _num("Modulation_SyncedRate", "LFO rate", 4, 1, 16, 1),
            _num("Modulation_Frequency", "LFO freq", 0.2, 0.01, 20.0, 0.01, "Hz"),
            _bool("Modulation_Sync2", "LFO 2 sync"),
            _num("Modulation_SyncedRate2", "LFO 2 rate", 4, 1, 16, 1),
            _num("Modulation_Frequency2", "LFO 2 freq", 0.2, 0.01, 20.0, 0.01, "Hz"),
            _num("Modulation_PhaseOffset", "Phase", 0.0, 0.0, 360.0, 1, "°"),
            _num("ModulationBlend", "LFO blend", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_LfoBlend", "LFO mix", 0.0, 0.0, 1.0, 0.01),
            _bool("Modulation_SpinEnabled", "Spin", False),
            _num("Modulation_Spin", "Spin amount", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_DutyCycle", "Duty cycle", 0.0, 0.0, 1.0, 0.01),
            _bool("Modulation_EnvelopeEnabled", "Envelope", False),
            _num("Modulation_EnvelopeAmount", "Env amount", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_EnvelopeAttack", "Env attack", 0.006, 0.001, 2.0, 0.001, "s"),
            _num("Modulation_EnvelopeRelease", "Env release", 0.2, 0.01, 4.0, 0.01, "s"),
            _num("SafeBassFrequency", "Safe bass", 150.0, 20.0, 500.0, 1, "Hz"),
        ],
    },
    {
        "kind": "autoPan",
        "name": "Auto Pan",
        "knobs": ["Modulation_Amount", "Modulation_Frequency", "Modulation_Phase", "Modulation_Spin", "AttackTime", "DynamicFrequencyModulation", "PanningWaveformShape", "TremoloWaveformShape"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Mode", "Mode", "Panning", ["Panning", "Tremolo"]),
            _num("Modulation_Amount", "Amount", 0.5, 0.0, 1.0, 0.01),
            _num("Modulation_Frequency", "Rate", 1.0, 0.01, 20.0, 0.01, "Hz"),
            _num("Modulation_Phase", "Phase", 180.0, 0.0, 360.0, 1, "°"),
            _enum("Modulation_Waveform", "Shape", "Sine", ["Sine", "Triangle", "Saw Down", "Square", "Random", "Wander", "S&H"]),
            _enum("Modulation_TimeMode", "Time", "Rate", ["Rate", "Synced", "Sixteenth"]),
            _num("Modulation_SyncedRate", "Sync", 6, 1, 32, 1),
            _num("Modulation_Sixteenth", "16ths", 16, 1, 32, 1),
            _num("Modulation_Time", "Time", 1.0, 0.01, 8.0, 0.01, "s"),
            _num("Modulation_Spin", "Spin", 0.0, 0.0, 1.0, 0.01),
            _bool("Modulation_Invert", "Invert", False),
            _num("Modulation_PhaseOffset", "Phase offset", 0.0, 0.0, 360.0, 1, "°"),
            _enum("Modulation_StereoMode", "Stereo", "Phase", ["Phase", "Spin"]),
            _num("AttackTime", "Attack", 0.0, 0.0, 1.0, 0.01),
            _num("DynamicFrequencyModulation", "Rate mod", 0.0, 0.0, 1.0, 0.01),
            _bool("HarmonicMode", "Harmonic", False),
            _num("PanningWaveformShape", "Pan shape", 0.0, 0.0, 1.0, 0.01),
            _num("TremoloWaveformShape", "Tremolo shape", 0.0, 0.0, 1.0, 0.01),
            _bool("VintageMode", "Vintage", False),
        ],
    },
    {
        "kind": "autoShift",
        "name": "Auto Shift",
        "knobs": ["Global_DryWet", "PitchShift_ShiftSemitones", "PitchShift_Detune", "PitchShift_FormantShift", "Quantizer_Amount", "Lfo_RateHz", "Modulation_LfoToPitchModAmount", "Vibrato_Amount"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Global_DryWet", "Dry/Wet", 1.0, 0.0, 1.0, 0.01),
            _num("Global_InputGain", "Input", 0.0, -24.0, 24.0, 0.1, "dB"),
            _bool("Global_LiveMode", "Live mode"),
            _enum("Global_PitchRange", "Range", "Mid", ["Low", "Mid", "High"]),
            _bool("Global_UseScale", "Use scale", False),
            _num("PitchShift_ShiftSemitones", "Shift", 0, -24, 24, 1, "st"),
            _num("PitchShift_Detune", "Detune", 0.0, -100.0, 100.0, 0.1, "ct"),
            _num("PitchShift_FormantFollow", "Formant follow", 1.0, 0.0, 1.0, 0.01),
            _num("PitchShift_FormantShift", "Formant", 0.0, -1.0, 1.0, 0.01),
            _num("PitchShift_ShiftScaleDegrees", "Scale degrees", 0, -12, 12, 1),
            _bool("Quantizer_Active", "Quantize"),
            _num("Quantizer_Amount", "Snap", 0.0, 0.0, 1.0, 0.01),
            _enum("Quantizer_InternalScale", "Scale", "Custom", ["Custom", "Major", "Minor", "Dorian", "Mixolydian", "Pentatonic", "Chromatic"]),
            _enum("Quantizer_RootNote", "Root", "C", ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]),
            _bool("Quantizer_Smooth", "Smooth"),
            _num("Quantizer_SmoothingTime", "Smooth time", 0.05, 0.001, 1.0, 0.001, "s"),
            _bool("Lfo_Enabled", "LFO", False),
            _num("Lfo_RateHz", "LFO rate", 0.5, 0.01, 20.0, 0.01, "Hz"),
            _bool("Lfo_SyncOn", "LFO sync", False),
            _num("Lfo_SyncedRate", "LFO sync rate", 6, 1, 32, 1),
            _enum("Lfo_Waveform", "LFO shape", "Sine", ["Sine", "Triangle", "Saw", "Square", "Random"]),
            _bool("Lfo_OnsetRetrigger", "LFO retrigger"),
            _num("Lfo_Attack", "LFO attack", 0.0, 0.0, 2.0, 0.01, "s"),
            _num("Lfo_Delay", "LFO delay", 0.0, 0.0, 2.0, 0.01, "s"),
            _num("Modulation_LfoToPitchModAmount", "LFO pitch", 0.0, 0.0, 24.0, 0.1, "st"),
            _num("Modulation_LfoToVolumeModAmount", "LFO volume", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_LfoToPanModAmount", "LFO pan", 0.0, 0.0, 1.0, 0.01),
            _num("Modulation_LfoToFormantModAmount", "LFO formant", 0.0, 0.0, 1.0, 0.01),
            _num("Vibrato_Amount", "Vibrato", 0.0, 0.0, 1.0, 0.01),
            _num("Vibrato_Attack", "Vibrato attack", 0.0, 0.0, 2.0, 0.01, "s"),
            _num("Vibrato_RateHz", "Vibrato rate", 6.0, 0.1, 20.0, 0.01, "Hz"),
            _bool("Vibrato_Humanization", "Humanize", False),
            _bool("MidiInput_Enabled", "MIDI in", False),
            _num("MidiInput_AttackTime", "MIDI attack", 0.02, 0.0, 2.0, 0.001, "s"),
            _num("MidiInput_ReleaseTime", "MIDI release", 0.02, 0.0, 2.0, 0.001, "s"),
            _num("MidiInput_Glide", "Glide", 0.0, 0.0, 1.0, 0.01),
            _enum("MidiInput_Latch", "Latch", "Gate", ["Gate", "Latch"]),
            _enum("MidiInput_MonoPoly", "Voices", "Mono", ["Mono", "Poly"]),
            _enum("MidiInput_NumVoices", "Polyphony", "4", ["2", "4", "8"]),
            _num("MidiInput_PitchBendRange", "Bend", 6, 0, 24, 1, "st"),
        ],
    },
    {
        "kind": "erosion",
        "name": "Erosion",
        "knobs": ["Amount", "Frequency", "FilterWidth", "NoiseBlend", "StereoWidth"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("Amount", "Amount", 0.3, 0.0, 1.0, 0.01),
            _num("Frequency", "Frequency", 500.0, 20.0, 18000.0, 1, "Hz"),
            _num("FilterWidth", "Width", 1.0, 0.1, 4.0, 0.01),
            _num("NoiseBlend", "Noise / sine", 0.5, 0.0, 1.0, 0.01),
            _num("StereoWidth", "Stereo", 0.25, 0.0, 1.0, 0.01),
        ],
    },
    {
        "kind": "saturator",
        "name": "Saturator",
        "knobs": ["DryWet", "PreDrive", "PostDrive", "ColorFrequency", "ColorDepth", "ColorWidth", "ColorOn", "BassShaperThreshold"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Type", "Type", "Analog Clip", ["Analog Clip", "Soft Sine", "Medium Curve", "Hard Curve", "Bass Shaper"]),
            _num("DryWet", "Dry/Wet", 0.45, 0.0, 1.0, 0.01),
            _num("PreDrive", "Drive", 6.0, 0.0, 48.0, 0.1, "dB"),
            _num("BaseDrive", "Base drive", 0.0, -48.0, 48.0, 0.1, "dB"),
            _num("PostDrive", "Output", -3.0, -24.0, 24.0, 0.1, "dB"),
            _enum("PostClip", "Clip", "off", ["off", "on"]),
            _bool("ColorOn", "Color"),
            _num("ColorFrequency", "Color freq", 1000.0, 20.0, 8000.0, 1, "Hz"),
            _num("ColorWidth", "Color width", 0.3, 0.0, 1.0, 0.01),
            _num("ColorDepth", "Color depth", 0.0, -24.0, 24.0, 0.1),
            _num("BassShaperThreshold", "Bass threshold", -50.0, -60.0, 0.0, 0.1, "dB"),
            _bool("Oversampling", "Oversample", False),
            _bool("PreDcFilter", "DC filter", False),
            _num("WsCurve", "Waveshape curve", 0.79, 0.0, 1.0, 0.01),
            _num("WsDepth", "Waveshape depth", 0.02, 0.0, 1.0, 0.01),
            _num("WsDrive", "Waveshape drive", 1.0, 0.1, 4.0, 0.01),
            _num("WsLin", "Waveshape linear", 0.17, 0.0, 1.0, 0.01),
            _num("WsPeriod", "Waveshape period", 0.13, 0.0, 1.0, 0.01),
            _num("WsDamp", "Waveshape damp", 0.0, 0.0, 1.0, 0.01),
        ],
    },
    {
        "kind": "channelEq",
        "name": "Channel EQ",
        "knobs": ["LowShelfGain", "MidGain", "MidFrequency", "HighShelfGain", "Gain", "HighpassOn"],
        "params": [
            _bool("Enabled", "Enabled"),
            _bool("HighpassOn", "High-pass", False),
            _num("LowShelfGain", "Low", 1.0, 0.1, 8.0, 0.01),
            _num("MidGain", "Mid", 1.0, 0.1, 8.0, 0.01),
            _num("MidFrequency", "Mid freq", 1500.0, 80.0, 8000.0, 1, "Hz"),
            _num("HighShelfGain", "High", 1.0, 0.1, 8.0, 0.01),
            _num("Gain", "Output", 1.0, 0.1, 8.0, 0.01),
        ],
    },
    {
        "kind": "compressor",
        "name": "Compressor",
        "knobs": ["Threshold", "Ratio", "Attack", "Release", "Gain", "DryWet", "Knee", "SideChainEq_Freq"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Model", "Model", "RMS", ["RMS", "Peak"]),
            _num("Threshold", "Threshold", 0.5, 0.003, 1.0, 0.001),
            _num("Ratio", "Ratio", 4.0, 1.0, 20.0, 0.1),
            _num("Attack", "Attack", 1.0, 0.1, 100.0, 0.1, "ms"),
            _num("Release", "Release", 30.0, 1.0, 2000.0, 1, "ms"),
            _num("Knee", "Knee", 0.1, 0.0, 12.0, 0.01),
            _num("Gain", "Makeup", 0.0, 0.0, 36.0, 0.1, "dB"),
            _num("DryWet", "Dry/Wet", 1.0, 0.0, 1.0, 0.01),
            _bool("GainCompensation", "Auto makeup", False),
            _bool("AutoReleaseControlOnOff", "Auto release", False),
            _bool("LogEnvelope", "Log envelope"),
            _num("ExpansionRatio", "Expansion", 1.15, 1.0, 4.0, 0.01),
            _bool("SideChainEq_On", "Sidechain EQ"),
            _enum("SideChainEq_Mode", "Sidechain mode", "High pass", ["High pass"]),
            _num("SideChainEq_Freq", "Sidechain freq", 80.0, 20.0, 15000.0, 1, "Hz"),
            _num("SideChainEq_Gain", "Sidechain gain", 0.0, -24.0, 24.0, 0.1, "dB"),
            _num("SideChainEq_Q", "Sidechain Q", 0.41, 0.1, 4.0, 0.01),
        ],
    },
    {
        "kind": "limiter",
        "name": "Limiter",
        "knobs": ["Ceiling", "Gain", "Release", "LinkAmount", "Maximize", "AutoRelease"],
        "params": [
            _bool("Enabled", "Enabled"),
            _enum("Mode", "Mode", "Standard", ["Standard"]),
            _num("Ceiling", "Ceiling", -0.3, -12.0, 0.0, 0.1, "dB"),
            _num("Gain", "Gain", 0.0, 0.0, 36.0, 0.1, "dB"),
            _num("Release", "Release", 100.0, 1.0, 2000.0, 1, "ms"),
            _bool("AutoRelease", "Auto release", False),
            _enum("Lookahead", "Lookahead", "1.5 ms", ["1.5 ms"]),
            _enum("Routing", "Routing", "L/R", ["L/R"]),
            _num("LinkAmount", "Stereo link", 1.0, 0.0, 1.0, 0.01),
            _num("LinkAmountMidSide", "M/S link", 0.0, 0.0, 1.0, 0.01),
            _bool("Maximize", "Maximize", False),
            _num("MaximizeOutput", "Maximize out", 0.0, 0.0, 12.0, 0.1),
            _num("MaximizeThreshold", "Maximize thresh", 0.0, 0.0, 1.0, 0.01),
            _bool("LegacySmoothing", "Legacy smoothing"),
        ],
    },
    {
        "kind": "redux2",
        "name": "Redux",
        "knobs": ["DryWet", "BitDepth", "SampleRate", "Jitter", "QuantizerShape", "EnablePreFilter", "EnablePostFilter", "PostFilterValue"],
        "params": [
            _bool("Enabled", "Enabled"),
            _num("DryWet", "Dry/Wet", 0.7, 0.0, 1.0, 0.01),
            _num("BitDepth", "Bits", 8, 1, 16, 1),
            _num("SampleRate", "Rate", 12000.0, 250.0, 44100.0, 1, "Hz"),
            _num("Jitter", "Jitter", 0.0, 0.0, 1.0, 0.01),
            _bool("EnablePreFilter", "Pre-filter", False),
            _bool("EnablePostFilter", "Post-filter", False),
            _num("PostFilterValue", "Post-filter", 0.0, -2.0, 1.0, 0.01),
            _num("QuantizerShape", "Shape", 0.0, 0.0, 1.0, 0.01),
            _bool("QuantizerDcShift", "DC shift", False),
            _bool("EcoProcessing", "Eco"),
        ],
    },
]

BY_KIND = {item["kind"]: item for item in CATALOG}


def catalog() -> list[dict]:
    return CATALOG


def _spec_for(kind: str, pid: str) -> dict:
    item = BY_KIND.get(kind)
    if not item:
        raise EffectError(f"unknown effect: {kind}")
    for param in item["params"]:
        if param["id"] == pid:
            return param
    raise EffectError(f"unknown {item['name']} parameter: {pid}")


def _coerce(kind: str, pid: str, value):
    spec = _spec_for(kind, pid)
    if spec["type"] == "bool":
        if isinstance(value, bool):
            return value
        if value in (0, 1, "0", "1", "true", "false", "True", "False"):
            return value in (1, True, "1", "true", "True")
        raise EffectError(f"{spec['label']} must be on or off")
    if spec["type"] == "enum":
        text = str(value)
        if text not in spec["choices"]:
            raise EffectError(f"{spec['label']} must be one of {', '.join(spec['choices'])}")
        return text
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise EffectError(f"{spec['label']} must be a number") from exc
    number = max(spec["min"], min(spec["max"], number))
    if spec["step"] >= 1 and spec["min"] >= 0 and float(spec["step"]).is_integer():
        return int(round(number))
    return number


def defaults_for(kind: str) -> dict:
    item = BY_KIND.get(kind)
    if not item:
        raise EffectError(f"unknown effect: {kind}")
    return {param["id"]: param["default"] for param in item["params"]}


def parse_device(device: dict | None) -> dict | None:
    """Turn one saved device dict into editor `{kind, parameters}`, or None."""
    kind = (device or {}).get("kind")
    if kind not in BY_KIND:
        return None
    parameters = defaults_for(kind)
    for pid, raw in (device.get("parameters") or {}).items():
        if pid not in parameters:
            continue
        value, _mapping = _decode_param(raw)
        try:
            parameters[pid] = _coerce(kind, pid, value)
        except EffectError:
            continue
    return {"kind": kind, "parameters": parameters}


def _macro_position(value, lo: float, hi: float) -> float:
    if isinstance(value, bool):
        value = 1.0 if value else 0.0
    span = hi - lo
    if abs(span) < 1e-12:
        return 0.0
    return max(0.0, min(127.0, (float(value) - lo) / span * 127.0))


def _encode_param(value, mapping: dict | None):
    if not mapping:
        return value
    return {
        "value": value,
        "macroMapping": {
            "macroIndex": mapping["index"],
            "rangeMin": mapping["min"],
            "rangeMax": mapping["max"],
        },
    }


def _normalise_macros(devices: list[dict], macros: list[dict] | None) -> list[dict]:
    """Validate up to 8 Move knobs and attach them to device parameters."""
    slots: list[dict | None] = [None] * 8
    seen: set[tuple[int, str]] = set()
    for entry in macros or []:
        if not entry:
            continue
        param = str(entry.get("param") or "").strip()
        if not param:
            continue
        try:
            index = int(entry.get("index", -1))
        except (TypeError, ValueError) as exc:
            raise EffectError("macro index must be 0–7") from exc
        if index < 0 or index > 7:
            raise EffectError("macro index must be 0–7")
        try:
            device_index = int(entry.get("device", 0))
        except (TypeError, ValueError) as exc:
            raise EffectError("macro device must be a chain index") from exc
        if device_index < 0 or device_index >= len(devices):
            raise EffectError(f"macro {index + 1} points at a missing effect")
        kind = devices[device_index]["kind"]
        spec = _spec_for(kind, param)
        if spec["type"] == "enum":
            raise EffectError(f"{spec['label']} is a menu — map a knob or switch instead")
        key = (device_index, param)
        if key in seen:
            raise EffectError(f"{spec['label']} is already mapped to a macro")
        seen.add(key)
        if spec["type"] == "bool":
            lo, hi = 0.0, 1.0
        else:
            lo = spec["min"] if entry.get("min") is None else float(entry["min"])
            hi = spec["max"] if entry.get("max") is None else float(entry["max"])
        name = str(entry.get("name") or spec["label"]).strip() or spec["label"]
        slots[index] = {
            "index": index,
            "device": device_index,
            "param": param,
            "name": name[:24],
            "min": lo,
            "max": hi,
            "spec": spec,
        }
    return slots


def build_device(kind: str, parameters: dict | None = None, mappings: dict | None = None) -> dict:
    item = BY_KIND.get(kind)
    if not item:
        raise EffectError(f"unknown effect: {kind}")
    merged = defaults_for(kind)
    for key, value in (parameters or {}).items():
        merged[key] = _coerce(kind, key, value)
    encoded = {key: _encode_param(value, (mappings or {}).get(key)) for key, value in merged.items()}
    return {
        "presetUri": None,
        "kind": kind,
        "name": item["name"],
        "parameters": encoded,
        "deviceData": {},
    }


def build_preset(name: str, devices: list[dict], macros: list[dict] | None = None) -> dict:
    """Assemble an audioEffectRack from an ordered list of `{kind, parameters}`.

    `macros` maps up to 8 Move knobs onto device parameters the hardware
    otherwise hides. Each entry is `{index, name, device, param, min, max}`.
    """
    name = (name or "").strip()
    if not name:
        raise EffectError("give the effect a name")
    if not devices:
        raise EffectError("add at least one effect")
    if len(devices) > MAX_DEVICES:
        raise EffectError(f"a rack can hold {MAX_DEVICES} effects")

    prepared = []
    for entry in devices:
        kind = (entry or {}).get("kind", "")
        if kind not in BY_KIND:
            raise EffectError(f"unknown effect: {kind}")
        prepared.append({"kind": kind, "parameters": (entry or {}).get("parameters") or {}})

    slots = _normalise_macros(prepared, macros)
    per_device: list[dict] = [{} for _ in prepared]
    rack_macros: dict = {}
    for index, slot in enumerate(slots):
        key = f"Macro{index}"
        if not slot:
            rack_macros[key] = 0.0
            continue
        values = {
            **defaults_for(prepared[slot["device"]]["kind"]),
            **prepared[slot["device"]]["parameters"],
        }
        current = _coerce(prepared[slot["device"]]["kind"], slot["param"], values.get(slot["param"], slot["spec"]["default"]))
        rack_macros[key] = {
            "value": _macro_position(current, slot["min"], slot["max"]),
            "customName": slot["name"],
        }
        per_device[slot["device"]][slot["param"]] = {
            "index": slot["index"],
            "min": slot["min"],
            "max": slot["max"],
        }

    built = [
        build_device(entry["kind"], entry["parameters"], per_device[i])
        for i, entry in enumerate(prepared)
    ]

    return {
        "$schema": SCHEMA,
        "kind": "audioEffectRack",
        "name": name,
        "lockId": LOCK_ID,
        "lockSeal": LOCK_SEAL,
        "parameters": {"Enabled": True, **rack_macros},
        "chains": [
            {
                "name": "",
                "color": 0,
                "devices": built,
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


def dest_path(folder: str, name: str) -> str:
    relative = posixpath.join((folder or "").strip("/"), f"{name}.ablpreset")
    return relative.lstrip("/")


def _decode_param(raw):
    if isinstance(raw, dict) and "value" in raw:
        mapping = raw.get("macroMapping")
        return raw["value"], mapping if isinstance(mapping, dict) else None
    return raw, None


def parse_preset(data: bytes) -> dict:
    """Turn a saved `.ablpreset` back into editor `{name, devices, macros}`."""
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EffectError("effect preset is not readable") from exc

    if not isinstance(payload, dict) or not payload.get("kind"):
        raise EffectError("this file is not a Move effect")

    skipped: list[str] = []
    raw_devices: list[dict] = []
    kind = payload.get("kind")
    if kind in BY_KIND:
        raw_devices = [payload]
    elif kind == "audioEffectRack":
        chains = payload.get("chains") or []
        if not chains:
            raise EffectError("this rack has no devices")
        for chain in chains:
            for device in chain.get("devices") or []:
                device_kind = (device or {}).get("kind")
                if device_kind in BY_KIND:
                    raw_devices.append(device)
                elif device_kind:
                    skipped.append(str(device_kind))
    else:
        raise EffectError("this preset is not an audio effect")

    truncated = len(raw_devices) > MAX_DEVICES
    raw_devices = raw_devices[:MAX_DEVICES]
    if not raw_devices:
        raise EffectError("this preset has no editable effects")

    devices = []
    macros: list[dict] = []
    seen_macros: set[int] = set()
    for index, device in enumerate(raw_devices):
        device_kind = device["kind"]
        parameters = defaults_for(device_kind)
        for pid, raw in (device.get("parameters") or {}).items():
            if pid not in parameters:
                continue
            value, mapping = _decode_param(raw)
            try:
                parameters[pid] = _coerce(device_kind, pid, value)
            except EffectError:
                continue
            if not mapping:
                continue
            try:
                macro_index = int(mapping.get("macroIndex", -1))
            except (TypeError, ValueError):
                continue
            if macro_index < 0 or macro_index > 7 or macro_index in seen_macros:
                continue
            spec = _spec_for(device_kind, pid)
            if spec["type"] == "enum":
                continue
            seen_macros.add(macro_index)
            lo = mapping.get("rangeMin")
            hi = mapping.get("rangeMax")
            try:
                lo = spec["min"] if lo is None else float(lo)
                hi = spec["max"] if hi is None else float(hi)
            except (TypeError, ValueError):
                lo, hi = spec["min"], spec["max"]
            if spec["type"] == "bool":
                lo, hi = 0.0, 1.0
            macros.append({
                "index": macro_index,
                "name": spec["label"],
                "device": index,
                "param": pid,
                "min": lo,
                "max": hi,
            })
        devices.append({"kind": device_kind, "parameters": parameters})

    rack_params = payload.get("parameters") or {} if kind == "audioEffectRack" else {}
    for slot in macros:
        named = rack_params.get(f"Macro{slot['index']}")
        if isinstance(named, dict) and named.get("customName"):
            slot["name"] = str(named["customName"]).strip()[:24] or slot["name"]

    name = str(payload.get("name") or "").strip()
    return {
        "name": name,
        "devices": devices,
        "macros": sorted(macros, key=lambda item: item["index"]),
        "skipped": skipped,
        "truncated": truncated,
    }


def _kind_from_folder(folder: str) -> str:
    key = folder.strip().lower().replace("-", " ")
    compact = key.replace(" ", "")
    for item in CATALOG:
        names = {
            item["kind"].lower(),
            item["name"].lower().replace("-", " "),
            item["kind"].lower().replace(" ", ""),
            item["name"].lower().replace(" ", "").replace("-", ""),
        }
        if key in names or compact in names:
            return item["kind"]
    return ""


def _kind_from_text(text: str) -> str:
    kind = _kind_from_folder(text)
    if kind:
        return kind
    compact = text.lower().replace("-", "").replace("_", "").replace(" ", "")
    for item in sorted(CATALOG, key=lambda entry: -len(entry["name"])):
        tokens = (
            item["kind"].lower().replace(" ", ""),
            item["name"].lower().replace("-", "").replace(" ", ""),
        )
        for token in tokens:
            if len(token) >= 3 and token in compact:
                return item["kind"]
    return ""


def _kind_from_path(relative: str) -> str:
    stem = posixpath.splitext(relative.replace("\\", "/"))[0]
    parts = [part for part in stem.split("/") if part]
    if parts and parts[0] == FACTORY_EFFECTS:
        parts = parts[1:]
    folder = parts[0] if len(parts) > 1 else ""
    return _kind_from_text(folder) if folder else _kind_from_text(posixpath.basename(stem))


def _unwrap_effect(payload: dict) -> dict:
    device = {key: value for key, value in payload.items() if key != "$schema"}
    if device.get("kind") != "audioEffectRack":
        return device
    chains = device.get("chains") or []
    inner = list((chains[0].get("devices") or []) if chains else [])
    if len(inner) == 1 and inner[0].get("kind"):
        return inner[0]
    return device


def devices_from_upload(payload: dict) -> list[dict]:
    """Turn an uploaded effect file into one or two slot devices."""
    if not isinstance(payload, dict) or not payload.get("kind"):
        raise EffectError("this file is not a Move effect")
    kind = payload.get("kind")
    if kind == "instrumentRack":
        raise EffectError("that file is an instrument — use Upload instrument")

    def clean(device: dict) -> dict:
        copy = json.loads(json.dumps(_unwrap_effect(device)))
        copy["presetUri"] = None
        fx_kind = copy.get("kind")
        if fx_kind not in BY_KIND:
            raise EffectError("this preset is not an audio effect")
        if not copy.get("name"):
            copy["name"] = BY_KIND[fx_kind]["name"]
        return copy

    if kind in BY_KIND:
        return [clean(payload)]
    if kind != "audioEffectRack":
        raise EffectError("this preset is not an audio effect")
    found: list[dict] = []
    for chain in payload.get("chains") or []:
        for device in chain.get("devices") or []:
            device_kind = (device or {}).get("kind")
            if device_kind in BY_KIND:
                found.append(clean(device))
            if len(found) >= 2:
                return found
    if not found:
        raise EffectError("this rack has no effects")
    return found


def read_device(backend, source: str, relative: str) -> dict:
    """Load a user or Core Library effect as a slot device."""
    source = (source or "effects").strip().lower()
    relative = (relative or "").replace("\\", "/").strip("/")
    if not relative or ".." in relative.split("/"):
        raise EffectError("invalid effect preset")
    if source == "factory":
        if relative != FACTORY_EFFECTS and not relative.startswith(FACTORY_EFFECTS + "/"):
            raise EffectError("core effects live in Audio Effects")
        absolute = paths.resolve("factory", relative)
    else:
        absolute = paths.resolve("effects", relative)
    if not backend.exists(absolute) or backend.is_dir(absolute):
        raise EffectError("effect preset not found")
    try:
        payload = json.loads(backend.read_file(absolute).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EffectError("effect preset is not readable") from exc
    if not isinstance(payload, dict) or not payload.get("kind"):
        raise EffectError("this file is not a Move effect")
    device = _unwrap_effect(payload)
    if source != "factory":
        from . import kits
        device["presetUri"] = kits.effect_uri(relative)
    else:
        device["presetUri"] = None
    if not device.get("name"):
        device["name"] = posixpath.splitext(posixpath.basename(relative))[0]
    return device


def _walk_presets(backend, kind: str, root: str, source: str, found: list[dict], limit: int) -> None:
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
                label_path = stem[len(FACTORY_EFFECTS) + 1 :] if stem.startswith(FACTORY_EFFECTS + "/") else stem
            else:
                label_path = stem
            fx_kind = _kind_from_path(rel)
            found.append({
                "source": source,
                "path": rel,
                "name": posixpath.basename(stem),
                "label": label_path.replace("/", " / ") or posixpath.basename(stem),
                "kind": fx_kind,
                "group": BY_KIND[fx_kind]["name"] if fx_kind in BY_KIND else (label_path.split("/")[0] if "/" in label_path else "Other"),
            })

    walk(root)


def list_presets(backend, limit: int = 400) -> list[dict]:
    """User Audio Effects first, then Core Library Audio Effects."""
    found: list[dict] = []
    _walk_presets(backend, "effects", "", "effects", found, limit)
    factory_root = paths.resolve("factory", FACTORY_EFFECTS)
    if backend.exists(factory_root) and backend.is_dir(factory_root):
        _walk_presets(backend, "factory", FACTORY_EFFECTS, "factory", found, limit)
    return found
