/* Ableton-inspired live plots for the Make effect window.
   Curves follow the same jobs as Live's device displays (EQ response,
   waveshaper, compressor transfer, delay band-pass, phaser notches, etc.). */

(() => {
  const FMIN = 20;
  const FMAX = 20000;
  const SR = 44100;
  const CYAN = "#00e5ff";
  const PINK = "#ff3df5";
  const AMBER = "#ff8a4a";
  const VIOLET = "#c9b8ff";
  const TEXT = "#f4eaf0";
  const DIM = "rgba(208, 188, 199, 0.55)";
  const GRID = "rgba(244, 234, 240, 0.08)";
  const FILL = "rgba(0, 229, 255, 0.18)";

  const PRIMARY = {
    reverb: ["FreezeOn", "DecayTime", "PreDelay", "RoomSize", "MixDirect", "MixReflect", "MixDiffuse", "StereoSeparation", "ChorusOn", "SpinOn"],
    delay: ["DryWet", "Feedback", "Freeze", "DelayLine_PingPong", "DelayLine_Link", "DelayLine_SyncL", "DelayLine_SyncR", "DelayLine_SyncedSixteenthL", "DelayLine_SyncedSixteenthR", "DelayLine_TimeL", "DelayLine_TimeR", "Filter_On", "Filter_Frequency", "Filter_Bandwidth"],
    chorus: ["Mode", "DryWet", "Amount", "Rate", "Feedback", "Width", "Warmth", "HighpassEnabled", "HighpassFrequency"],
    phaser: ["Mode", "DryWet", "CenterFrequency", "Feedback", "Notches", "Spread", "Modulation_Amount", "Modulation_Waveform", "Modulation_Frequency", "FlangerDelayTime", "DoublerDelayTime"],
    saturator: ["Type", "DryWet", "PreDrive", "PostDrive", "PostClip", "ColorOn", "ColorFrequency", "ColorWidth", "ColorDepth", "BassShaperThreshold"],
    channelEq: ["HighpassOn", "LowShelfGain", "MidGain", "MidFrequency", "HighShelfGain", "Gain"],
    compressor: ["Model", "Threshold", "Ratio", "Attack", "Release", "Knee", "Gain", "DryWet", "GainCompensation", "AutoReleaseControlOnOff"],
    limiter: ["Ceiling", "Gain", "Release", "AutoRelease", "Lookahead", "Maximize", "LinkAmount"],
    redux2: ["DryWet", "BitDepth", "SampleRate", "Jitter", "EnablePreFilter", "EnablePostFilter", "PostFilterValue", "QuantizerShape"],
    autoFilter: ["DryWet", "Filter_Type", "Filter_Frequency", "Filter_Resonance", "Filter_Drive", "Filter_Slope", "Filter_Circuit", "Lfo_Amount", "Lfo_Frequency", "Lfo_Waveform", "Envelope_Amount", "Envelope_Attack", "Envelope_Release"],
    autoPan: ["Mode", "Modulation_Amount", "Modulation_Frequency", "Modulation_Phase", "Modulation_Waveform", "Modulation_TimeMode", "Modulation_SyncedRate", "VintageMode", "AttackTime", "DynamicFrequencyModulation"],
    autoShift: ["Global_DryWet", "PitchShift_ShiftSemitones", "PitchShift_Detune", "PitchShift_FormantShift", "Quantizer_Amount", "Quantizer_Active", "Lfo_Enabled", "Lfo_RateHz", "Modulation_LfoToPitchModAmount", "Vibrato_Amount"],
    erosion: ["Amount", "Frequency", "FilterWidth", "NoiseBlend", "StereoWidth"],
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
      ctx.fillStyle = color.replace(")", ", 0.16)").replace("rgb", "rgba").replace("#00e5ff", "rgba(0,229,255,0.16)").replace("#ff3df5", "rgba(255,61,245,0.14)").replace("#ff8a4a", "rgba(255,138,74,0.16)").replace("#c9b8ff", "rgba(201,184,255,0.16)");
      if (color === CYAN) ctx.fillStyle = FILL;
      else if (color === PINK) ctx.fillStyle = "rgba(255,61,245,0.14)";
      else if (color === AMBER) ctx.fillStyle = "rgba(255,138,74,0.16)";
      else ctx.fillStyle = "rgba(201,184,255,0.14)";
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
    grad.addColorStop(0, "rgba(255,138,74,0.42)");
    grad.addColorStop(clamp(logx(220), 0, 1), "rgba(255,138,74,0.28)");
    grad.addColorStop(clamp(logx(midF), 0, 1), "rgba(0,229,255,0.38)");
    grad.addColorStop(clamp(logx(4500), 0, 1), "rgba(255,61,245,0.28)");
    grad.addColorStop(1, "rgba(255,61,245,0.42)");
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

  function drawDelay(ctx, w, h, item) {
    const filterOn = p(item, "Filter_On", true);
    const freq = p(item, "Filter_Frequency", 1000);
    const bw = p(item, "Filter_Bandwidth", 8);
    const split = Math.floor(h * 0.68);
    freqGrid(ctx, w, split, 0, split);
    const lo = -24;
    const hi = 6;
    const coef = rbjBandPass(freq, bw);
    const pts = [];
    const n = Math.max(80, Math.floor(w));
    for (let i = 0; i <= n; i++) {
      const f = freqAt(i / n);
      const mag = filterOn ? db(magBiquad(...coef, f)) : 0;
      pts.push({ x: (i / n) * w, y: yDb(split, mag, lo, hi, 8) });
    }
    ctx.globalAlpha = filterOn ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(0, yDb(split, -24, lo, hi, 8));
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(w, yDb(split, -24, lo, hi, 8));
    ctx.closePath();
    ctx.fillStyle = "rgba(0,229,255,0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    handle(ctx, logx(freq) * w, pts[Math.round(logx(freq) * pts.length)]?.y || yDb(split, 0, lo, hi, 8), CYAN);
    ctx.globalAlpha = 1;

    const [tL, tR] = delayTimes(item);
    const maxT = Math.max(1.2, tL, tR) * 1.15;
    const ping = p(item, "DelayLine_PingPong", false);
    const fb = p(item, "Feedback", 0.45);
    ctx.fillStyle = "#101012";
    ctx.fillRect(0, split, w, h - split);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, split); ctx.lineTo(w, split); ctx.stroke();
    const echoes = ping ? 8 : 6;
    for (let i = 1; i <= echoes; i++) {
      const t = (i % 2 ? tL : tR) + Math.floor((i - 1) / 2) * (tL + tR) * (ping ? 0.5 : 1);
      const x = (Math.min(t, maxT) / maxT) * w;
      const amp = fb ** i;
      ctx.fillStyle = i % 2 ? CYAN : PINK;
      ctx.globalAlpha = 0.25 + amp * 0.7;
      ctx.fillRect(x - 2, split + 8, 3, (h - split - 16) * amp);
    }
    ctx.globalAlpha = 1;
    labels(ctx, w, h, [
      { text: filterOn ? `${Math.round(freq)} Hz` : "filter off", x: 6, y: 12 },
      { text: ping ? "ping pong" : "L / R", x: 6, y: split + 14 },
    ]);
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
      ctx.fillStyle = "rgba(255,138,74,0.35)";
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
    ctx.fillStyle = "rgba(0,229,255,0.35)";
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
    ctx.fillStyle = "rgba(255,61,245,0.18)";
    ctx.fill();
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const eqH = 28;
    const filters = [];
    if (p(item, "ShelfLowOn", true)) filters.push(rbjLowShelf(p(item, "ShelfLoFreq", 90), db(p(item, "ShelfLoGain", 1))));
    if (p(item, "ShelfHighOn", true)) filters.push(rbjHighShelf(p(item, "ShelfHiFreq", 4500), db(p(item, "ShelfHiGain", 0.7))));
    if (filters.length) {
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const mag = cascadeDb(filters, freqAt(i / w));
        const y = 6 + (1 - (mag + 12) / 24) * eqH;
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    labels(ctx, w, h, [
      { text: freeze ? "freeze" : `${Math.round(decay)} ms decay`, x: 8, y: 14 },
      { text: `${Math.round(pre)} ms pre`, x: 8, y: h - 8 },
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
      ctx.fillStyle = "rgba(255,61,245,0.12)";
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
      ctx.fillStyle = "rgba(0,229,255,0.18)";
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
    ctx.fillStyle = noise > 0.5 ? "rgba(255,138,74,0.16)" : FILL;
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
    }[kind] || "";
  }

  function draw(canvas, item) {
    if (!canvas || !item) return;
    const { ctx, w, h } = setup(canvas);
    const fn = DRAW[item.kind];
    if (!fn) return;
    ctx.save();
    if (item.parameters.Enabled === false) ctx.globalAlpha = 0.38;
    fn(ctx, w, h, item);
    ctx.restore();
    const cap = canvas.parentElement?.querySelector(".fx-viz-cap");
    if (cap) cap.textContent = caption(item.kind);
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

  function applyDrag(kind, item, pos, setParam) {
    const { x, y, w, h } = pos;
    const tx = clamp(x / w, 0, 1);
    const ty = clamp(y / h, 0, 1);
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
      if (!["channelEq", "delay", "compressor", "limiter", "phaser", "autoFilter", "autoPan", "autoShift", "erosion"].includes(item.kind)) return;
      applyDrag(item.kind, item, pointer(canvas, event), setParam);
    };
    let dragging = false;
    canvas.onpointerdown = (event) => {
      dragging = true;
      const item = getItem();
      if (item?.kind === "channelEq") {
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

  function groups(kind, params) {
    const primaryIds = new Set(PRIMARY[kind] || []);
    const primary = [];
    const more = [];
    for (const spec of params || []) {
      if (spec.id === "Enabled") continue;
      if (spec.type === "enum" && spec.choices?.length === 1) continue;
      if (primaryIds.has(spec.id)) primary.push(spec);
      else more.push(spec);
    }
    return { primary, more };
  }

  window.FxViz = { draw, bind, groups, caption };
})();
