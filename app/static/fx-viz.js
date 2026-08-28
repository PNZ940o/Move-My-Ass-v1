/* Ableton-inspired live plots for the Make effect window.
   Curves follow the same jobs as Live's device displays (EQ response,
   waveshaper, compressor transfer, delay band-pass, phaser notches, etc.). */

(() => {
  const FMIN = 20;
  const FMAX = 20000;
  const SR = 44100;
  const CYAN = "#2285f0";
  const PINK = "#ff8e0c";
  const AMBER = "#ffba73";
  const VIOLET = "#7d57e5";
  const TEXT = "#f4eaf0";
  const DIM = "rgba(208, 188, 199, 0.55)";
  const GRID = "rgba(244, 234, 240, 0.08)";
  const FILL = "rgba(34, 133, 240, 0.18)";

  const FILTER_PARAMS = {
    drift: { freq: "Filter_Frequency", res: "Filter_Resonance", type: "Filter_Type" },
    wavetable: { freq: "Voice_Filter1_Frequency", res: "Voice_Filter1_Resonance", type: "Voice_Filter1_Type", enable: "Voice_Filter1_On" },
    melodicSampler: { freq: "Voice_Filter_Frequency", res: "Voice_Filter_Resonance", enable: "Voice_Filter_On", resMax: 90 },
    drumRack: { freq: "Voice_Filter_Frequency", res: "Voice_Filter_Resonance", enable: "Voice_Filter_On" },
  };

  /* Live Device View: named panels + the plot that belongs with each one. */
  const SECTIONS = {
    drift: [
      { id: "osc", name: "Oscillators", open: true, viz: "osc", caption: "Osc mix — drag shape and shape mod", params: ["Oscillator1_Type", "Oscillator1_Shape", "Oscillator1_ShapeMod", "Oscillator1_Transpose", "Oscillator2_Type", "Oscillator2_Detune", "Oscillator2_Transpose", "Mixer_OscillatorOn1", "Mixer_OscillatorOn2", "Mixer_OscillatorGain1", "Mixer_OscillatorGain2", "Mixer_NoiseOn", "Mixer_NoiseLevel", "PitchModulation_Amount1", "PitchModulation_Amount2"] },
      { id: "filter", name: "Filter", viz: "filter", caption: "Filter — drag cutoff and resonance", params: ["Filter_Type", "Filter_Frequency", "Filter_Resonance", "Filter_HiPassFrequency", "Filter_ModAmount1", "Filter_ModAmount2"] },
      { id: "env", name: "Envelopes", plots: [
        { viz: "adsr", map: "driftEnv1", caption: "Env 1 · Amp" },
        { viz: "adsr", map: "driftEnv2", caption: "Env 2 · Mod" },
      ], params: ["Envelope1_Attack", "Envelope1_Decay", "Envelope1_Sustain", "Envelope1_Release", "Envelope2_Attack", "Envelope2_Decay", "Envelope2_Sustain", "Envelope2_Release"] },
      { id: "lfo", name: "LFO", viz: "lfo", map: "driftLfo", caption: "LFO — drag rate and amount", params: ["Lfo_Amount", "Lfo_Rate", "Lfo_Time", "Lfo_Retrigger"] },
      { id: "global", name: "Global", params: ["Global_Volume", "Global_Glide", "Global_Transpose", "Global_DriftDepth", "Global_UnisonVoiceDepth"] },
    ],
    wavetable: [
      { id: "osc", name: "Oscillators", open: true, plots: [
        { viz: "wt", map: "wtOsc1", caption: "Osc 1" },
        { viz: "wt", map: "wtOsc2", caption: "Osc 2" },
      ], params: ["Voice_Oscillator1_On", "Voice_Oscillator1_Gain", "Voice_Oscillator1_Wavetables_WavePosition", "Voice_Oscillator1_Pitch_Transpose", "Voice_Oscillator1_Pitch_Detune", "Voice_Oscillator2_On", "Voice_Oscillator2_Gain", "Voice_Oscillator2_Wavetables_WavePosition", "Voice_Oscillator2_Pitch_Transpose", "Voice_SubOscillator_On", "Voice_SubOscillator_Gain"] },
      { id: "filter", name: "Filter", viz: "filter", caption: "Filter — drag cutoff and resonance", params: ["Voice_Filter1_On", "Voice_Filter1_Type", "Voice_Filter1_Frequency", "Voice_Filter1_Resonance", "Voice_Filter1_Drive"] },
      { id: "env", name: "Amp envelope", viz: "adsr", map: "wavetableAmp", caption: "Amp envelope — drag the stages", params: ["Voice_Modulators_AmpEnvelope_Times_Attack", "Voice_Modulators_AmpEnvelope_Times_Decay", "Voice_Modulators_AmpEnvelope_Sustain", "Voice_Modulators_AmpEnvelope_Times_Release"] },
      { id: "lfo", name: "LFO 1", viz: "lfo", map: "wavetableLfo", caption: "LFO — drag rate and amount", params: ["Voice_Modulators_Lfo1_Time_Rate", "Voice_Modulators_Lfo1_Shape_Amount"] },
      { id: "global", name: "Global", params: ["Volume", "Voice_Unison_Amount", "Voice_Global_Glide", "Voice_Global_Transpose"] },
    ],
    melodicSampler: [
      { id: "sample", name: "Sample", open: true, viz: "sample", caption: "Start and length — drag the region", params: ["Volume", "Voice_Gain", "Voice_PlaybackStart", "Voice_PlaybackLength", "Voice_Transpose", "Voice_Detune", "Voice_VelocityToVolume"] },
      { id: "filter", name: "Filter", viz: "filter", caption: "Filter — drag cutoff and resonance", params: ["Voice_Filter_On", "Voice_Filter_Frequency", "Voice_Filter_Resonance"] },
      { id: "env", name: "Amp envelope", viz: "adsr", map: "samplerAmp", caption: "Amp envelope — drag the stages", params: ["Voice_AmplitudeEnvelope_Attack", "Voice_AmplitudeEnvelope_Decay", "Voice_AmplitudeEnvelope_Sustain", "Voice_AmplitudeEnvelope_Release"] },
      { id: "fenv", name: "Filter envelope", viz: "adsr", map: "samplerFilter", caption: "Filter envelope — drag the stages", params: ["Voice_FilterEnvelope_On", "Voice_FilterEnvelope_Attack", "Voice_FilterEnvelope_Decay", "Voice_FilterEnvelope_Sustain", "Voice_FilterEnvelope_Release"] },
      { id: "lfo", name: "LFO", viz: "lfo", map: "samplerLfo", caption: "LFO — drag rate", params: ["Voice_Lfo_On", "Voice_Lfo_Rate"] },
    ],
    drumRack: [
      { id: "sample", name: "Sample", open: true, plots: [
        { viz: "sample", caption: "Sample" },
        { viz: "ahd", map: "drumAhd", caption: "AHD" },
      ], params: ["Voice_Gain", "Voice_PlaybackStart", "Voice_PlaybackLength", "Voice_Envelope_Attack", "Voice_Envelope_Hold", "Voice_Envelope_Decay", "Voice_Transpose"] },
      { id: "filter", name: "Filter", viz: "filter", caption: "Filter — drag cutoff and resonance", params: ["Voice_Filter_On", "Voice_Filter_Frequency", "Voice_Filter_Resonance"] },
      { id: "global", name: "Global", params: ["Volume", "Voice_VelocityToVolume"] },
    ],
    reverb: [
      { id: "display", name: "Reverb", open: true, viz: "device", interactive: false, caption: "Early reflections + decay", params: ["FreezeOn", "DecayTime", "PreDelay", "RoomSize"] },
      { id: "mix", name: "Mix", viz: null, params: ["MixDirect", "MixReflect", "MixDiffuse", "DiffuseDelay", "StereoSeparation"] },
      { id: "character", name: "Character", viz: null, params: ["ChorusOn", "SpinOn", "CutOn", "FlatOn"] },
      { id: "eq", name: "EQ", viz: "reverbEq", caption: "Reverb EQ — drag the shelves", span: 2, params: ["ShelfLowOn", "ShelfLoFreq", "ShelfLoGain", "ShelfHighOn", "ShelfHiFreq", "ShelfHiGain", "BandLowOn", "BandHighOn", "BandFreq", "BandWidth"] },
      { id: "mod", name: "Modulation", viz: null, params: ["AllPassGain", "AllPassSize", "EarlyReflectModDepth", "EarlyReflectModFreq", "SizeModDepth", "SizeModFreq"] },
    ],
    delay: [
      { id: "mix", name: "Delay", viz: "taps", interactive: false, caption: "Delay taps", span: 2, params: ["DryWet", "Feedback", "Freeze", "DelayLine_PingPong", "DryWetMode"] },
      { id: "time", name: "Time", viz: null, params: ["DelayLine_Link", "DelayLine_SyncL", "DelayLine_SyncR", "DelayLine_SyncedSixteenthL", "DelayLine_SyncedSixteenthR", "DelayLine_TimeL", "DelayLine_TimeR", "DelayLine_SimpleDelayTimeL", "DelayLine_SimpleDelayTimeR", "DelayLine_OffsetL", "DelayLine_OffsetR", "DelayLine_PingPongDelayTimeL", "DelayLine_PingPongDelayTimeR"] },
      { id: "filter", name: "Filter", viz: "delayFilter", caption: "Filter — drag frequency and width", params: ["Filter_On", "Filter_Frequency", "Filter_Bandwidth"] },
      { id: "mod", name: "Modulation", viz: null, params: ["Modulation_AmountTime", "Modulation_AmountFilter", "Modulation_Frequency", "DelayLine_SmoothingMode", "EcoProcessing"] },
    ],
    autoFilter: [
      { id: "filter", name: "Filter", viz: "device", caption: "Filter — drag cutoff and resonance", span: 2, params: ["DryWet", "Output", "Filter_Type", "Filter_Frequency", "Filter_Resonance", "Filter_Drive", "Filter_Slope", "Filter_Circuit", "Filter_Morph", "Filter_MorphSlope", "Filter_DjControl", "Filter_VowelFormant", "Filter_VowelPitch"] },
      { id: "lfo", name: "LFO", viz: "lfo", map: "autoFilterLfo", caption: "LFO — drag rate and amount", params: ["Lfo_Amount", "Lfo_Frequency", "Lfo_Waveform", "Lfo_TimeMode", "Lfo_SyncedRate", "Lfo_Phase", "Lfo_Morph", "Lfo_Spin"] },
      { id: "lfo2", name: "LFO shape", viz: null, params: ["Lfo_Sixteenth", "Lfo_Time", "Lfo_PhaseOffset", "Lfo_StereoMode", "Lfo_QuantizationMode", "Lfo_Steps", "Lfo_Smoothing", "Lfo_SahRate"] },
      { id: "env", name: "Envelope", viz: "ar", map: "autoFilterEnv", caption: "Envelope — drag attack and release", params: ["Envelope_Amount", "Envelope_Attack", "Envelope_Release", "Envelope_HoldOn", "Envelope_SahOn", "Envelope_SahRate"] },
      { id: "side", name: "Sidechain", viz: null, params: ["SideChainEq_On", "SideChainEq_Mode", "SideChainEq_Freq", "SideChainEq_Gain", "SideChainEq_Q", "SideChainListen", "SideChainMono", "InternalSideChainGain", "SoftClipOn", "HiQuality"] },
    ],
    chorus: [
      { id: "display", name: "Chorus-Ensemble", viz: "device", interactive: false, caption: "Delay-line modulation", span: 2, params: ["Mode", "DryWet", "Amount", "Rate", "Feedback", "Width"] },
      { id: "tone", name: "Tone", viz: null, params: ["Warmth", "Shaping", "VibratoOffset", "OutputGain", "HighpassEnabled", "HighpassFrequency", "InvertFeedback"] },
    ],
    phaser: [
      { id: "display", name: "Phaser-Flanger", viz: "device", caption: "Notches — drag to set frequency", span: 2, params: ["Mode", "DryWet", "CenterFrequency", "Feedback", "Notches", "Spread"] },
      { id: "lfo", name: "LFO", viz: "lfo", map: "phaserLfo", caption: "LFO — drag rate and amount", params: ["Modulation_Amount", "Modulation_Waveform", "Modulation_Frequency", "Modulation_Sync", "Modulation_SyncedRate", "Modulation_PhaseOffset", "ModulationBlend", "Modulation_SpinEnabled", "Modulation_Spin"] },
      { id: "lfo2", name: "LFO 2", viz: null, params: ["Modulation_Frequency2", "Modulation_Sync2", "Modulation_SyncedRate2", "Modulation_LfoBlend", "Modulation_DutyCycle"] },
      { id: "env", name: "Envelope", viz: "ar", map: "phaserEnv", caption: "Envelope — drag attack and release", params: ["Modulation_EnvelopeEnabled", "Modulation_EnvelopeAmount", "Modulation_EnvelopeAttack", "Modulation_EnvelopeRelease"] },
      { id: "tone", name: "Tone", viz: null, params: ["Warmth", "OutputGain", "FlangerDelayTime", "DoublerDelayTime", "InvertWet", "SafeBassFrequency"] },
    ],
    autoPan: [
      { id: "display", name: "Auto Pan", viz: "device", caption: "L / R — drag rate and amount", span: 2, params: ["Mode", "Modulation_Amount", "Modulation_Frequency", "Modulation_Phase", "Modulation_Waveform"] },
      { id: "time", name: "Time · Shape", viz: null, params: ["Modulation_TimeMode", "Modulation_SyncedRate", "Modulation_Sixteenth", "Modulation_Time", "Modulation_Spin", "Modulation_Invert", "Modulation_PhaseOffset", "Modulation_StereoMode", "AttackTime", "DynamicFrequencyModulation", "PanningWaveformShape", "TremoloWaveformShape", "VintageMode", "HarmonicMode"] },
    ],
    autoShift: [
      { id: "pitch", name: "Pitch", viz: "device", caption: "Pitch — drag semitones and formant", span: 2, params: ["Global_DryWet", "PitchShift_ShiftSemitones", "PitchShift_Detune", "PitchShift_FormantShift", "PitchShift_FormantFollow", "PitchShift_ShiftScaleDegrees"] },
      { id: "quantize", name: "Quantize", viz: null, params: ["Quantizer_Active", "Quantizer_Amount", "Quantizer_InternalScale", "Quantizer_RootNote", "Quantizer_Smooth", "Quantizer_SmoothingTime", "Global_UseScale"] },
      { id: "lfo", name: "LFO", viz: "lfo", map: "autoShiftLfo", caption: "LFO — drag rate and pitch amount", params: ["Lfo_Enabled", "Lfo_RateHz", "Lfo_SyncOn", "Lfo_SyncedRate", "Lfo_Waveform", "Lfo_OnsetRetrigger", "Lfo_Attack", "Lfo_Delay", "Modulation_LfoToPitchModAmount", "Modulation_LfoToVolumeModAmount", "Modulation_LfoToPanModAmount", "Modulation_LfoToFormantModAmount"] },
      { id: "vibrato", name: "Vibrato", viz: null, params: ["Vibrato_Amount", "Vibrato_RateHz", "Vibrato_Attack", "Vibrato_Humanization"] },
      { id: "midi", name: "MIDI", viz: null, params: ["MidiInput_Enabled", "MidiInput_AttackTime", "MidiInput_ReleaseTime", "MidiInput_Glide", "MidiInput_Latch", "MidiInput_MonoPoly", "MidiInput_NumVoices", "MidiInput_PitchBendRange"] },
      { id: "global", name: "Global", viz: null, params: ["Global_InputGain", "Global_LiveMode", "Global_PitchRange"] },
    ],
    erosion: [
      { id: "display", name: "Erosion", viz: "device", caption: "Noise band — drag frequency and amount", span: 2, params: ["Amount", "Frequency", "FilterWidth", "NoiseBlend", "StereoWidth"] },
    ],
    saturator: [
      { id: "display", name: "Saturator", viz: "device", interactive: false, caption: "Waveshaper curve", span: 2, params: ["Type", "DryWet", "PreDrive", "PostDrive", "PostClip", "BaseDrive"] },
      { id: "color", name: "Color", viz: "satColor", caption: "Color EQ — drag frequency and depth", params: ["ColorOn", "ColorFrequency", "ColorWidth", "ColorDepth", "BassShaperThreshold"] },
      { id: "shape", name: "Waveshape", viz: null, params: ["WsCurve", "WsDepth", "WsDrive", "WsLin", "WsPeriod", "WsDamp", "Oversampling", "PreDcFilter"] },
    ],
    channelEq: [
      { id: "display", name: "Channel EQ", viz: "device", caption: "EQ curve — drag the handles", wide: true, params: ["HighpassOn", "LowShelfGain", "MidGain", "MidFrequency", "HighShelfGain", "Gain"] },
    ],
    compressor: [
      { id: "display", name: "Compressor", viz: "device", caption: "Transfer — drag threshold and ratio", span: 2, params: ["Model", "Threshold", "Ratio", "Knee"] },
      { id: "time", name: "Time · Mix", viz: null, params: ["Attack", "Release", "Gain", "DryWet", "GainCompensation", "AutoReleaseControlOnOff", "LogEnvelope"] },
      { id: "side", name: "Sidechain", viz: null, params: ["SideChainEq_On", "SideChainEq_Freq", "SideChainEq_Gain", "SideChainEq_Q", "ExpansionRatio"] },
    ],
    limiter: [
      { id: "display", name: "Limiter", viz: "device", caption: "Ceiling — drag to set it", span: 2, params: ["Ceiling", "Gain", "Release", "AutoRelease", "Lookahead", "LinkAmount"] },
      { id: "max", name: "Maximize", viz: null, params: ["Maximize", "MaximizeOutput", "MaximizeThreshold", "LinkAmountMidSide", "LegacySmoothing"] },
    ],
    redux2: [
      { id: "display", name: "Redux", viz: "device", interactive: false, caption: "Downsample + bit reduction", span: 2, params: ["DryWet", "BitDepth", "SampleRate", "Jitter", "QuantizerShape"] },
      { id: "filter", name: "Filters", viz: null, params: ["EnablePreFilter", "EnablePostFilter", "PostFilterValue", "QuantizerDcShift", "EcoProcessing"] },
    ],
  };

  const ADSR = {
    driftEnv1: { a: "Envelope1_Attack", d: "Envelope1_Decay", s: "Envelope1_Sustain", r: "Envelope1_Release", aMax: 20, dMax: 20, rMax: 20 },
    driftEnv2: { a: "Envelope2_Attack", d: "Envelope2_Decay", s: "Envelope2_Sustain", r: "Envelope2_Release", aMax: 20, dMax: 20, rMax: 20 },
    wavetableAmp: { a: "Voice_Modulators_AmpEnvelope_Times_Attack", d: "Voice_Modulators_AmpEnvelope_Times_Decay", s: "Voice_Modulators_AmpEnvelope_Sustain", r: "Voice_Modulators_AmpEnvelope_Times_Release", aMax: 20, dMax: 20, rMax: 20 },
    samplerAmp: { a: "Voice_AmplitudeEnvelope_Attack", d: "Voice_AmplitudeEnvelope_Decay", s: "Voice_AmplitudeEnvelope_Sustain", r: "Voice_AmplitudeEnvelope_Release", aMax: 20, dMax: 20, rMax: 60 },
    samplerFilter: { a: "Voice_FilterEnvelope_Attack", d: "Voice_FilterEnvelope_Decay", s: "Voice_FilterEnvelope_Sustain", r: "Voice_FilterEnvelope_Release", aMax: 20, dMax: 20, rMax: 20 },
  };

  const AHD = {
    drumAhd: { a: "Voice_Envelope_Attack", h: "Voice_Envelope_Hold", d: "Voice_Envelope_Decay", aMax: 2, hMax: 2, dMax: 8 },
  };

  const LFO = {
    driftLfo: { amount: "Lfo_Amount", rate: "Lfo_Rate", rateMax: 40, amountMax: 1 },
    wavetableLfo: { amount: "Voice_Modulators_Lfo1_Shape_Amount", rate: "Voice_Modulators_Lfo1_Time_Rate", rateMax: 30, amountMax: 1 },
    samplerLfo: { amount: "Voice_Lfo_On", rate: "Voice_Lfo_Rate", rateMax: 30, amountMax: 1, enable: "Voice_Lfo_On", amountIsBool: true },
    autoFilterLfo: { amount: "Lfo_Amount", rate: "Lfo_Frequency", rateMax: 30, amountMax: 1, wave: "Lfo_Waveform" },
    phaserLfo: { amount: "Modulation_Amount", rate: "Modulation_Frequency", rateMax: 20, amountMax: 1, wave: "Modulation_Waveform" },
    autoShiftLfo: { amount: "Modulation_LfoToPitchModAmount", rate: "Lfo_RateHz", rateMax: 20, amountMax: 24, wave: "Lfo_Waveform", enable: "Lfo_Enabled" },
  };

  const WT = {
    wtOsc1: { pos: "Voice_Oscillator1_Wavetables_WavePosition", gain: "Voice_Oscillator1_Gain", on: "Voice_Oscillator1_On", detune: "Voice_Oscillator1_Pitch_Detune" },
    wtOsc2: { pos: "Voice_Oscillator2_Wavetables_WavePosition", gain: "Voice_Oscillator2_Gain", on: "Voice_Oscillator2_On" },
  };

  const AR = {
    autoFilterEnv: { a: "Envelope_Attack", r: "Envelope_Release", aMax: 2, rMax: 4, amount: "Envelope_Amount" },
    phaserEnv: { a: "Modulation_EnvelopeAttack", r: "Modulation_EnvelopeRelease", aMax: 2, rMax: 4, amount: "Modulation_EnvelopeAmount", enable: "Modulation_EnvelopeEnabled" },
  };

  function p(item, id, fallback) {
    const value = item.parameters[id];
    return value === undefined || value === null ? fallback : value;
  }

  function db(gain) {
    return 20 * Math.log10(Math.max(1e-8, gain));
  }

  function fromDb(value) {
    return 10 ** (value / 20);
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function logx(freq) {
    return Math.log(clamp(freq, FMIN, FMAX) / FMIN) / Math.log(FMAX / FMIN);
  }

  function freqAt(t) {
    return FMIN * (FMAX / FMIN) ** clamp(t, 0, 1);
  }

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth || 320);
    const h = Math.max(1, canvas.clientHeight || 168);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function magBiquad(b0, b1, b2, a0, a1, a2, freq) {
    const w = 2 * Math.PI * freq / SR;
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nRe = b0 + b1 * c1 + b2 * c2;
    const nIm = -(b1 * s1 + b2 * s2);
    const dRe = a0 + a1 * c1 + a2 * c2;
    const dIm = -(a1 * s1 + a2 * s2);
    const den = dRe * dRe + dIm * dIm;
    if (den < 1e-18) return 0;
    const re = (nRe * dRe + nIm * dIm) / den;
    const im = (nIm * dRe - nRe * dIm) / den;
    return Math.hypot(re, im);
  }

  function rbjLowShelf(f0, dBgain, Q = 0.72) {
    const A = 10 ** (dBgain / 40);
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = A * ((A + 1) - (A - 1) * cos + 2 * Math.sqrt(A) * alpha);
    const b1 = 2 * A * ((A - 1) - (A + 1) * cos);
    const b2 = A * ((A + 1) - (A - 1) * cos - 2 * Math.sqrt(A) * alpha);
    const a0 = (A + 1) + (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    const a1 = -2 * ((A - 1) + (A + 1) * cos);
    const a2 = (A + 1) + (A - 1) * cos - 2 * Math.sqrt(A) * alpha;
    return [b0, b1, b2, a0, a1, a2];
  }

  function rbjHighShelf(f0, dBgain, Q = 0.72) {
    const A = 10 ** (dBgain / 40);
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = A * ((A + 1) + (A - 1) * cos + 2 * Math.sqrt(A) * alpha);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    const b2 = A * ((A + 1) + (A - 1) * cos - 2 * Math.sqrt(A) * alpha);
    const a0 = (A + 1) - (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    const a1 = 2 * ((A - 1) - (A + 1) * cos);
    const a2 = (A + 1) - (A - 1) * cos - 2 * Math.sqrt(A) * alpha;
    return [b0, b1, b2, a0, a1, a2];
  }

  function rbjPeak(f0, dBgain, Q) {
    const A = 10 ** (dBgain / 40);
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = 1 + alpha * A;
    const b1 = -2 * cos;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cos;
    const a2 = 1 - alpha / A;
    return [b0, b1, b2, a0, a1, a2];
  }

  function rbjHighPass(f0, Q = 0.707) {
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = (1 + cos) / 2;
    const b1 = -(1 + cos);
    const b2 = (1 + cos) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    return [b0, b1, b2, a0, a1, a2];
  }

  function rbjLowPass(f0, Q = 0.707) {
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = (1 - cos) / 2;
    const b1 = 1 - cos;
    const b2 = (1 - cos) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    return [b0, b1, b2, a0, a1, a2];
  }

  function rbjBandPass(f0, bwOct) {
    const w0 = 2 * Math.PI * f0 / SR;
    const sin = Math.sin(w0);
    const alpha = sin * Math.sinh((Math.log(2) / 2) * Math.max(0.15, bwOct) * w0 / Math.max(1e-6, sin));
    const cos = Math.cos(w0);
    return [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
  }

  function rbjNotch(f0, Q) {
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * Math.max(0.2, Q));
    const cos = Math.cos(w0);
    return [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha];
  }

  function cascadeDb(filters, freq) {
    let mag = 1;
    for (const coef of filters) mag *= magBiquad(...coef, freq);
    return db(mag);
  }

  function yDb(h, value, lo, hi, pad = 10) {
    const t = (value - lo) / (hi - lo);
    return pad + (h - pad * 2) * (1 - t);
  }

  function freqGrid(ctx, w, h, y0, y1) {
    ctx.save();
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = logx(f) * w;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function labels(ctx, w, h, items) {
    ctx.save();
    ctx.fillStyle = DIM;
    ctx.font = "10px ui-monospace, Consolas, monospace";
    for (const item of items) ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  }

  function strokePath(ctx, points, color, fill) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (fill) {
      ctx.lineTo(points[points.length - 1].x, fill);
      ctx.lineTo(points[0].x, fill);
      ctx.closePath();
      ctx.fillStyle = color.replace(")", ", 0.16)").replace("rgb", "rgba").replace("#2285f0", "rgba(34,133,240,0.16)").replace("#ff8e0c", "rgba(255,142,12,0.14)").replace("#ffba73", "rgba(255,186,115,0.16)").replace("#7d57e5", "rgba(125,87,229,0.16)");
      if (color === CYAN) ctx.fillStyle = FILL;
      else if (color === PINK) ctx.fillStyle = "rgba(255,142,12,0.14)";
      else if (color === AMBER) ctx.fillStyle = "rgba(255,186,115,0.16)";
      else ctx.fillStyle = "rgba(125,87,229,0.14)";
      ctx.fill();
    }
  }

  function handle(ctx, x, y, color) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#111";
    ctx.stroke();
  }

  function channelEqDb(item, freq) {
    const lowDb = db(p(item, "LowShelfGain", 1));
    const midDb = db(p(item, "MidGain", 1));
    const highDb = db(p(item, "HighShelfGain", 1));
    const outDb = db(p(item, "Gain", 1));
    const midF = p(item, "MidFrequency", 1500);
    const filters = [
      rbjLowShelf(100, lowDb, 0.6 + Math.min(1.4, Math.abs(lowDb) / 12)),
      rbjPeak(midF, midDb, 0.85),
      rbjHighShelf(8000, highDb, 0.7),
    ];
    if (p(item, "HighpassOn", false)) filters.unshift(rbjHighPass(80, 0.7));
    if (highDb < -0.2) {
      const lp = lerp(20000, 8000, clamp(-highDb / 15, 0, 1));
      filters.push(rbjLowPass(lp, 0.7));
    }
    return cascadeDb(filters, freq) + outDb;
  }

  function drawChannelEq(ctx, w, h, item) {
    const lo = -18;
    const hi = 18;
    freqGrid(ctx, w, h, 0, h);
    const zero = yDb(h, 0, lo, hi);
    ctx.strokeStyle = "rgba(244,234,240,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, zero);
    ctx.lineTo(w, zero);
    ctx.stroke();

    const n = Math.max(80, Math.floor(w));
    const all = [];
    const spec = [];
    const midF = p(item, "MidFrequency", 1500);
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      const eq = channelEqDb(item, f);
      const noise = -14 - 2.4 * Math.log10(f / 20) + 2.2 * Math.sin(Math.log(f) * 4.1) + 1.4 * Math.sin(f / 180);
      all.push({ x: (i / n) * w, y: yDb(h, eq, lo, hi) });
      spec.push({ x: (i / n) * w, y: yDb(h, noise + eq * 0.35, lo, hi) });
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const pt of spec) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(244,234,240,0.07)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, zero);
    for (const pt of all) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, zero);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(255,186,115,0.42)");
    grad.addColorStop(clamp(logx(220), 0, 1), "rgba(255,186,115,0.28)");
    grad.addColorStop(clamp(logx(midF), 0, 1), "rgba(34,133,240,0.38)");
    grad.addColorStop(clamp(logx(4500), 0, 1), "rgba(255,142,12,0.28)");
    grad.addColorStop(1, "rgba(255,142,12,0.42)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(all[0].x, all[0].y);
    for (const pt of all) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const lowX = logx(100) * w;
    const midX = logx(midF) * w;
    const highX = logx(8000) * w;
    handle(ctx, lowX, yDb(h, db(p(item, "LowShelfGain", 1)), lo, hi), AMBER);
    handle(ctx, midX, yDb(h, db(p(item, "MidGain", 1)), lo, hi), CYAN);
    handle(ctx, highX, yDb(h, db(p(item, "HighShelfGain", 1)), lo, hi), PINK);
    if (p(item, "HighpassOn", false)) {
      ctx.fillStyle = AMBER;
      ctx.fillRect(logx(80) * w - 1, 8, 2, h - 16);
    }
    labels(ctx, w, h, [
      { text: "20", x: 4, y: h - 6 },
      { text: "1k", x: logx(1000) * w - 6, y: h - 6 },
      { text: "20k", x: w - 22, y: h - 6 },
      { text: "+18", x: 4, y: 12 },
      { text: "0 dB", x: 4, y: zero - 4 },
    ]);
  }

  function analogClip(x) {
    const a = 0.62;
    const ax = Math.abs(x);
    if (ax <= a) return x;
    const s = Math.sign(x);
    const u = ax - a;
    return s * (a + (1 - a) * (u / (1 + u * 1.8)));
  }

  function shapeSaturator(item, x) {
    const drive = fromDb(p(item, "PreDrive", 6) + p(item, "BaseDrive", 0));
    const out = fromDb(p(item, "PostDrive", -3));
    const type = p(item, "Type", "Analog Clip");
    let y;
    const d = x * drive;
    if (type === "Soft Sine") y = Math.sin(clamp(d, -1.2, 1.2) * Math.PI / 2);
    else if (type === "Medium Curve") y = Math.tanh(d);
    else if (type === "Hard Curve") y = Math.tanh(d * 2.4);
    else if (type === "Bass Shaper") {
      const th = fromDb(p(item, "BassShaperThreshold", -50));
      const ax = Math.abs(d);
      if (ax < th) y = d;
      else y = Math.sign(d) * (th + analogClip(ax - th));
    } else y = analogClip(d);
    if (p(item, "PostClip", "off") === "on") y = analogClip(y);
    y *= out;
    return y;
  }

  function drawSaturator(ctx, w, h, item) {
    const pad = 12;
    const span = 1.6;
    const x0 = pad;
    const y0 = pad;
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    ctx.strokeStyle = GRID;
    ctx.strokeRect(x0, y0, iw, ih);
    const pts = [];
    for (let i = 0; i <= 180; i++) {
      const x = lerp(-span, span, i / 180);
      const y = shapeSaturator(item, x);
      pts.push({
        x: x0 + ((x + span) / (2 * span)) * iw,
        y: y0 + (1 - (y + span) / (2 * span)) * ih,
      });
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + ih);
    ctx.lineTo(x0 + iw, y0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.stroke();
    labels(ctx, w, h, [
      { text: "in", x: w / 2 - 6, y: h - 4 },
      { text: "out", x: 4, y: 12 },
      { text: p(item, "Type", "Analog Clip"), x: 8, y: h - 6 },
    ]);
  }

  function compressDb(inDb, threshDb, ratio, knee) {
    const half = Math.max(0, knee) / 2;
    const delta = inDb - threshDb;
    if (delta <= -half) return inDb;
    if (half > 0 && delta < half) {
      const over = delta + half;
      return inDb + (1 / ratio - 1) * over * over / (2 * knee);
    }
    return threshDb + delta / ratio;
  }

  function drawCompressor(ctx, w, h, item) {
    const lo = -48;
    const hi = 6;
    const threshDb = db(p(item, "Threshold", 0.5));
    const ratio = p(item, "Ratio", 4);
    const knee = p(item, "Knee", 0.1);
    const makeup = p(item, "Gain", 0);
    const mix = p(item, "DryWet", 1);
    ctx.strokeStyle = GRID;
    for (let d = -48; d <= 0; d += 12) {
      const x = ((d - lo) / (hi - lo)) * w;
      const y = yDb(h, d, lo, hi);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const unity = [];
    const curve = [];
    for (let i = 0; i <= 120; i++) {
      const inDb = lerp(lo, hi, i / 120);
      const wet = compressDb(inDb, threshDb, ratio, knee) + makeup;
      const outDb = lerp(inDb, wet, mix);
      unity.push({ x: ((inDb - lo) / (hi - lo)) * w, y: yDb(h, inDb, lo, hi) });
      curve.push({ x: ((inDb - lo) / (hi - lo)) * w, y: yDb(h, outDb, lo, hi) });
    }
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(unity[0].x, unity[0].y);
    for (const pt of unity) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(curve[0].x, curve[0].y);
    for (const pt of curve) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    const tx = ((threshDb - lo) / (hi - lo)) * w;
    ctx.strokeStyle = CYAN;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, h); ctx.stroke();
    ctx.setLineDash([]);
    handle(ctx, tx, yDb(h, threshDb, lo, hi), CYAN);
    labels(ctx, w, h, [
      { text: `${threshDb.toFixed(1)} dB`, x: clamp(tx + 6, 4, w - 70), y: 14 },
      { text: `${ratio.toFixed(1)}:1`, x: 8, y: h - 8 },
    ]);
  }

  function drawLimiter(ctx, w, h, item) {
    const lo = -24;
    const hi = 6;
    const ceiling = p(item, "Ceiling", -0.3);
    const gain = p(item, "Gain", 0);
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const inDb = lerp(lo, hi, i / 120);
      const driven = inDb + gain;
      const outDb = Math.min(ceiling, driven);
      pts.push({ x: ((inDb - lo) / (hi - lo)) * w, y: yDb(h, outDb, lo, hi) });
    }
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(0, yDb(h, 0, lo, hi));
    ctx.lineTo(w, yDb(h, 0, lo, hi));
    ctx.stroke();
    ctx.strokeStyle = PINK;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yDb(h, ceiling, lo, hi));
    ctx.lineTo(w, yDb(h, ceiling, lo, hi));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    labels(ctx, w, h, [
      { text: `ceiling ${ceiling.toFixed(1)} dB`, x: 8, y: 14 },
      { text: `gain +${gain.toFixed(1)} dB`, x: 8, y: h - 8 },
    ]);
  }

  function delayTimes(item) {
    const syncL = p(item, "DelayLine_SyncL", true);
    const syncR = p(item, "DelayLine_SyncR", true);
    const sixteenth = 0.125;
    const l = syncL ? Number(p(item, "DelayLine_SyncedSixteenthL", "3")) * sixteenth : p(item, "DelayLine_TimeL", 0.375);
    const r = syncR ? Number(p(item, "DelayLine_SyncedSixteenthR", "4")) * sixteenth : p(item, "DelayLine_TimeR", 0.375);
    return [Math.max(0.001, l), Math.max(0.001, r)];
  }

  function drawDelayFilter(ctx, w, h, item) {
    const filterOn = p(item, "Filter_On", true);
    const freq = p(item, "Filter_Frequency", 1000);
    const bw = p(item, "Filter_Bandwidth", 8);
    freqGrid(ctx, w, h, 0, h);
    const lo = -24;
    const hi = 6;
    const coef = rbjBandPass(freq, bw);
    const pts = [];
    const n = Math.max(80, Math.floor(w));
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      const mag = filterOn ? db(magBiquad(...coef, f)) : 0;
      pts.push({ x: (i / n) * w, y: yDb(h, mag, lo, hi) });
    }
    ctx.globalAlpha = filterOn ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(34,133,240,0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    handle(ctx, logx(freq) * w, pts[Math.round(logx(freq) * (pts.length - 1))]?.y || yDb(h, 0, lo, hi), CYAN);
    ctx.globalAlpha = 1;
    labels(ctx, w, h, [{ text: filterOn ? `${Math.round(freq)} Hz` : "filter off", x: 6, y: 12 }]);
  }

  function drawDelayTaps(ctx, w, h, item) {
    const [tL, tR] = delayTimes(item);
    const maxT = Math.max(1.2, tL, tR) * 1.15;
    const ping = p(item, "DelayLine_PingPong", false);
    const fb = p(item, "Feedback", 0.45);
    freqGrid(ctx, w, h, 0, h);
    const y0 = h * 0.82;
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
    const echoes = ping ? 8 : 6;
    for (let i = 1; i <= echoes; i++) {
      const t = (i % 2 ? tL : tR) + Math.floor((i - 1) / 2) * (tL + tR) * (ping ? 0.5 : 1);
      const x = (Math.min(t, maxT) / maxT) * w;
      const amp = fb ** i;
      ctx.fillStyle = i % 2 ? CYAN : PINK;
      ctx.globalAlpha = 0.25 + amp * 0.7;
      ctx.fillRect(x - 2, y0 - (h * 0.62) * amp, 3, (h * 0.62) * amp);
    }
    ctx.globalAlpha = 1;
    labels(ctx, w, h, [{ text: ping ? "ping pong" : "L / R", x: 6, y: 14 }]);
  }

  function drawDelay(ctx, w, h, item) {
    const split = Math.floor(h * 0.62);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, split);
    ctx.clip();
    drawDelayFilter(ctx, w, split, item);
    ctx.restore();
    ctx.save();
    ctx.translate(0, split);
    drawDelayTaps(ctx, w, h - split, item);
    ctx.restore();
  }

  function lfoValue(shape, phase, morph) {
    const t = ((phase % 1) + 1) % 1;
    const sine = Math.sin(t * Math.PI * 2);
    const tri = 1 - 4 * Math.abs(t - 0.5);
    const saw = 1 - 2 * t;
    const square = t < 0.5 ? 1 : -1;
    const wander = Math.sin(t * Math.PI * 2) * 0.65 + Math.sin(t * Math.PI * 6.1) * 0.35;
    const sah = ((Math.sin(Math.floor(t * 8) * 12.9898) * 43758.5453) % 1) * 2 - 1;
    if (shape === "Triangle") return lerp(sine, tri, 0.85);
    if (shape === "Ramp Down" || shape === "Saw Down" || shape === "Saw") return saw;
    if (shape === "Ramp Up") return -saw;
    if (shape === "Square") return square;
    if (shape === "Wander") return wander;
    if (shape === "S&H" || shape === "Random") return sah;
    return lerp(sine, tri, morph || 0);
  }

  function drawChorus(ctx, w, h, item) {
    const mode = p(item, "Mode", "Classic");
    const amount = p(item, "Amount", 0.63);
    const rate = p(item, "Rate", 0.97);
    const width = p(item, "Width", 1);
    const taps = mode === "Vibrato" ? 1 : 2;
    const cycles = 2.2;
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const colors = [CYAN, PINK, VIOLET];
    for (let tap = 0; tap < taps; tap++) {
      const pts = [];
      const phaseOff = tap * (mode === "Vibrato" ? p(item, "VibratoOffset", 0) : 0.5 * width);
      for (let i = 0; i <= w; i++) {
        const t = i / w;
        const val = lfoValue(mode === "Vibrato" ? "Sine" : "Sine", t * cycles + phaseOff, p(item, "Shaping", 0));
        const y = h / 2 - val * amount * (h * 0.38);
        pts.push({ x: i, y });
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = colors[tap];
      ctx.globalAlpha = 0.9 - tap * 0.15;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (p(item, "HighpassEnabled", false)) {
      ctx.fillStyle = "rgba(255,186,115,0.35)";
      ctx.fillRect(0, 0, logx(p(item, "HighpassFrequency", 20)) * w, 4);
    }
    labels(ctx, w, h, [
      { text: `${mode}  ${rate.toFixed(2)} Hz`, x: 8, y: 14 },
    ]);
  }

  function drawPhaser(ctx, w, h, item) {
    const mode = p(item, "Mode", "Phaser");
    if (mode === "Phaser") {
      const n = Math.round(p(item, "Notches", 4));
      const center = p(item, "CenterFrequency", 1000);
      const spread = p(item, "Spread", 0.5);
      const fb = p(item, "Feedback", 0.35);
      freqGrid(ctx, w, h, 0, h);
      const pts = [];
      const count = Math.max(80, Math.floor(w));
      for (let i = 0; i <= count; i++) {
        const f = freqAt(i / count);
        let mag = 1;
        for (let k = 0; k < n; k++) {
          const offset = (k - (n - 1) / 2) * lerp(0.12, 0.85, spread);
          const nf = center * 2 ** offset;
          const coef = rbjPeak(nf, -18 - fb * 16, lerp(8, 2.2, spread));
          mag *= magBiquad(...coef, f);
        }
        pts.push({ x: (i / count) * w, y: yDb(h, db(mag), -36, 6, 10) });
      }
      ctx.strokeStyle = VIOLET;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.strokeStyle = CYAN;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(logx(center) * w, 0);
      ctx.lineTo(logx(center) * w, h);
      ctx.stroke();
      ctx.setLineDash([]);
      labels(ctx, w, h, [{ text: `${n} notches  ${Math.round(center)} Hz`, x: 8, y: 14 }]);
      return;
    }

    const delay = mode === "Flanger" ? p(item, "FlangerDelayTime", 0.0025) : p(item, "DoublerDelayTime", 0.08);
    const amount = p(item, "Modulation_Amount", 0.5);
    const shape = p(item, "Modulation_Waveform", "Sine");
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const pts = [];
    for (let i = 0; i <= w; i++) {
      const t = i / w;
      const lfo = lfoValue(shape, t * 2, 0);
      const y = h / 2 - lfo * amount * (h * 0.36);
      pts.push({ x: i, y });
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = mode === "Flanger" ? CYAN : PINK;
    ctx.lineWidth = 2;
    ctx.stroke();
    labels(ctx, w, h, [{ text: `${mode}  ${(delay * 1000).toFixed(1)} ms`, x: 8, y: 14 }]);
  }

  function quantize(x, bits, shape, dc) {
    const levels = Math.max(2, 2 ** bits);
    let v = (x + 1) / 2;
    if (dc) v = clamp(v + 0.12, 0, 1);
    if (shape > 0) v = Math.sign(v - 0.5) * Math.pow(Math.abs(v - 0.5) * 2, 1 - shape * 0.75) / 2 + 0.5;
    const q = Math.round(v * (levels - 1)) / (levels - 1);
    return q * 2 - 1;
  }

  function drawRedux(ctx, w, h, item) {
    const bits = p(item, "BitDepth", 8);
    const rate = p(item, "SampleRate", 12000);
    const jitter = p(item, "Jitter", 0);
    const shape = p(item, "QuantizerShape", 0);
    const dc = p(item, "QuantizerDcShift", false);
    const split = Math.floor(w * 0.62);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(split, h / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, h); ctx.stroke();

    const hold = Math.max(1, Math.round(SR / rate));
    let held = 0;
    const pts = [];
    for (let i = 0; i <= split; i++) {
      const t = i / split;
      const src = Math.sin(t * Math.PI * 6);
      if (i % hold === 0) {
        const j = (Math.sin(i * 12.989) * jitter * 0.35);
        held = quantize(src + j, bits, shape, dc);
      }
      pts.push({ x: i, y: h / 2 - held * (h * 0.38) });
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const box = { x: split + 10, y: 12, w: w - split - 20, h: h - 24 };
    ctx.strokeStyle = GRID;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = lerp(-1, 1, i / 60);
      const y = quantize(x, bits, shape, dc);
      const px = box.x + ((x + 1) / 2) * box.w;
      const py = box.y + (1 - (y + 1) / 2) * box.h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    labels(ctx, w, h, [
      { text: `${bits} bit  ${Math.round(rate)} Hz`, x: 8, y: 14 },
      { text: "quantizer", x: split + 12, y: 14 },
    ]);
  }

  function drawReverb(ctx, w, h, item) {
    const decay = p(item, "DecayTime", 1200);
    const pre = p(item, "PreDelay", 2.5);
    const size = p(item, "RoomSize", 100);
    const er = p(item, "MixReflect", 1);
    const diff = p(item, "MixDiffuse", 1);
    const dry = p(item, "MixDirect", 0.25);
    const freeze = p(item, "FreezeOn", false);
    const span = Math.max(400, decay * 1.6);
    const y0 = h * 0.78;

    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();

    const dryX = 4;
    ctx.fillStyle = DIM;
    ctx.fillRect(dryX, y0 - dry * (h * 0.55), 4, dry * (h * 0.55));

    const preX = (pre / span) * w;
    ctx.fillStyle = "rgba(34,133,240,0.35)";
    ctx.fillRect(preX, 8, 2, h - 16);

    const reflections = 7 + Math.round(size / 80);
    for (let i = 0; i < reflections; i++) {
      const t = pre + 8 + i * (6 + size / 40) + (i * i * 0.8);
      const x = (t / span) * w;
      const amp = er * Math.exp(-i / (3 + size / 120));
      ctx.fillStyle = CYAN;
      ctx.globalAlpha = 0.25 + amp * 0.6;
      ctx.fillRect(x, y0 - amp * (h * 0.5), 3, amp * (h * 0.5));
    }
    ctx.globalAlpha = 1;

    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= w; i++) {
      const t = (i / w) * span;
      if (t < pre + 18) continue;
      const env = freeze ? diff * 0.85 : diff * Math.exp(-(t - pre) / Math.max(40, decay / 2.8));
      const y = y0 - env * (h * 0.62);
      if (!started) { ctx.moveTo(i, y0); ctx.lineTo(i, y); started = true; }
      else ctx.lineTo(i, y);
    }
    ctx.lineTo(w, y0);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,142,12,0.18)";
    ctx.fill();
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    labels(ctx, w, h, [
      { text: freeze ? "freeze" : `${Math.round(decay)} ms decay`, x: 8, y: 14 },
      { text: `${Math.round(pre)} ms pre`, x: 8, y: h - 8 },
    ]);
  }

  function drawReverbEq(ctx, w, h, item) {
    const lo = -18;
    const hi = 18;
    freqGrid(ctx, w, h, 0, h);
    const zero = yDb(h, 0, lo, hi);
    ctx.strokeStyle = "rgba(244,234,240,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, zero);
    ctx.lineTo(w, zero);
    ctx.stroke();
    const filters = [];
    if (p(item, "ShelfLowOn", true)) filters.push(rbjLowShelf(p(item, "ShelfLoFreq", 90), db(p(item, "ShelfLoGain", 1))));
    if (p(item, "ShelfHighOn", true)) filters.push(rbjHighShelf(p(item, "ShelfHiFreq", 4500), db(p(item, "ShelfHiGain", 0.7))));
    if (p(item, "BandLowOn", true) || p(item, "BandHighOn", false)) {
      const sign = p(item, "BandHighOn", false) ? 1 : -1;
      filters.push(rbjPeak(p(item, "BandFreq", 830), sign * 6, p(item, "BandWidth", 5.85)));
    }
    const n = Math.max(80, Math.floor(w));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      pts.push({ x: (i / n) * w, y: yDb(h, filters.length ? cascadeDb(filters, f) : 0, lo, hi) });
    }
    ctx.beginPath();
    ctx.moveTo(0, zero);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, zero);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,186,115,0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    const loF = p(item, "ShelfLoFreq", 90);
    const hiF = p(item, "ShelfHiFreq", 4500);
    if (p(item, "ShelfLowOn", true)) handle(ctx, logx(loF) * w, yDb(h, db(p(item, "ShelfLoGain", 1)), lo, hi), AMBER);
    if (p(item, "ShelfHighOn", true)) handle(ctx, logx(hiF) * w, yDb(h, db(p(item, "ShelfHiGain", 0.7)), lo, hi), PINK);
    labels(ctx, w, h, [
      { text: "20", x: 4, y: h - 6 },
      { text: "1k", x: logx(1000) * w - 6, y: h - 6 },
      { text: "20k", x: w - 22, y: h - 6 },
    ]);
  }

  function autoFilterMag(item, freq) {
    const type = p(item, "Filter_Type", "Low-pass");
    const f0 = p(item, "Filter_Frequency", 2000);
    const res = p(item, "Filter_Resonance", 0.3);
    const drive = p(item, "Filter_Drive", 0);
    const slope = p(item, "Filter_Slope", "24dB") === "24dB" ? 2 : 1;
    const q = 0.55 + res * 9;
    const morph = p(item, "Filter_Morph", 0);
    const dj = p(item, "Filter_DjControl", 0);
    const vowel = p(item, "Filter_VowelFormant", 0);
    const pitch = p(item, "Filter_VowelPitch", 0);
    const peak = drive * 6;
    let mag = 0;
    const stages = (coefs) => {
      let m = 1;
      for (let i = 0; i < slope; i++) m *= magBiquad(...coefs, freq);
      return db(m);
    };
    if (type === "High-pass") mag = stages(rbjHighPass(f0, q));
    else if (type === "Band-pass") mag = stages(rbjBandPass(f0, 0.35 + res * 1.4));
    else if (type === "Notch") mag = stages(rbjNotch(f0, q));
    else if (type === "Notch+LP") mag = cascadeDb([rbjNotch(f0, q), rbjLowPass(f0 * 1.7, 0.7)], freq);
    else if (type === "Morph") {
      mag = lerp(stages(rbjLowPass(f0, q)), stages(rbjHighPass(f0, q)), morph);
    } else if (type === "DJ") {
      const lp = stages(rbjLowPass(lerp(18000, 80, (dj + 1) / 2), 0.8));
      const hp = stages(rbjHighPass(lerp(20, 8000, (dj + 1) / 2), 0.8));
      mag = dj < 0 ? lp : hp;
    } else if (type === "Comb") {
      mag = 0;
      for (let n = 1; n <= 5; n++) mag += db(magBiquad(...rbjNotch(f0 * n, 4 + res * 8), freq)) / 5;
    } else if (type === "Vowel") {
      const f1 = 270 * 2 ** (pitch / 12) * lerp(1, 2.4, vowel);
      const f2 = 2300 * 2 ** (pitch / 12) * lerp(1, 0.55, vowel);
      mag = cascadeDb([rbjPeak(f1, 8 + res * 10, 4), rbjPeak(f2, 6 + res * 8, 5)], freq);
    } else if (type === "Resampling") {
      mag = stages(rbjLowPass(f0, 0.9));
    } else {
      mag = stages(rbjLowPass(f0, q));
    }
    if (freq > f0 * 0.5 && freq < f0 * 2) mag += peak * Math.max(0, 1 - Math.abs(Math.log(freq / f0)));
    return mag;
  }

  function drawAutoFilter(ctx, w, h, item) {
    freqGrid(ctx, w, h, 0, h);
    const lo = -36;
    const hi = 18;
    const f0 = p(item, "Filter_Frequency", 2000);
    const lfo = p(item, "Lfo_Amount", 0.2);
    const env = p(item, "Envelope_Amount", 0);
    const n = Math.max(80, Math.floor(w));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      pts.push({ x: (i / n) * w, y: yDb(h, autoFilterMag(item, f), lo, hi) });
    }
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (lfo > 0.01) {
      const span = 2 ** (lfo * 2.5);
      ctx.fillStyle = "rgba(255,142,12,0.12)";
      const x0 = logx(f0 / span) * w;
      const x1 = logx(f0 * span) * w;
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    }
    if (Math.abs(env) > 0.02) {
      ctx.strokeStyle = AMBER;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(logx(clamp(f0 * 2 ** (env * 3), FMIN, FMAX)) * w, 0);
      ctx.lineTo(logx(clamp(f0 * 2 ** (env * 3), FMIN, FMAX)) * w, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    handle(ctx, logx(f0) * w, yDb(h, autoFilterMag(item, f0), lo, hi), CYAN);
    labels(ctx, w, h, [
      { text: `${p(item, "Filter_Type", "Low-pass")}  ${Math.round(f0)} Hz`, x: 8, y: 14 },
      { text: `Q ${p(item, "Filter_Resonance", 0.3).toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function synthResNorm(item, ids) {
    const resMax = ids.resMax || 1;
    return clamp(p(item, ids.res, resMax * 0.2) / resMax, 0, 1);
  }

  function synthFilterMag(item, freq, ids) {
    const f0 = p(item, ids.freq, 2000);
    const res = synthResNorm(item, ids);
    const q = 0.55 + res * 9;
    const type = ids.type ? String(p(item, ids.type, "")) : "";
    const coefs = (type === "Highpass" || type === "High-pass")
      ? rbjHighPass(f0, q)
      : (type === "Bandpass" || type === "Band-pass")
        ? rbjBandPass(f0, 0.35 + res * 1.4)
        : (type === "Notch")
          ? rbjNotch(f0, q)
          : rbjLowPass(f0, q);
    return db(magBiquad(...coefs, freq));
  }

  function drawSynthFilter(ctx, w, h, item) {
    const ids = FILTER_PARAMS[item.kind];
    if (!ids) return;
    freqGrid(ctx, w, h, 0, h);
    const lo = -36;
    const hi = 18;
    const f0 = p(item, ids.freq, 2000);
    const n = Math.max(80, Math.floor(w));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      pts.push({ x: (i / n) * w, y: yDb(h, synthFilterMag(item, f, ids), lo, hi) });
    }
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    handle(ctx, logx(f0) * w, yDb(h, synthFilterMag(item, f0, ids), lo, hi), CYAN);
    const type = ids.type ? p(item, ids.type, "Lowpass") : "Low-pass";
    labels(ctx, w, h, [
      { text: `${type}  ${Math.round(f0)} Hz`, x: 8, y: 14 },
      { text: `Q ${synthResNorm(item, ids).toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function drawAutoPan(ctx, w, h, item) {
    const mode = p(item, "Mode", "Panning");
    const amount = p(item, "Modulation_Amount", 0.5);
    const rate = p(item, "Modulation_Frequency", 1);
    const phase = p(item, "Modulation_Phase", 180) / 360;
    const shape = p(item, "Modulation_Waveform", "Sine");
    const morph = mode === "Tremolo" ? p(item, "TremoloWaveformShape", 0) : p(item, "PanningWaveformShape", 0);
    const invert = p(item, "Modulation_Invert", false) ? -1 : 1;
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    if (mode === "Panning") {
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    }
    const cycles = 2.2;
    const left = [];
    const right = [];
    for (let i = 0; i <= w; i++) {
      const t = i / w;
      const l = lfoValue(shape, t * cycles, morph) * amount * invert;
      const r = lfoValue(shape, t * cycles + phase, morph) * amount * invert;
      if (mode === "Tremolo") {
        left.push({ x: i, y: h / 2 - ((l + 1) / 2) * (h * 0.42) });
        right.push({ x: i, y: h / 2 - ((r + 1) / 2) * (h * 0.42) });
      } else {
        left.push({ x: i, y: h / 2 - l * (h * 0.4) });
        right.push({ x: i, y: h / 2 - r * (h * 0.4) });
      }
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (const pt of left) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(right[0].x, right[0].y);
    for (const pt of right) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    labels(ctx, w, h, [
      { text: `${mode}  ${rate.toFixed(2)} Hz`, x: 8, y: 14 },
      { text: mode === "Panning" ? "L / R" : "amp", x: 8, y: h - 8 },
    ]);
  }

  function drawAutoShift(ctx, w, h, item) {
    const shift = p(item, "PitchShift_ShiftSemitones", 0);
    const detune = p(item, "PitchShift_Detune", 0) / 100;
    const formant = p(item, "PitchShift_FormantShift", 0);
    const snap = p(item, "Quantizer_Amount", 0);
    const lfoOn = p(item, "Lfo_Enabled", false);
    const lfoAmt = p(item, "Modulation_LfoToPitchModAmount", 0);
    const vib = p(item, "Vibrato_Amount", 0);
    const mix = p(item, "Global_DryWet", 1);
    const lo = -24;
    const hi = 24;
    const yAt = (st) => yDb(h, st, lo, hi);
    ctx.strokeStyle = GRID;
    for (let st = lo; st <= hi; st += 12) {
      const y = yAt(st);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = DIM;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(0, yAt(0)); ctx.lineTo(w, yAt(0)); ctx.stroke();
    ctx.setLineDash([]);
    const pitch = shift + detune;
    if (lfoOn && lfoAmt) {
      const pts = [];
      for (let i = 0; i <= w; i++) {
        const wobble = lfoValue(p(item, "Lfo_Waveform", "Sine"), i / w * 2, 0) * lfoAmt;
        pts.push({ x: i, y: yAt(clamp(pitch + wobble, lo, hi)) });
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const pt of pts) ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = PINK;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, yAt(pitch));
    ctx.lineTo(w * mix, yAt(pitch));
    ctx.stroke();
    if (Math.abs(formant) > 0.01) {
      ctx.strokeStyle = AMBER;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yAt(formant * 12));
      ctx.lineTo(w, yAt(formant * 12));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (snap > 0) {
      ctx.fillStyle = "rgba(34,133,240,0.18)";
      for (let st = lo; st <= hi; st += 1) {
        if (st % 12 === 0) continue;
        ctx.fillRect(w - 10 * snap, yAt(st) - 0.5, 10 * snap, 1);
      }
    }
    if (vib > 0) {
      ctx.strokeStyle = VIOLET;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const y = yAt(pitch + Math.sin(i / w * Math.PI * 8) * vib * 2);
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    handle(ctx, w * 0.5, yAt(pitch), CYAN);
    labels(ctx, w, h, [
      { text: `${shift >= 0 ? "+" : ""}${shift} st`, x: 8, y: 14 },
      { text: `formant ${formant.toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function drawErosion(ctx, w, h, item) {
    const amount = p(item, "Amount", 0.3);
    const freq = p(item, "Frequency", 500);
    const width = p(item, "FilterWidth", 1);
    const noise = p(item, "NoiseBlend", 0.5);
    const stereo = p(item, "StereoWidth", 0.25);
    freqGrid(ctx, w, h, 0, h);
    const lo = -30;
    const hi = 12;
    const coef = rbjBandPass(freq, width);
    const n = Math.max(80, Math.floor(w));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      pts.push({ x: (i / n) * w, y: yDb(h, db(magBiquad(...coef, f)) - (1 - amount) * 8, lo, hi) });
    }
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = noise > 0.5 ? "rgba(255,186,115,0.16)" : FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = lerpColor(CYAN, AMBER, noise);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    const grit = Math.round(40 + amount * 90);
    ctx.fillStyle = noise > 0.45 ? AMBER : CYAN;
    for (let i = 0; i < grit; i++) {
      const seed = Math.sin(i * 12.9898 + freq) * 43758.5453;
      const t = (seed % 1 + 1) % 1;
      const f = freq * 2 ** ((t - 0.5) * width);
      const x = logx(clamp(f, FMIN, FMAX)) * w;
      const y = (Math.sin(i * 78.233) * 0.5 + 0.5) * h;
      ctx.globalAlpha = 0.15 + amount * 0.55;
      ctx.fillRect(x, y, 1 + stereo * 2, 1);
    }
    ctx.globalAlpha = 1;
    handle(ctx, logx(freq) * w, yDb(h, 0, lo, hi), CYAN);
    labels(ctx, w, h, [
      { text: `${Math.round(freq)} Hz`, x: 8, y: 14 },
      { text: noise > 0.5 ? "noise" : "sine", x: 8, y: h - 8 },
    ]);
  }

  function lerpColor(a, b, t) {
    return t > 0.5 ? b : a;
  }

  function oscSample(type, shape, t) {
    const phase = t * Math.PI * 2;
    const s = clamp(shape, 0, 1);
    if (type === "Triangle") return 1 - 4 * Math.abs((t + 0.25) % 1 - 0.5);
    if (type === "Saw") return 2 * t - 1;
    if (type === "Rectangle") return (t % 1) < 0.5 + s * 0.45 ? 1 : -1;
    if (type === "Pulse") return Math.sin(phase) > (s * 1.8 - 0.9) ? 1 : -1;
    if (type === "Shark Tooth") return Math.sin(phase) * (1 - s) + (2 * t - 1) * s;
    if (type === "Saturated") return Math.tanh(Math.sin(phase) * (1.4 + s * 6));
    return Math.sin(phase + s * Math.sin(phase * 2) * 0.6);
  }

  function drawWave(ctx, w, h, sample) {
    const mid = h * 0.5;
    const amp = h * 0.36;
    const n = Math.max(80, Math.floor(w));
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      ctx.lineTo(t * w, mid - sample(t) * amp);
    }
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawDriftOsc(ctx, w, h, item) {
    freqGrid(ctx, w, h, 0, h);
    const g1 = p(item, "Mixer_OscillatorOn1", true) === false ? 0 : p(item, "Mixer_OscillatorGain1", 0.8);
    const g2 = p(item, "Mixer_OscillatorOn2", true) === false ? 0 : p(item, "Mixer_OscillatorGain2", 0);
    const gn = p(item, "Mixer_NoiseOn", false) ? p(item, "Mixer_NoiseLevel", 0) : 0;
    const t1 = p(item, "Oscillator1_Type", "Saw");
    const t2 = p(item, "Oscillator2_Type", "Saw");
    const sh = p(item, "Oscillator1_Shape", 0);
    drawWave(ctx, w, h, (t) => {
      const a = oscSample(t1, sh, t) * g1;
      const b = oscSample(t2, 0, (t + p(item, "Oscillator2_Detune", 0) * 0.01) % 1) * g2;
      const n = gn ? ((t * 37) % 1) * 2 - 1 : 0;
      const sum = g1 + g2 + gn || 1;
      return (a + b + n * gn) / sum;
    });
    labels(ctx, w, h, [
      { text: `${t1}${g2 ? " + " + t2 : ""}`, x: 8, y: 14 },
      { text: `shape ${sh.toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function drawWavetableOsc(ctx, w, h, item, map) {
    freqGrid(ctx, w, h, 0, h);
    const spec = WT[map] || WT.wtOsc1;
    const pos = p(item, spec.pos, 0);
    const on = p(item, spec.on, spec === WT.wtOsc1) !== false;
    const gain = on ? p(item, spec.gain, spec === WT.wtOsc1 ? 0.8 : 0) : 0;
    const detune = spec.detune ? p(item, spec.detune, 0) * 0.004 : 0;
    drawWave(ctx, w, h, (t) => {
      const harm = 1 + pos * 5;
      const a = Math.sin(Math.PI * 2 * t * (1 + detune));
      const b = Math.sin(Math.PI * 2 * t * harm);
      return (a * (1 - pos) + b * pos) * (0.25 + gain * 0.75);
    });
    labels(ctx, w, h, [
      { text: on ? `pos ${pos.toFixed(2)}` : "off", x: 8, y: 14 },
      { text: `level ${gain.toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function adsrCoords(item, map, w, h) {
    const pad = 10;
    const inner = w - pad * 2;
    const a = 0.1 + clamp(p(item, map.a, 0.01) / map.aMax, 0, 1) * 0.22;
    const d = 0.1 + clamp(p(item, map.d, 0.3) / map.dMax, 0, 1) * 0.22;
    const s = clamp(p(item, map.s, 0.7), 0, 1);
    const r = 0.1 + clamp(p(item, map.r, 0.3) / map.rMax, 0, 1) * 0.22;
    const y0 = h - pad;
    const yPeak = pad + 4;
    const yS = lerp(y0, yPeak, s);
    const x0 = pad;
    const xA = x0 + a * inner;
    const xD = xA + d * inner;
    const xS = Math.min(w - pad - r * inner, xD + 0.22 * inner);
    const xR = w - pad;
    return [
      { x: x0, y: y0 },
      { x: xA, y: yPeak },
      { x: xD, y: yS },
      { x: xS, y: yS },
      { x: xR, y: y0 },
    ];
  }

  function drawAdsr(ctx, w, h, item, map) {
    if (!map) return;
    freqGrid(ctx, w, h, 0, h);
    const pts = adsrCoords(item, map, w, h);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    for (const pt of pts) handle(ctx, pt.x, pt.y, PINK);
    labels(ctx, w, h, [
      { text: "A  D  S  R", x: 8, y: 14 },
      { text: `sustain ${p(item, map.s, 0.7).toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function drawAhd(ctx, w, h, item, map) {
    if (!map) return;
    freqGrid(ctx, w, h, 0, h);
    const pad = 10;
    const inner = w - pad * 2;
    const a = 0.08 + clamp(p(item, map.a, 0.001) / map.aMax, 0, 1) * 0.28;
    const hold = 0.06 + clamp(p(item, map.h, 0) / map.hMax, 0, 1) * 0.28;
    const d = 0.12 + clamp(p(item, map.d, 0.2) / map.dMax, 0, 1) * 0.4;
    const y0 = h - pad;
    const y1 = pad + 4;
    const pts = [
      { x: pad, y: y0 },
      { x: pad + a * inner, y: y1 },
      { x: pad + (a + hold) * inner, y: y1 },
      { x: pad + (a + hold + d) * inner, y: y0 },
    ];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    for (const pt of pts) handle(ctx, pt.x, pt.y, AMBER);
    labels(ctx, w, h, [{ text: "A  H  D", x: 8, y: 14 }]);
  }

  function drawSampleRegion(ctx, w, h, item) {
    freqGrid(ctx, w, h, 0, h);
    const start = clamp(p(item, "Voice_PlaybackStart", 0), 0, 1);
    const length = clamp(p(item, "Voice_PlaybackLength", 1), 0, 1);
    const x0 = start * w;
    const x1 = clamp(start + length, 0, 1) * w;
    ctx.fillStyle = FILL;
    ctx.fillRect(x0, 8, Math.max(2, x1 - x0), h - 16);
    ctx.strokeStyle = CYAN;
    ctx.strokeRect(x0 + 0.5, 8.5, Math.max(2, x1 - x0) - 1, h - 17);
    ctx.beginPath();
    const mid = h * 0.5;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const env = t < 0.08 ? t / 0.08 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      const y = mid - Math.sin(t * Math.PI * 8) * env * (h * 0.22);
      if (i) ctx.lineTo(t * w, y);
      else ctx.moveTo(t * w, y);
    }
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.stroke();
    labels(ctx, w, h, [
      { text: `start ${start.toFixed(2)}`, x: 8, y: 14 },
      { text: `length ${length.toFixed(2)}`, x: 8, y: h - 8 },
    ]);
  }

  function drawLfo(ctx, w, h, item, map) {
    if (!map) return;
    const shape = map.wave ? p(item, map.wave, "Sine") : "Sine";
    const rate = p(item, map.rate, 1);
    let amount;
    if (map.amountIsBool) amount = p(item, map.enable || map.amount, false) ? 1 : 0.22;
    else amount = clamp(p(item, map.amount, 0.5) / (map.amountMax || 1), 0, 1);
    if (map.enable && p(item, map.enable, true) === false) amount *= 0.22;
    const cycles = 1.5 + clamp(Math.log10(Math.max(0.05, rate)) + 1.2, 0, 2.6);
    freqGrid(ctx, w, h, 0, h);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const pts = [];
    for (let i = 0; i <= w; i++) {
      const val = lfoValue(shape, (i / w) * cycles, 0);
      pts.push({ x: i, y: h / 2 - val * amount * (h * 0.38) });
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = VIOLET;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    handle(ctx, w * 0.82, h / 2 - amount * (h * 0.38), VIOLET);
    labels(ctx, w, h, [
      { text: shape, x: 8, y: 14 },
      { text: `${Number(rate).toFixed(2)} Hz`, x: 8, y: h - 8 },
    ]);
  }

  function drawAr(ctx, w, h, item, map) {
    if (!map) return;
    freqGrid(ctx, w, h, 0, h);
    const pad = 10;
    const inner = w - pad * 2;
    const a = 0.08 + clamp(p(item, map.a, 0.01) / map.aMax, 0, 1) * 0.32;
    const r = 0.12 + clamp(p(item, map.r, 0.2) / map.rMax, 0, 1) * 0.4;
    const amt = map.amount ? clamp(Math.abs(p(item, map.amount, 0.5)) / Math.max(1, Math.abs(p(item, map.amount, 0.5)) > 1 ? 24 : 1), 0.2, 1) : 0.85;
    const y0 = h - pad;
    const y1 = pad + 4 + (1 - amt) * (h * 0.35);
    const xA = pad + a * inner;
    const xR = w - pad - r * inner;
    const pts = [
      { x: pad, y: y0 },
      { x: xA, y: y1 },
      { x: Math.max(xA + 8, xR), y: y1 },
      { x: w - pad, y: y0 },
    ];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(201,184,255,0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = VIOLET;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    for (const pt of pts) handle(ctx, pt.x, pt.y, VIOLET);
    labels(ctx, w, h, [{ text: "A          R", x: 8, y: 14 }]);
  }

  function drawSatColor(ctx, w, h, item) {
    const on = p(item, "ColorOn", true) !== false;
    const freq = p(item, "ColorFrequency", 1000);
    const width = p(item, "ColorWidth", 0.3);
    const depth = p(item, "ColorDepth", 0);
    freqGrid(ctx, w, h, 0, h);
    const lo = -18;
    const hi = 18;
    const zero = yDb(h, 0, lo, hi);
    ctx.strokeStyle = "rgba(244,234,240,0.18)";
    ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(w, zero); ctx.stroke();
    const q = lerp(0.4, 4.5, 1 - width);
    const coef = rbjPeak(freq, on ? depth : 0, q);
    const n = Math.max(80, Math.floor(w));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      pts.push({ x: (i / n) * w, y: yDb(h, db(magBiquad(...coef, f)), lo, hi) });
    }
    ctx.globalAlpha = on ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(0, zero);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, zero);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,186,115,0.2)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    handle(ctx, logx(freq) * w, yDb(h, on ? depth : 0, lo, hi), AMBER);
    ctx.globalAlpha = 1;
    labels(ctx, w, h, [{ text: on ? `${Math.round(freq)} Hz` : "color off", x: 8, y: 14 }]);
  }

  const DRAW = {
    channelEq: drawChannelEq,
    saturator: drawSaturator,
    compressor: drawCompressor,
    limiter: drawLimiter,
    delay: drawDelay,
    chorus: drawChorus,
    phaser: drawPhaser,
    redux2: drawRedux,
    reverb: drawReverb,
    autoFilter: drawAutoFilter,
    autoPan: drawAutoPan,
    autoShift: drawAutoShift,
    erosion: drawErosion,
    drift: drawSynthFilter,
    wavetable: drawSynthFilter,
    melodicSampler: drawSynthFilter,
    drumRack: drawSynthFilter,
  };

  function caption(kind) {
    return {
      channelEq: "EQ curve — drag the handles",
      saturator: "Waveshaper curve",
      compressor: "Transfer curve — drag threshold",
      limiter: "Ceiling / limiting",
      delay: "Band-pass + delay taps — drag the filter",
      chorus: "Delay-line modulation",
      phaser: "Notches / modulation — drag to set frequency",
      redux2: "Downsample + bit reduction",
      reverb: "Early reflections + decay",
      autoFilter: "Filter curve — drag cutoff and resonance",
      autoPan: "L / R modulation — drag rate and amount",
      autoShift: "Pitch shift — drag semitones and formant",
      erosion: "Noise band — drag frequency and amount",
      drift: "Filter curve — drag cutoff and resonance",
      wavetable: "Filter curve — drag cutoff and resonance",
      melodicSampler: "Filter curve — drag cutoff and resonance",
      drumRack: "Filter curve — drag cutoff and resonance",
    }[kind] || "";
  }

  function vizKind(canvas, item) {
    return canvas?.dataset?.fxViz || "device";
  }

  function draw(canvas, item) {
    if (!canvas || !item) return;
    const { ctx, w, h } = setup(canvas);
    const viz = vizKind(canvas, item);
    const mapKey = canvas.dataset.fxMap || "";
    ctx.save();
    if (item.parameters.Enabled === false) ctx.globalAlpha = 0.38;
    if (viz === "osc") drawDriftOsc(ctx, w, h, item);
    else if (viz === "wt") drawWavetableOsc(ctx, w, h, item, mapKey);
    else if (viz === "adsr") drawAdsr(ctx, w, h, item, ADSR[mapKey]);
    else if (viz === "ahd") drawAhd(ctx, w, h, item, AHD[mapKey]);
    else if (viz === "ar") drawAr(ctx, w, h, item, AR[mapKey]);
    else if (viz === "sample") drawSampleRegion(ctx, w, h, item);
    else if (viz === "filter") drawSynthFilter(ctx, w, h, item);
    else if (viz === "lfo") drawLfo(ctx, w, h, item, LFO[mapKey]);
    else if (viz === "taps") drawDelayTaps(ctx, w, h, item);
    else if (viz === "delayFilter") drawDelayFilter(ctx, w, h, item);
    else if (viz === "reverbEq") drawReverbEq(ctx, w, h, item);
    else if (viz === "satColor") drawSatColor(ctx, w, h, item);
    else {
      const fn = DRAW[item.kind];
      if (fn) fn(ctx, w, h, item);
    }
    ctx.restore();
  }

  function pointer(canvas, event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - box.left, 0, box.width),
      y: clamp(event.clientY - box.top, 0, box.height),
      w: box.width,
      h: box.height,
      band: canvas._fxBand || null,
    };
  }

  function applyDrag(kind, item, pos, setParam, viz, mapKey) {
    const { x, y, w, h } = pos;
    const tx = clamp(x / w, 0, 1);
    const ty = clamp(y / h, 0, 1);
    if (viz === "adsr") {
      const map = ADSR[mapKey];
      if (!map) return;
      if (tx < 0.25) setParam(map.a, clamp(tx / 0.25 * map.aMax, 0, map.aMax));
      else if (tx < 0.5) setParam(map.d, clamp((tx - 0.25) / 0.25 * map.dMax, 0, map.dMax));
      else if (tx < 0.75) setParam(map.s, clamp(1 - ty, 0, 1));
      else setParam(map.r, clamp((tx - 0.75) / 0.25 * map.rMax, 0, map.rMax));
      return;
    }
    if (viz === "ahd") {
      const map = AHD[mapKey];
      if (!map) return;
      if (tx < 0.33) setParam(map.a, clamp(tx / 0.33 * map.aMax, 0, map.aMax));
      else if (tx < 0.66) setParam(map.h, clamp((tx - 0.33) / 0.33 * map.hMax, 0, map.hMax));
      else setParam(map.d, clamp((tx - 0.66) / 0.34 * map.dMax, 0, map.dMax));
      return;
    }
    if (viz === "osc") {
      setParam("Oscillator1_Shape", clamp(tx, 0, 1));
      setParam("Oscillator1_ShapeMod", clamp(lerp(1, -1, ty), -1, 1));
      return;
    }
    if (viz === "wt") {
      const spec = WT[mapKey] || WT.wtOsc1;
      if (spec.on) setParam(spec.on, true);
      setParam(spec.pos, clamp(tx, 0, 1));
      setParam(spec.gain, clamp(1 - ty, 0, 1));
      return;
    }
    if (viz === "lfo") {
      const map = LFO[mapKey];
      if (!map) return;
      if (map.enable) setParam(map.enable, true);
      setParam(map.rate, clamp(lerp(0.05, map.rateMax || 20, tx), 0.01, map.rateMax || 20));
      if (map.amountIsBool) return;
      setParam(map.amount, clamp(lerp(map.amountMax || 1, 0, ty), 0, map.amountMax || 1));
      return;
    }
    if (viz === "ar") {
      const map = AR[mapKey];
      if (!map) return;
      if (map.enable) setParam(map.enable, true);
      if (tx < 0.5) setParam(map.a, clamp(tx / 0.5 * map.aMax, 0, map.aMax));
      else setParam(map.r, clamp((tx - 0.5) / 0.5 * map.rMax, 0, map.rMax));
      return;
    }
    if (viz === "delayFilter") {
      setParam("Filter_On", true);
      setParam("Filter_Frequency", clamp(freqAt(tx), 20, 18000));
      setParam("Filter_Bandwidth", clamp(lerp(0.5, 12, ty), 0.5, 12));
      return;
    }
    if (viz === "reverbEq") {
      const f = freqAt(tx);
      const g = clamp(fromDb(lerp(12, -12, ty)), 0, 2);
      if (f < 800) {
        setParam("ShelfLowOn", true);
        setParam("ShelfLoFreq", clamp(f, 20, 2000));
        setParam("ShelfLoGain", g);
      } else {
        setParam("ShelfHighOn", true);
        setParam("ShelfHiFreq", clamp(f, 200, 16000));
        setParam("ShelfHiGain", g);
      }
      return;
    }
    if (viz === "satColor") {
      setParam("ColorOn", true);
      setParam("ColorFrequency", Math.round(clamp(freqAt(tx), 20, 8000)));
      setParam("ColorDepth", clamp(lerp(24, -24, ty), -24, 24));
      return;
    }
    if (viz === "sample") {
      setParam("Voice_PlaybackStart", clamp(tx * 0.85, 0, 1));
      setParam("Voice_PlaybackLength", clamp(1 - ty, 0.02, 1));
      return;
    }
    if (viz === "filter") {
      const filter = FILTER_PARAMS[kind];
      if (!filter) return;
      if (filter.enable) setParam(filter.enable, true);
      setParam(filter.freq, Math.round(clamp(freqAt(tx), 20, 18000)));
      const resMax = filter.resMax || 1;
      setParam(filter.res, clamp(lerp(resMax, 0, ty), 0, resMax));
      return;
    }
    if (kind === "channelEq") {
      const f = freqAt(tx);
      const g = fromDb(lerp(18, -18, ty));
      const band = pos.band || (f < 280 ? "low" : f > 4200 ? "high" : "mid");
      if (band === "low") setParam("LowShelfGain", clamp(g, 0.1, 8));
      else if (band === "high") setParam("HighShelfGain", clamp(g, 0.1, 8));
      else {
        setParam("MidFrequency", clamp(f, 80, 8000));
        setParam("MidGain", clamp(g, 0.1, 8));
      }
      return;
    }
    if (kind === "delay") {
      setParam("Filter_On", true);
      setParam("Filter_Frequency", clamp(freqAt(tx), 20, 18000));
      setParam("Filter_Bandwidth", clamp(lerp(0.5, 12, ty), 0.5, 12));
      return;
    }
    if (kind === "compressor") {
      const threshDb = lerp(-48, 0, tx);
      setParam("Threshold", clamp(fromDb(threshDb), 0.003, 1));
      setParam("Ratio", clamp(lerp(1, 20, ty), 1, 20));
      return;
    }
    if (kind === "limiter") {
      setParam("Ceiling", clamp(lerp(0, -12, ty), -12, 0));
      return;
    }
    if (kind === "phaser" && p(item, "Mode", "Phaser") === "Phaser") {
      setParam("CenterFrequency", clamp(freqAt(tx), 20, 18000));
      return;
    }
    if (kind === "autoFilter") {
      setParam("Filter_Frequency", Math.round(clamp(freqAt(tx), 20, 18000)));
      setParam("Filter_Resonance", clamp(lerp(1, 0, ty), 0, 1));
      return;
    }
    if (kind === "autoPan") {
      setParam("Modulation_Frequency", clamp(lerp(0.05, 12, tx), 0.01, 20));
      setParam("Modulation_Amount", clamp(1 - ty, 0, 1));
      return;
    }
    if (kind === "autoShift") {
      setParam("PitchShift_ShiftSemitones", Math.round(lerp(24, -24, ty)));
      setParam("PitchShift_FormantShift", clamp(lerp(-1, 1, tx), -1, 1));
      return;
    }
    if (kind === "erosion") {
      setParam("Frequency", Math.round(clamp(freqAt(tx), 20, 18000)));
      setParam("Amount", clamp(1 - ty, 0, 1));
    }
  }

  function bind(canvas, getItem, setParam) {
    if (!canvas) return;
    const drag = (event) => {
      const item = getItem();
      if (!item || item.parameters.Enabled === false) return;
      const viz = vizKind(canvas, item);
      if (canvas.dataset.fxStatic === "1") return;
      if (viz === "taps") return;
      if (viz === "device" && ["chorus", "redux2", "reverb", "saturator"].includes(item.kind)) return;
      applyDrag(item.kind, item, pointer(canvas, event), setParam, viz, canvas.dataset.fxMap || "");
    };
    let dragging = false;
    canvas.onpointerdown = (event) => {
      dragging = true;
      const item = getItem();
      const viz = vizKind(canvas, item);
      if (item?.kind === "channelEq" && (viz === "device" || !viz)) {
        const pos = pointer(canvas, event);
        const f = freqAt(clamp(pos.x / pos.w, 0, 1));
        canvas._fxBand = f < 280 ? "low" : f > 4200 ? "high" : "mid";
      }
      drag(event);
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* untrusted tests */ }
    };
    canvas.onpointermove = (event) => {
      if (!dragging && !(canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId))) return;
      drag(event);
    };
    canvas.onpointerup = canvas.onpointercancel = () => {
      dragging = false;
      canvas._fxBand = null;
    };
  }

  function skipSpec(spec) {
    return !spec || spec.id === "Enabled" || (spec.type === "enum" && spec.choices?.length === 1);
  }

  function sections(kind, params) {
    const list = params || [];
    const byId = Object.fromEntries(list.map((spec) => [spec.id, spec]));
    const layout = SECTIONS[kind];
    if (!layout) {
      const leftover = list.filter((spec) => !skipSpec(spec));
      return leftover.length ? [{ id: "all", name: "Parameters", viz: DRAW[kind] ? "device" : null, params: leftover }] : [];
    }
    const used = new Set();
    const out = [];
    for (const section of layout) {
      const specs = (section.params || []).map((id) => byId[id]).filter((spec) => spec && !skipSpec(spec));
      specs.forEach((spec) => used.add(spec.id));
      if (!specs.length && !section.viz && !section.plots?.length) continue;
      out.push({ ...section, params: specs });
    }
    const extra = list.filter((spec) => !skipSpec(spec) && !used.has(spec.id));
    if (extra.length) out.push({ id: "more", name: "More", viz: null, params: extra });
    if (out.length && !out.some((section) => section.open)) out[0] = { ...out[0], open: true };
    return out;
  }

  function groups(kind, params) {
    const laid = sections(kind, params);
    const primary = laid[0]?.params || [];
    const more = laid.slice(1).flatMap((section) => section.params || []);
    return { primary, more };
  }

  window.FxViz = { draw, bind, groups, sections, caption };
})();
