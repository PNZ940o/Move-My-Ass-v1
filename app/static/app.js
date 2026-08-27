const state = {
  kind: "samples",
  path: "",
  items: [],
  selected: new Set(),
  setLabels: {},
  expanded: new Set(),
  children: {},
};

const $ = (id) => document.getElementById(id);
const rows = $("rows");

/* ---------- helpers ---------- */

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 5000);
}

function setStatus(text) {
  $("status").textContent = text;
}

function formatSize(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatStorageSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  return formatSize(bytes);
}

const STORAGE_COLORS = {
  samples: "samples",
  sets: "sets",
  presets: "presets",
  other: "other",
};

function storagePartHint(category) {
  const parts = (category.parts || []).filter((part) => part.bytes > 0);
  if (!parts.length) return "";
  return parts.map((part) => `${part.label} ${formatStorageSize(part.bytes)}`).join(" · ");
}

function renderStorage(data) {
  const wrap = $("storage");
  const bar = $("storage-bar");
  const usedEl = $("storage-used");
  const legend = $("storage-legend");
  if (!wrap || !bar || !usedEl || !legend) return;
  const total = Number(data.total) || 0;
  const used = Number(data.used) || 0;
  const free = Number(data.free) || Math.max(0, total - used);
  if (total <= 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.dataset.ready = "1";
  const pct = Math.max(0, Math.min(100, (used / total) * 100));
  usedEl.textContent = `${formatStorageSize(used)} used of ${formatStorageSize(total)}`;
  usedEl.title = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% full · ${formatStorageSize(free)} free`;

  bar.innerHTML = "";
  const segments = [...(data.categories || []), { id: "free", label: "Free", bytes: free }];
  for (const category of segments) {
    const bytes = Number(category.bytes) || 0;
    let width = (bytes / total) * 100;
    if (bytes > 0 && width < 0.7) width = 0.7;
    const seg = document.createElement("span");
    seg.className = `storage-seg ${category.id}`;
    seg.style.width = `${width}%`;
    const extra = storagePartHint(category);
    seg.title = extra
      ? `${category.label} ${formatStorageSize(bytes)} — ${extra}`
      : `${category.label} ${formatStorageSize(bytes)}`;
    bar.append(seg);
  }
  bar.setAttribute("aria-label", `${formatStorageSize(used)} used of ${formatStorageSize(total)}, ${formatStorageSize(free)} free`);

  legend.innerHTML = "";
  for (const category of data.categories || []) {
    const bytes = Number(category.bytes) || 0;
    const item = document.createElement("span");
    if (!bytes) item.className = "empty";
    const swatch = document.createElement("i");
    swatch.className = STORAGE_COLORS[category.id] || "other";
    item.append(swatch, document.createTextNode(`${category.label} ${formatStorageSize(bytes)}`));
    const extra = storagePartHint(category);
    item.title = extra || `${category.label} ${formatStorageSize(bytes)}`;
    legend.append(item);
  }
}

let storageRequest = 0;

async function refreshStorage() {
  const wrap = $("storage");
  if (!wrap) return;
  const gen = ++storageRequest;
  wrap.hidden = false;
  wrap.classList.add("busy");
  if (!wrap.dataset.ready) {
    const usedEl = $("storage-used");
    if (usedEl) usedEl.textContent = "Measuring storage…";
  }
  try {
    const data = await api("/api/storage");
    if (gen !== storageRequest) return;
    renderStorage(data);
  } catch (error) {
    if (gen !== storageRequest) return;
    if (!wrap.dataset.ready) wrap.hidden = true;
    else if ($("storage-used")) $("storage-used").title = error.message;
  } finally {
    if (gen === storageRequest) wrap.classList.remove("busy");
  }
}

function formatDate(seconds) {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: "2-digit", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatClock(seconds, minDigits = 1) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(minDigits, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function formatClockPair(current, duration) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const minDigits = Math.max(1, String(Math.floor(total / 60)).length);
  return `${formatClock(current, minDigits)} / ${formatClock(total, minDigits)}`;
}

function apiError(body, response) {
  const detail = body?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item.msg || item).join("; ");
  }
  return `${response.status} ${response.statusText}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiError(body, response));
  return body;
}

async function apiJson(path, payload) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/* An in-page replacement for prompt(). Browsers are free to suppress native
   dialogs — Chromium offers "prevent this page from creating additional
   dialogs" from the second one onwards — and a suppressed prompt() returns null,
   which is indistinguishable from the user cancelling. */
let askResolve = null;

function settleAsk(value) {
  const resolve = askResolve;
  askResolve = null;
  if (resolve) resolve(value);
}

function askName(title, label, value = "", hint = "") {
  settleAsk(null);
  const dialog = $("ask");
  if (dialog.open) dialog.close();
  const input = $("ask-input");
  $("ask-title").textContent = title;
  $("ask-label").textContent = label;
  $("ask-hint").textContent = hint;
  input.value = value;

  return new Promise((resolve) => {
    askResolve = resolve;
    dialog.showModal();
    input.focus();
    input.select();
  });
}

// method="dialog" closes the dialog on submit; answer from the events themselves
// rather than from "close", whose timing varies between engines.
$("ask-form").addEventListener("submit", (event) => {
  const value = $("ask-input").value.trim();
  if (!value) {
    event.preventDefault();
    $("ask-hint").textContent = "Give it a name";
    $("ask-input").focus();
    return;
  }
  settleAsk(value);
});
$("ask-cancel").onclick = () => {
  $("ask").close();
  settleAsk(null);
};
$("ask").addEventListener("cancel", () => settleAsk(null));

/* ---------- connection ---------- */

async function loadStatus() {
  try {
    const status = await api("/api/status");
    const dot = $("conn-dot");
    const isMock = status.mode !== "sftp";
    dot.className = `dot ${isMock ? "mock" : status.connected ? "on" : "off"}`;
    $("conn-text").textContent = isMock
      ? "mock folder"
      : `${status.user}@${status.host}${status.connected ? "" : " (idle)"}`;
    $("f-backend").value = status.mode;
    $("f-host").value = status.host || "";
    $("f-user").value = status.user || "";
    $("f-key").value = status.key_path || "";
    if (status.last_error) $("settings-hint").textContent = status.last_error;
  } catch (error) {
    toast(error.message, "error");
  }
}

$("btn-settings").onclick = () => $("settings").showModal();

$("settings-form").addEventListener("submit", async (event) => {
  const clicked = event.submitter?.value;
  if (clicked !== "connect") return;
  event.preventDefault();
  const hint = $("settings-hint");
  hint.className = "hint";
  hint.textContent = "Connecting…";
  try {
    await apiJson("/api/connect", {
      backend: $("f-backend").value,
      host: $("f-host").value,
      user: $("f-user").value,
      key_path: $("f-key").value,
    });
    hint.textContent = "";
    $("settings").close();
    toast("Connected", "ok");
    await loadStatus();
    await load();
    refreshStorage();
  } catch (error) {
    hint.className = "hint error";
    hint.textContent = error.message;
  }
});

$("btn-refresh-library").onclick = async () => {
  setStatus("Refreshing device library…");
  try {
    const result = await apiJson("/api/refresh", {});
    if (result.ok) {
      toast("Device library refreshed", "ok");
    } else {
      toast(result.stderr || "Refresh failed — try connecting as root", "error");
    }
  } catch (error) {
    toast(error.message, "error");
  }
  setStatus("Ready");
};

/* ---------- listing ---------- */

function renderCrumbs() {
  const crumbs = $("crumbs");
  crumbs.innerHTML = "";
  const parts = state.path ? state.path.split("/").filter(Boolean) : [];
  if (!parts.length) return;

  const up = document.createElement("button");
  up.className = "crumb-up";
  up.textContent = "↑";
  up.title = "Up one level";
  const parent = parts.slice(0, -1).join("/");
  up.onclick = () => navigate(parent);
  bindFolderDrop(up, parent);
  crumbs.append(up);

  parts.forEach((part, index) => {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "/";
    crumbs.append(sep);

    const button = document.createElement("button");
    button.textContent = index === 0 && state.setLabels[part] ? state.setLabels[part] : part;
    if (index === parts.length - 1) button.className = "current";
    const target = parts.slice(0, index + 1).join("/");
    button.onclick = () => navigate(target);
    bindFolderDrop(button, target);
    crumbs.append(button);
  });
}

const ICONS = { folder: "▸", audio: "♪", preset: "◆", set: "●", other: "·" };

/* In-listing drag onto a folder. Flag, not a MIME type — Safari hides custom types. */
let internalMove = null;
let internalSetCopy = null;

function knownItems() {
  const found = [...state.items];
  for (const kids of Object.values(state.children)) found.push(...kids);
  return found;
}

function itemByPath(path) {
  return knownItems().find((item) => item.path === path);
}

function visibleItems() {
  const out = [];
  const walk = (list) => {
    for (const item of list) {
      out.push(item);
      if (item.is_dir && item.category !== "set" && state.expanded.has(item.path)) {
        walk(state.children[item.path] || []);
      }
    }
  };
  walk(state.items);
  return out;
}

function destFolder() {
  if (state.selected.size === 1) {
    const item = itemByPath([...state.selected][0]);
    if (item?.is_dir && item.category !== "set") return item.path;
  }
  return state.path;
}

function isFxPreset(item) {
  return Boolean(item && !item.is_dir && /\.ablpreset$/i.test(item.name || ""));
}

function isTrackPreset(item) {
  return Boolean(item && !item.is_dir && /\.ablpreset$/i.test(item.name || ""));
}

function isFactory() {
  return state.kind === "factory";
}

function pathsForDrag(item) {
  const group = state.selected.has(item.path) ? [...state.selected] : [item.path];
  return group.filter((path) => {
    const row = itemByPath(path);
    return row && row.category !== "set";
  });
}

function destContainsSource(dest, source) {
  return dest === source || dest.startsWith(`${source}/`);
}

function bindFolderDrop(el, destPath) {
  el.addEventListener("dragover", (event) => {
    if (!internalMove) return;
    if (internalMove.paths.some((path) => destContainsSource(destPath, path))) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", (event) => {
    if (!el.contains(event.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", async (event) => {
    if (!internalMove) return;
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove("drop-target");
    const { paths } = internalMove;
    internalMove = null;
    await moveItems(paths, destPath);
  });
}

function parentPath(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

async function moveItems(paths, dest) {
  const moving = paths.filter(
    (path) => path !== dest && parentPath(path) !== dest && !destContainsSource(dest, path),
  );
  if (!moving.length) return;
  try {
    const result = await apiJson("/api/move", { kind: state.kind, items: moving, dest });
    const count = result.moved.length;
    if (count) toast(`Moved ${count} item${count === 1 ? "" : "s"}`, result.failed.length ? "error" : "ok");
    for (const failure of (result.failed || []).slice(0, 3)) {
      toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
    }
    if (count && dest && state.expanded.has(dest)) {
      delete state.children[dest];
    }
    await load();
    refreshStorage();
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------- audio preview ---------- */

const player = new Audio();
player.preload = "auto";

const previewUrl = (item) =>
  `/api/preview?kind=${state.kind}&path=${encodeURIComponent(item.path)}`;

const preview = {
  url: null,
  peaks: null,
  duration: 0,
  blobUrl: null,
  canvas: null,
  scroller: null,
  timeEl: null,
  raf: 0,
  scrubbing: false,
};

let playToken = 0;
let audioCtx = null;
const waveResize = new ResizeObserver(() => {
  if (preview.canvas) layoutPreviewWave();
  drawKitWaves();
});

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function peaksFromBuffer(buffer, buckets = 512) {
  const data = buffer.getChannelData(0);
  const count = Math.max(1, Math.min(buckets, data.length));
  const peaks = new Array(count);
  let loudest = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * data.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * data.length) / count));
    let amp = 0;
    for (let j = start; j < end; j++) {
      const value = Math.abs(data[j]);
      if (value > amp) amp = value;
    }
    peaks[i] = amp;
    if (amp > loudest) loudest = amp;
  }
  if (loudest > 0) {
    for (let i = 0; i < count; i++) peaks[i] /= loudest;
  }
  return peaks;
}

function sizeCanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(cssWidth || canvas.clientWidth));
  const height = Math.max(1, Math.round(cssHeight || canvas.clientHeight || 40));
  if (cssWidth) canvas.style.width = `${width}px`;
  if (cssHeight) canvas.style.height = `${height}px`;
  const pixelsX = Math.round(width * dpr);
  const pixelsY = Math.round(height * dpr);
  if (canvas.width !== pixelsX) canvas.width = pixelsX;
  if (canvas.height !== pixelsY) canvas.height = pixelsY;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawWaveform(canvas, peaks, options = {}) {
  if (!canvas || !peaks?.length) return;
  const start = options.start ?? 0;
  const end = Math.min(1, options.end ?? 1);
  const { ctx, width, height } = sizeCanvas(canvas, options.width, options.height);
  ctx.clearRect(0, 0, width, height);

  const lo = Math.floor(start * peaks.length);
  const hi = Math.max(lo + 1, Math.ceil(end * peaks.length));
  const slice = peaks.slice(lo, hi);
  const mid = height / 2;
  const gap = slice.length > width ? 0 : 0.35;
  const bar = Math.max(1, width / slice.length);
  const played = options.played || "rgba(255, 61, 245, 0.95)";
  const rest = options.color || "rgba(0, 229, 255, 0.82)";
  const hiStart = options.highlightStart;
  const hiEnd = options.highlightEnd;
  const span = Math.max(1e-6, end - start);
  let progress = options.progress;
  if (Number.isFinite(options.absProgress)) {
    const t = (options.absProgress - start) / span;
    progress = t >= 0 && t <= 1 ? t : undefined;
  }
  const playedX = Number.isFinite(progress) ? progress * width : -1;

  for (let i = 0; i < slice.length; i++) {
    const amp = slice[i];
    const h = Math.max(1.2, amp * (height - 4) * 0.92);
    const x = i * bar;
    const at = start + ((i + 0.5) / slice.length) * span;
    const highlighted = Number.isFinite(hiStart) && Number.isFinite(hiEnd) && at >= hiStart && at < hiEnd;
    ctx.fillStyle = playedX >= 0 && x < playedX
      ? played
      : highlighted
        ? "rgba(0, 229, 255, 1)"
        : rest;
    ctx.fillRect(x, mid - h / 2, Math.max(0.8, bar - gap), h);
  }

  if (Number.isFinite(hiStart) && Number.isFinite(hiEnd)) {
    const x = ((hiStart - start) / span) * width;
    const w = ((hiEnd - hiStart) / span) * width;
    ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
    ctx.fillRect(x, 0, w, height);
  }

  if (options.slices) {
    const bounds = [];
    const regions = options.slices;
    if (regions.length) {
      bounds.push(regions[0].start);
      for (const region of regions) bounds.push(region.start + region.length);
    }
    const active = options.activeBoundary;
    for (let i = 0; i < bounds.length; i++) {
      const t = (bounds[i] - start) / span;
      if (t < -0.02 || t > 1.02) continue;
      const x = Math.round(Math.max(0, Math.min(width - 1, t * width)));
      ctx.fillStyle = i === active ? "rgba(255, 61, 245, 0.95)" : "rgba(255, 61, 245, 0.72)";
      ctx.fillRect(x - 1, 0, 2, height);
      ctx.fillRect(Math.max(0, x - 4), 0, 8, 7);
      ctx.fillRect(Math.max(0, x - 4), height - 7, 8, 7);
    }
  }

  if (playedX >= 0) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.max(0, Math.min(width - 1, playedX)), 0, 1.5, height);
  }
}

function stopPlayback() {
  playToken++;
  cancelAnimationFrame(preview.raf);
  preview.raf = 0;
  player.pause();
  player.removeAttribute("src");
  player.load();
  if (preview.scroller) {
    try { waveResize.unobserve(preview.scroller); } catch { /* already gone */ }
  }
  if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl);
  preview.url = null;
  preview.peaks = null;
  preview.duration = 0;
  preview.blobUrl = null;
  preview.canvas = null;
  preview.scroller = null;
  preview.timeEl = null;
  preview.scrubbing = false;
  state.playing = null;
}

function isPreviewing(item) {
  return preview.url === previewUrl(item);
}

function isPlaying(item) {
  return isPreviewing(item) && !player.paused && !player.ended;
}

function previewProgress() {
  const duration = preview.duration || player.duration || 0;
  if (!duration) return 0;
  return Math.min(1, Math.max(0, player.currentTime / duration));
}

function updatePreviewClock() {
  if (!preview.timeEl) return;
  const duration = preview.duration || player.duration || 0;
  preview.timeEl.textContent = formatClockPair(player.currentTime, duration);
}

function layoutPreviewWave() {
  if (!preview.canvas || !preview.scroller) return;
  drawWaveform(preview.canvas, preview.peaks, {
    progress: previewProgress(),
    width: Math.max(1, preview.scroller.clientWidth),
    height: 48,
  });
  updatePreviewClock();
}

function tickPreviewWave() {
  layoutPreviewWave();
  if (!player.paused && !player.ended) {
    preview.raf = requestAnimationFrame(tickPreviewWave);
  } else {
    preview.raf = 0;
  }
}

function seekFromEvent(event) {
  if (!preview.canvas) return;
  const duration = preview.duration || player.duration || 0;
  if (!duration) return;
  const rect = preview.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  player.currentTime = Math.min(duration, Math.max(0, (x / rect.width) * duration));
  layoutPreviewWave();
}

function bindWaveScrub(canvas) {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    preview.scrubbing = true;
    seekFromEvent(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!preview.scrubbing) return;
    event.preventDefault();
    seekFromEvent(event);
  });
  const endScrub = (event) => {
    if (!preview.scrubbing) return;
    preview.scrubbing = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!player.paused) tickPreviewWave();
  };
  canvas.addEventListener("pointerup", endScrub);
  canvas.addEventListener("pointercancel", endScrub);
  canvas.addEventListener("click", (event) => event.stopPropagation());
}

function buildWavePlayer(item) {
  if (preview.scroller) {
    try { waveResize.unobserve(preview.scroller); } catch { /* replaced */ }
  }
  const wrap = document.createElement("div");
  wrap.className = "wave-player";
  wrap.addEventListener("click", (event) => event.stopPropagation());
  wrap.addEventListener("mousedown", (event) => event.stopPropagation());
  wrap.addEventListener("dblclick", (event) => event.stopPropagation());

  const scroller = document.createElement("div");
  scroller.className = "wave-scroller";
  const canvas = document.createElement("canvas");
  canvas.className = "wave";
  canvas.setAttribute("aria-label", `Waveform for ${item.name}`);
  scroller.append(canvas);

  const time = document.createElement("span");
  time.className = "wave-time";
  time.textContent = preview.peaks ? formatClockPair(0, preview.duration) : "loading…";

  wrap.append(scroller, time);
  preview.canvas = canvas;
  preview.scroller = scroller;
  preview.timeEl = time;
  bindWaveScrub(canvas);
  waveResize.observe(scroller);
  requestAnimationFrame(layoutPreviewWave);
  return wrap;
}

function playIcon(playing) {
  return playing
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6l11.4-6.8z"/></svg>`;
}

function playButton(item, playing, loading) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "playbtn";
  if (playing) button.classList.add("on");
  if (loading) button.classList.add("loading");
  button.draggable = false;
  button.innerHTML = playIcon(playing);
  button.title = `${playing ? "Pause" : "Play"} ${item.name}`;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(playing));
  button.onclick = (event) => {
    event.stopPropagation();
    togglePlay(item);
  };
  return button;
}

function syncPlayButtons() {
  for (const row of rows.querySelectorAll("tr[data-path]")) {
    const button = row.querySelector(".playbtn");
    if (!button) continue;
    const on = state.playing === previewUrl({ path: row.dataset.path }) && !player.paused && !player.ended;
    button.classList.toggle("on", on);
    button.innerHTML = playIcon(on);
    const name = button.getAttribute("aria-label")?.replace(/^(Pause|Play) /, "") || "";
    button.title = `${on ? "Pause" : "Play"} ${name}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(on));
    row.classList.toggle("playing", on);
  }
}

async function togglePlay(item) {
  const url = previewUrl(item);
  if (preview.url === url && !preview.blobUrl) {
    stopPlayback();
    renderRows();
    return;
  }
  if (preview.url === url && preview.blobUrl) {
    if (player.paused || player.ended) {
      if (player.ended || player.currentTime >= (preview.duration || 0) - 0.04) {
        player.currentTime = 0;
      }
      player.play().catch((error) => {
        toast(`Can't play ${item.name}: ${error.message}`, "error");
      });
    } else {
      player.pause();
      layoutPreviewWave();
      syncPlayButtons();
    }
    return;
  }
  await startPreview(item);
}

async function startPreview(item) {
  const url = previewUrl(item);
  stopPlayback();
  const token = playToken;
  preview.url = url;
  state.playing = url;
  renderRows();

  try {
    const response = await fetch(url);
    if (token !== playToken) return;
    if (!response.ok) throw new Error(`preview failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (token !== playToken) return;
    const blob = new Blob([bytes], { type: response.headers.get("content-type") || "audio/wav" });
    preview.blobUrl = URL.createObjectURL(blob);
    player.src = preview.blobUrl;
    player.play().catch((error) => {
      if (token !== playToken) return;
      toast(`Can't play ${item.name}: ${error.message}`, "error");
      stopPlayback();
      renderRows();
    });
    try {
      const decoded = await getAudioCtx().decodeAudioData(bytes.slice(0));
      if (token !== playToken) return;
      preview.peaks = peaksFromBuffer(decoded);
      preview.duration = decoded.duration;
    } catch {
      preview.peaks = null;
      preview.duration = player.duration || 0;
    }
    renderRows();
  } catch (error) {
    if (token !== playToken) return;
    toast(`Can't play ${item.name}: ${error.message}`, "error");
    stopPlayback();
    renderRows();
  }
}

player.addEventListener("play", () => {
  syncPlayButtons();
  if (!preview.raf) tickPreviewWave();
});
player.addEventListener("pause", () => {
  syncPlayButtons();
  layoutPreviewWave();
});
player.addEventListener("ended", () => {
  syncPlayButtons();
  layoutPreviewWave();
});
player.addEventListener("loadedmetadata", () => {
  if (!preview.duration && Number.isFinite(player.duration)) preview.duration = player.duration;
  layoutPreviewWave();
});
player.addEventListener("error", () => {
  if (!preview.blobUrl || player.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
  toast("Preview failed — the device may not have sent the file", "error");
  stopPlayback();
  renderRows();
});

function treeMessage(text, depth) {
  const tr = document.createElement("tr");
  tr.className = "tree-msg";
  const blank = document.createElement("td");
  blank.className = "c-check";
  const cell = document.createElement("td");
  cell.colSpan = 3;
  const wrap = document.createElement("div");
  wrap.className = "nameCell";
  wrap.style.setProperty("--depth", String(depth));
  wrap.textContent = text;
  cell.append(wrap);
  tr.append(blank, cell);
  return tr;
}

function makeRow(item, depth) {
  const tr = document.createElement("tr");
  const isSet = item.category === "set";
  const isFolder = item.is_dir && !isSet;
  const open = isFolder && state.expanded.has(item.path);
  tr.dataset.path = item.path;
  tr.className = isFolder ? "folder" : "";
  if (open) tr.classList.add("open");
  if (isSet) tr.classList.add("set-row");
  if (state.selected.has(item.path)) tr.classList.add("selected");

  const check = document.createElement("td");
  check.className = "c-check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.selected.has(item.path);
  box.addEventListener("mousedown", (event) => event.stopPropagation());
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle(item.path, box.checked);
  });
  check.append(box);

  const name = document.createElement("td");
  const cell = document.createElement("div");
  cell.className = "nameCell";
  cell.style.setProperty("--depth", String(depth));

  if (isFolder) {
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "fold";
    fold.textContent = open ? "▾" : "▸";
    fold.setAttribute("aria-expanded", String(open));
    fold.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${item.name}`);
    fold.onclick = (event) => {
      event.stopPropagation();
      cancelPendingRename();
      toggleFolder(item.path);
    };
    fold.ondblclick = (event) => event.stopPropagation();
    cell.append(fold);
  } else {
    const icon = document.createElement("span");
    icon.className = `icon ${item.category}`;
    icon.textContent = ICONS[item.category] || ICONS.other;
    cell.append(icon);
  }

  const nameEl = document.createElement("button");
  nameEl.type = "button";
  nameEl.className = "name";
  nameEl.textContent = item.name;
  nameEl.draggable = !isFactory() && item.category !== "set";
  if (item.color) {
    nameEl.style.color = item.color;
    const mark = cell.querySelector(".fold, .icon");
    if (mark) mark.style.color = item.color;
  }

  const stack = document.createElement("div");
  stack.className = "name-stack";
  const nameRow = document.createElement("div");
  nameRow.className = "name-row";
  nameRow.append(nameEl);
  if (isSet && item.pad != null) {
    const pad = document.createElement("span");
    pad.className = "pad-badge";
    pad.textContent = `Pad ${item.pad}`;
    if (item.color) pad.style.background = item.color;
    nameRow.append(pad);
  }
  stack.append(nameRow);
  cell.append(stack);
  nameEl.onclick = (event) => {
    event.stopPropagation();
    if (event.detail > 1) {
      cancelPendingRename();
      return;
    }
    const already = state.selected.size === 1 && state.selected.has(item.path);
    state.selected = new Set([item.path]);
    highlightSelection();
    if (isFactory()) return;
    if (!clickHitsNameText(nameEl, event)) return;
    if (isFolder) {
      if (already) scheduleRename(item, nameEl);
      return;
    }
    startInlineRename(item, nameEl);
  };
  if (item.category === "audio") {
    const previewing = isPreviewing(item);
    const playing = isPlaying(item);
    cell.prepend(playButton(item, playing, previewing && !preview.peaks && !preview.blobUrl));
    if (previewing) {
      tr.classList.add("previewing");
      if (playing) tr.classList.add("playing");
      stack.append(buildWavePlayer(item));
    }
  }
  name.append(cell);

  const size = document.createElement("td");
  size.className = "c-size";
  size.textContent = item.is_dir ? "—" : formatSize(item.size);

  const date = document.createElement("td");
  date.className = "c-date";
  date.textContent = formatDate(item.mtime);

  tr.append(check, name, size, date);
  tr.setAttribute("aria-label", item.name);
  tr.onclick = (event) => {
    if (event.target.closest("button.name, .name-edit")) return;
    cancelPendingRename();
    state.selected = new Set([item.path]);
    highlightSelection();
  };
  if (isFolder) {
    tr.addEventListener("dblclick", (event) => {
      if (event.target.closest("input[type=checkbox], .fold, .name-edit")) return;
      event.preventDefault();
      cancelPendingRename();
      toggleFolder(item.path);
    });
  } else if (state.kind === "effects" && isFxPreset(item)) {
    tr.addEventListener("dblclick", (event) => {
      if (event.target.closest("input[type=checkbox], .name-edit")) return;
      event.preventDefault();
      cancelPendingRename();
      selectOnly(item.path);
      openFxEditor(item.path);
    });
  } else if (state.kind === "presets" && isTrackPreset(item)) {
    tr.addEventListener("dblclick", (event) => {
      if (event.target.closest("input[type=checkbox], .name-edit")) return;
      event.preventDefault();
      cancelPendingRename();
      selectOnly(item.path);
      openPresetEditor(item.path);
    });
  }

  tr.draggable = !isFactory() && item.category !== "set";
  tr.addEventListener("dragstart", (event) => {
    if (event.target.closest("input, .playbtn, .wave-player")) {
      event.preventDefault();
      return;
    }
    const moving = pathsForDrag(item);
    if (!moving.length) {
      event.preventDefault();
      toast("Pad sets stay on the grid", "error");
      return;
    }
    internalMove = { paths: moving };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", moving.join("\n"));
    tr.classList.add("dragging-row");
    drop.classList.add("reordering");
  });
  tr.addEventListener("dragend", () => {
    internalMove = null;
    tr.classList.remove("dragging-row");
    drop.classList.remove("reordering");
    document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  });
  if (isFolder && !isFactory()) bindFolderDrop(tr, item.path);
  return tr;
}

function appendTree(list, depth) {
  for (const item of list) {
    rows.append(makeRow(item, depth));
    if (!(item.is_dir && item.category !== "set" && state.expanded.has(item.path))) continue;
    const kids = state.children[item.path];
    if (kids === undefined) rows.append(treeMessage("Loading…", depth + 1));
    else if (!kids.length) rows.append(treeMessage("Empty", depth + 1));
    else appendTree(kids, depth + 1);
  }
}

function showingSetPads() {
  return state.kind === "sets" && !state.path;
}

function inkOn(hex) {
  if (!hex || hex[0] !== "#") return "var(--text)";
  const n = hex.replace("#", "");
  if (n.length !== 6 && n.length !== 3) return "var(--text)";
  const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.58 ? "#121212" : "#f7f2f4";
}

function bindSetName(nameEl, item) {
  nameEl.draggable = false;
  nameEl.onclick = (event) => {
    event.stopPropagation();
    if (padDragMoved) {
      event.preventDefault();
      return;
    }
    if (event.detail > 1) {
      cancelPendingRename();
      return;
    }
    state.selected = new Set([item.path]);
    highlightSelection();
    if (isFactory()) return;
    startInlineRename(item, nameEl);
  };
}

function makeSetPad(num, item) {
  const pad = document.createElement("div");
  pad.className = "set-pad" + (item ? " filled" : " empty");
  pad.dataset.pad = String(num);

  const numEl = document.createElement("span");
  numEl.className = "set-pad-num";
  numEl.textContent = String(num);
  pad.append(numEl);

  if (!item) {
    pad.setAttribute("aria-label", `Empty pad ${num}`);
    return pad;
  }

  pad.dataset.path = item.path;
  pad.setAttribute("role", "button");
  pad.tabIndex = 0;
  pad.setAttribute("aria-label", `${item.name}, pad ${num}`);
  if (item.color) {
    pad.style.background = item.color;
    pad.style.color = inkOn(item.color);
  }

  const nameEl = document.createElement("button");
  nameEl.type = "button";
  nameEl.className = "name";
  nameEl.textContent = item.name;
  bindSetName(nameEl, item);
  pad.append(nameEl);

  const date = document.createElement("span");
  date.className = "set-pad-date";
  date.textContent = formatDate(item.mtime);
  pad.append(date);

  pad.onclick = (event) => {
    if (padDragMoved) return;
    if (event.target.closest("button.name, .name-edit")) return;
    cancelPendingRename();
    selectOnly(item.path);
  };
  pad.onkeydown = (event) => {
    if (event.target.closest(".name-edit")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOnly(item.path);
    }
  };
  bindSetCopyDrag(pad, item);
  return pad;
}

function hideSetGrid() {
  $("drop").classList.remove("set-pads");
  document.querySelector("table.listing").hidden = false;
  $("setgrid").hidden = true;
  $("setgrid").innerHTML = "";
  $("set-loose").hidden = true;
  $("set-loose").innerHTML = "";
}

function renderSetGrid() {
  const grid = $("setgrid");
  const loose = $("set-loose");
  $("drop").classList.add("set-pads");
  document.querySelector("table.listing").hidden = true;
  grid.hidden = false;

  const byPad = new Map();
  const extras = [];
  for (const item of state.items) {
    const pad = item.pad;
    if (item.category === "set" && Number.isInteger(pad) && pad >= 1 && pad <= 32) {
      if (byPad.has(pad)) extras.push(item);
      else byPad.set(pad, item);
    } else {
      extras.push(item);
    }
  }

  grid.innerHTML = "";
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const num = (3 - row) * 8 + col + 1;
      grid.append(makeSetPad(num, byPad.get(num)));
    }
  }

  loose.innerHTML = "";
  loose.hidden = false;
  const title = document.createElement("div");
  title.className = "set-loose-title";
  title.textContent = "Not on the 32-pad grid";
  loose.append(title);
  const hint = document.createElement("div");
  hint.className = "set-loose-hint";
  hint.textContent = "Drop a set here to keep a copy on Move, off the pad grid. Drop on an empty pad to copy it onto a pad.";
  loose.append(hint);
  for (const item of extras) {
    const isSet = item.category === "set";
    const row = document.createElement("div");
    row.className = "set-loose-item" + (isSet ? "" : " folder");
    row.dataset.path = item.path;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const nameEl = document.createElement("button");
    nameEl.type = "button";
    nameEl.className = "name";
    nameEl.textContent = item.name;
    bindSetName(nameEl, item);
    const date = document.createElement("span");
    date.className = "set-loose-date";
    date.textContent = formatDate(item.mtime);
    row.append(nameEl, date);
    row.onclick = (event) => {
      if (padDragMoved) return;
      if (event.target.closest("button.name, .name-edit")) return;
      cancelPendingRename();
      selectOnly(item.path);
    };
    if (isSet) bindSetCopyDrag(row, item);
    loose.append(row);
  }
}

function renderRows() {
  if (showingSetPads()) {
    rows.innerHTML = "";
    $("empty").hidden = true;
    renderSetGrid();
    highlightSelection();
    return;
  }
  hideSetGrid();
  rows.innerHTML = "";
  $("empty").hidden = state.items.length > 0;
  $("empty").textContent = isFactory()
    ? "Nothing here — this account may not be able to read CoreLibrary."
    : "This folder is empty. Drop files here to upload.";
  appendTree(state.items, 0);
  highlightSelection();
}

function clearSetCopyDrag() {
  internalSetCopy = null;
  $("drop").classList.remove("reordering");
  document.querySelectorAll(".dragging-pad, .drop-target").forEach((el) => {
    el.classList.remove("dragging-pad", "drop-target");
  });
  document.querySelectorAll(".set-pad-ghost").forEach((el) => el.remove());
}

let padDragMoved = false;

function nodesAtPoint(x, y) {
  const ghost = document.querySelector(".set-pad-ghost");
  if (ghost) ghost.style.visibility = "hidden";
  const stack = document.elementsFromPoint?.(x, y) || [document.elementFromPoint(x, y)];
  if (ghost) ghost.style.visibility = "";
  return stack.filter(Boolean);
}

function setDropFromPoint(x, y) {
  const nodes = nodesAtPoint(x, y);
  for (const node of nodes) {
    const pad = node.closest?.(".set-pad");
    if (pad) {
      const num = Number(pad.dataset.pad);
      return {
        kind: pad.classList.contains("empty") ? "empty-pad" : "filled-pad",
        pad: num,
        el: pad,
      };
    }
    if (node.closest?.("#set-loose")) {
      return { kind: "offgrid", el: $("set-loose") };
    }
  }
  return null;
}

function highlightSetDrop(hit) {
  document.querySelectorAll(".set-pad.drop-target, #set-loose.drop-target").forEach((el) => {
    el.classList.remove("drop-target");
  });
  if (hit?.kind === "empty-pad") hit.el.classList.add("drop-target");
  if (hit?.kind === "offgrid") $("set-loose").classList.add("drop-target");
}

function bindSetCopyDrag(el, item) {
  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".name-edit, input")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let ghost = null;

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!active && dx * dx + dy * dy < 64) return;
      if (!active) {
        active = true;
        padDragMoved = true;
        internalSetCopy = { path: item.path, name: item.name, fromPad: item.pad };
        el.classList.add("dragging-pad");
        $("drop").classList.add("reordering");
        ghost = document.createElement("div");
        ghost.className = "set-pad-ghost";
        ghost.textContent = item.name;
        if (item.color) {
          ghost.style.background = item.color;
          ghost.style.color = inkOn(item.color);
        }
        document.body.append(ghost);
        try { el.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
      }
      moveEvent.preventDefault();
      ghost.style.left = `${moveEvent.clientX}px`;
      ghost.style.top = `${moveEvent.clientY}px`;
      highlightSetDrop(setDropFromPoint(moveEvent.clientX, moveEvent.clientY));
    };

    const finish = (upEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try { el.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      const hit = active ? setDropFromPoint(upEvent.clientX, upEvent.clientY) : null;
      const source = internalSetCopy;
      ghost?.remove();
      clearSetCopyDrag();
      if (active) {
        padDragMoved = true;
        setTimeout(() => { padDragMoved = false; }, 0);
      }
      if (!active || !source) return;
      if (hit?.kind === "empty-pad" && Number.isInteger(hit.pad) && hit.pad !== source.fromPad) {
        copySetToPad(source.path, hit.pad, source.name);
        return;
      }
      if (hit?.kind === "filled-pad" && hit.pad !== source.fromPad) {
        toast(`Pad ${hit.pad} already has a set`, "error");
        return;
      }
      if (hit?.kind === "offgrid") {
        copySetOffGrid(source.path, source.name);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
}

async function copySetOffGrid(path, name) {
  setStatus(`Saving ${name} off the grid…`);
  try {
    const result = await apiJson("/api/copy-set", { path });
    toast(`Saved ${result.name || name} off the pad grid`, "ok");
    const keep = result.path;
    await load();
    refreshStorage();
    state.selected = new Set([keep]);
    renderRows();
  } catch (error) {
    toast(error.message, "error");
  }
  setStatus("Ready");
}

async function copySetToPad(path, pad, name) {
  setStatus(`Copying ${name} to pad ${pad}…`);
  try {
    const result = await apiJson("/api/copy-set", { path, pad });
    toast(`Copied ${result.name || name} to pad ${pad}`, "ok");
    const keep = result.path;
    await load();
    refreshStorage();
    state.selected = new Set([keep]);
    renderRows();
  } catch (error) {
    toast(error.message, "error");
  }
  setStatus("Ready");
}

const expandGen = {};

async function toggleFolder(path) {
  if (state.expanded.has(path)) {
    state.expanded.delete(path);
    renderRows();
    return;
  }
  state.expanded.add(path);
  renderRows();
  const gen = (expandGen[path] = (expandGen[path] || 0) + 1);
  try {
    const data = await api(`/api/list?kind=${state.kind}&path=${encodeURIComponent(path)}`);
    if (gen !== expandGen[path] || !state.expanded.has(path)) return;
    state.children[path] = data.items;
  } catch (error) {
    if (gen !== expandGen[path]) return;
    state.expanded.delete(path);
    toast(error.message, "error");
  }
  renderRows();
}

async function refreshOpenFolders() {
  const open = [...state.expanded];
  await Promise.all(
    open.map(async (path) => {
      try {
        const data = await api(`/api/list?kind=${state.kind}&path=${encodeURIComponent(path)}`);
        state.children[path] = data.items;
      } catch {
        state.expanded.delete(path);
        delete state.children[path];
      }
    }),
  );
}

function toggle(path, on) {
  if (on) state.selected.add(path);
  else state.selected.delete(path);
  highlightSelection();
}

function selectOnly(path) {
  state.selected = new Set([path]);
  highlightSelection();
}

function highlightSelection() {
  for (const row of rows.querySelectorAll("tr[data-path]")) {
    const on = state.selected.has(row.dataset.path);
    row.classList.toggle("selected", on);
    const box = row.querySelector("input[type=checkbox]");
    if (box) box.checked = on;
  }
  for (const pad of document.querySelectorAll("#setgrid .set-pad[data-path], #set-loose .set-loose-item[data-path]")) {
    pad.classList.toggle("selected", state.selected.has(pad.dataset.path));
  }
  renderSelection();
}

function renamedPath(item, newName) {
  if (item.category === "set") return item.path;
  const parts = item.path.split("/").filter(Boolean);
  if (!parts.length) return newName;
  parts[parts.length - 1] = newName;
  return parts.join("/");
}

function retargetTree(oldPath, newPath) {
  if (oldPath === newPath) return;
  const rewrite = (path) =>
    path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
  state.expanded = new Set([...state.expanded].map(rewrite));
  state.children = Object.fromEntries(
    Object.entries(state.children).map(([path, kids]) => [rewrite(path), kids]),
  );
}

let renameTimer = null;

function cancelPendingRename() {
  if (!renameTimer) return;
  clearTimeout(renameTimer);
  renameTimer = null;
}

function clickHitsNameText(nameEl, event) {
  if (!(nameEl instanceof HTMLButtonElement) || !nameEl.classList.contains("name")) return false;
  const box = nameEl.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  ) {
    return false;
  }
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  for (const rect of range.getClientRects()) {
    const left = Math.max(rect.left, box.left);
    const right = Math.min(rect.right, box.right);
    const top = Math.max(rect.top, box.top);
    const bottom = Math.min(rect.bottom, box.bottom);
    if (
      event.clientX >= left &&
      event.clientX <= right &&
      event.clientY >= top &&
      event.clientY <= bottom
    ) {
      return true;
    }
  }
  return false;
}

function scheduleRename(item, nameEl) {
  cancelPendingRename();
  if (!(nameEl instanceof HTMLButtonElement) || !nameEl.classList.contains("name")) return;
  renameTimer = setTimeout(() => {
    renameTimer = null;
    if (nameEl.isConnected) startInlineRename(item, nameEl);
  }, 500);
}

function startInlineRename(item, nameEl) {
  if (isFactory() || nameEl.tagName === "INPUT") return;
  if (!(nameEl instanceof HTMLButtonElement) || !nameEl.classList.contains("name")) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "name-edit";
  input.value = item.name;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", `Rename ${item.name}`);
  nameEl.replaceWith(input);
  input.focus();
  const extAt = item.is_dir || item.category === "set" ? -1 : item.name.lastIndexOf(".");
  input.setSelectionRange(0, extAt > 0 ? extAt : item.name.length);

  let finished = false;
  const restore = () => {
    if (finished) return;
    finished = true;
    input.replaceWith(nameEl);
  };

  const commit = async () => {
    if (finished) return;
    const name = input.value.trim();
    if (!name || name === item.name) {
      restore();
      return;
    }
    if (name.includes("/") || name === "." || name === "..") {
      toast("invalid name", "error");
      restore();
      return;
    }
    finished = true;
    input.disabled = true;
    try {
      const result = await apiJson("/api/rename", {
        kind: state.kind,
        path: item.path,
        new_name: name,
      });
      const finalName = result.name || name;
      if (finalName !== name) toast(`Renamed to ${finalName}`, "ok");
      const keep = renamedPath(item, finalName);
      retargetTree(item.path, keep);
      await load();
      state.selected = new Set([keep]);
      renderRows();
    } catch (error) {
      toast(error.message, "error");
      finished = false;
      input.disabled = false;
      input.focus();
    }
  };

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      restore();
    }
  });
  input.addEventListener("blur", () => {
    commit();
  });
}

function chosenItems() {
  return knownItems().filter((i) => state.selected.has(i.path));
}

function renderSelection() {
  const count = state.selected.size;
  $("selcount").textContent = count ? `${count} selected` : "";
  $("btn-delete").disabled = count === 0;
  $("btn-rename").disabled = count !== 1;
  $("check-all").checked = count > 0 && count === visibleItems().length;

  const chosen = chosenItems();
  const download = $("btn-download");
  download.disabled = chosen.length === 0;
  download.textContent =
    chosen.length > 1
      ? `Download ${chosen.length} as zip`
      : chosen.length === 1 && chosen[0].is_dir
        ? "Download zip"
        : "Download";

  const factory = isFactory();
  const only = count === 1 ? itemByPath([...state.selected][0]) : null;
  const samplesSection = !factory && state.kind === "samples";
  const recordingsSection = !factory && state.kind === "recordings";
  const audioSection = samplesSection || recordingsSection;
  $("btn-upload").hidden = factory;
  $("btn-upload-folder").hidden = factory;
  $("btn-mkdir").hidden = factory;
  $("btn-mkdir").disabled = factory;
  $("btn-kit").hidden = !audioSection;
  $("btn-kit").disabled = !audioSection;
  $("btn-slice").hidden = !samplesSection;
  $("btn-slice").disabled = !(samplesSection && only?.category === "audio" && only.name.toLowerCase().endsWith(".wav"));
  $("toolbar-kit").hidden = !audioSection;
  const effectsSection = !factory && state.kind === "effects";
  $("toolbar-fx").hidden = !effectsSection;
  $("btn-fx-edit").disabled = !(effectsSection && isFxPreset(only));
  const presetsSection = !factory && state.kind === "presets";
  $("toolbar-preset").hidden = !presetsSection;
  $("btn-preset-edit").disabled = !(presetsSection && isTrackPreset(only));
  $("btn-rename").hidden = factory;
  $("btn-delete").hidden = factory;
  $("btn-copy").hidden = !(factory || recordingsSection);
  $("btn-copy").disabled = !(factory || recordingsSection) || count === 0;
  $("btn-copy").textContent = recordingsSection ? "Move to Samples" : "Copy to Samples";
  const setSelected = state.kind === "sets" && only?.category === "set";
  $("btn-color").hidden = state.kind !== "sets";
  $("btn-color").disabled = !setSelected;
}

$("check-all").onclick = (event) => {
  state.selected = event.target.checked ? new Set(visibleItems().map((i) => i.path)) : new Set();
  highlightSelection();
};

let loadGen = 0;

async function load() {
  const gen = ++loadGen;
  setStatus("Loading…");
  try {
    const data = await api(`/api/list?kind=${state.kind}&path=${encodeURIComponent(state.path)}`);
    if (gen !== loadGen) return;
    state.items = data.items;
    state.selected.clear();
    if (state.kind === "sets" && !state.path) {
      state.setLabels = Object.fromEntries(
        data.items.filter((i) => i.category === "set").map((i) => [i.path, i.name])
      );
    }
    if (state.playing && !knownItems().some((i) => previewUrl(i) === state.playing)) {
      stopPlayback();
    }
    await refreshOpenFolders();
    if (gen !== loadGen) return;
    $("pathinfo").textContent = data.absolute;
    renderCrumbs();
    renderRows();
    setStatus(`${data.items.length} item${data.items.length === 1 ? "" : "s"} · ${formatSize(data.total_bytes)}`);
  } catch (error) {
    if (gen !== loadGen) return;
    state.items = [];
    renderRows();
    $("empty").hidden = false;
    $("empty").textContent = error.message;
    setStatus("Error");
  }
}

function navigate(path) {
  state.path = path;
  load();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.kind = tab.dataset.kind;
    state.path = "";
    state.expanded.clear();
    state.children = {};
    renderSelection();
    load();
  };
});

/* ---------- uploads ---------- */

const CHUNK_BYTES = 48 * 1024 * 1024;
const CHUNK_FILES = 40;

function chunk(entries) {
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const entry of entries) {
    if (batch.length && (batch.length >= CHUNK_FILES || bytes + entry.file.size > CHUNK_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += entry.file.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function sendBatch(entries) {
  const form = new FormData();
  form.append("kind", state.kind);
  form.append("dest", destFolder());
  for (const entry of entries) {
    form.append("files", entry.file, entry.file.name);
    form.append("relpaths", entry.path);
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/upload");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setStatus(`Uploading… ${Math.round((event.loaded / event.total) * 100)}%`);
      }
    };
    request.onload = () => {
      let body = {};
      try { body = JSON.parse(request.responseText); } catch {}
      if (request.status >= 200 && request.status < 300) resolve(body);
      else reject(new Error(body.detail || `upload failed (${request.status})`));
    };
    request.onerror = () => reject(new Error("network error during upload"));
    request.send(form);
  });
}

async function uploadEntries(entries) {
  if (!entries.length) return;
  const batches = chunk(entries);
  let written = 0;
  const failures = [];

  for (const [index, batch] of batches.entries()) {
    setStatus(`Uploading batch ${index + 1} of ${batches.length}…`);
    try {
      const result = await sendBatch(batch);
      written += result.count;
      failures.push(...(result.failed || []));
    } catch (error) {
      failures.push({ name: `batch ${index + 1}`, error: error.message });
    }
  }

  toast(`Uploaded ${written} file${written === 1 ? "" : "s"}`, failures.length ? "error" : "ok");
  for (const failure of failures.slice(0, 3)) toast(`${failure.name}: ${failure.error}`, "error");
  await load();
  refreshStorage();

  if (written) {
    const result = await apiJson("/api/refresh", {}).catch(() => null);
    if (result && !result.ok) {
      toast("Uploaded, but Move's library wasn't refreshed — it may not see the files yet", "error");
    }
  }
}

$("btn-upload").onclick = () => $("file-input").click();
$("btn-upload-folder").onclick = () => $("folder-input").click();

const fromInput = (input) =>
  [...input.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

$("file-input").onchange = (event) => {
  uploadEntries(fromInput(event.target));
  event.target.value = "";
};
$("folder-input").onchange = (event) => {
  uploadEntries(fromInput(event.target));
  event.target.value = "";
};

/* Drag and drop, including whole folder trees. */

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: prefix + entry.name });
    return;
  }
  const reader = entry.createReader();
  let batch;
  do {
    batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
  } while (batch.length);
}

async function collectDropped(dataTransfer) {
  const entries = [...dataTransfer.items]
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entries.length) {
    return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
  }
  const out = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}

const drop = $("drop");
let dragDepth = 0;

drop.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (internalMove || internalSetCopy || isFactory()) return;
  dragDepth++;
  drop.classList.add("dragging");
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (internalMove) event.dataTransfer.dropEffect = "move";
  if (internalSetCopy) event.dataTransfer.dropEffect = "copy";
});
drop.addEventListener("dragleave", () => {
  if (internalMove || internalSetCopy) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove("dragging");
  }
});
drop.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  drop.classList.remove("dragging");
  if (internalMove || internalSetCopy) return;
  if (isFactory()) {
    toast("Factory library is read-only — copy items into Samples", "error");
    return;
  }
  setStatus("Reading dropped files…");
  uploadEntries(await collectDropped(event.dataTransfer));
});

/* ---------- file operations ---------- */

$("btn-copy").onclick = async () => {
  const items = [...state.selected];
  if (!items.length) return;
  try {
    if (state.kind === "recordings") {
      const result = await apiJson("/api/move-to-samples", { kind: "recordings", items });
      const count = result.moved.length;
      if (count) toast(`Moved ${count} into Samples/${result.dest}`, "ok");
      for (const failure of (result.failed || []).slice(0, 3)) {
        toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
      }
      if (count) {
        await load();
        refreshStorage();
      }
      return;
    }
    const result = await apiJson("/api/copy-to-samples", { kind: "factory", items });
    const count = result.copied.length;
    if (count) toast(`Copied ${count} into Samples/${result.dest}`, "ok");
    for (const failure of (result.failed || []).slice(0, 3)) {
      toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
    }
    if (count) refreshStorage();
  } catch (error) {
    toast(error.message, "error");
  }
};

$("btn-mkdir").onclick = async () => {
  const name = await askName("New folder", "Folder name");
  if (!name) return;
  const parent = destFolder();
  const prefix = parent ? `${parent}/` : "";
  try {
    await apiJson("/api/mkdir", { kind: state.kind, path: `${prefix}${name}` });
    toast(`Created ${name}`, "ok");
    if (parent) {
      state.expanded.add(parent);
      delete state.children[parent];
    }
    await load();
  } catch (error) {
    toast(error.message, "error");
  }
};

let padColors = null;
let colorTarget = null;

$("btn-color").onclick = async () => {
  const item = chosenItems()[0];
  if (item?.category !== "set") return;
  colorTarget = item;
  try {
    if (!padColors) padColors = (await api("/api/pad-colors")).colors;
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  const grid = $("color-grid");
  grid.innerHTML = "";
  for (const swatch of padColors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = swatch.hex;
    button.title = `Colour ${swatch.id}`;
    button.setAttribute("aria-label", `Pad colour ${swatch.id}`);
    if (item.color_id === swatch.id) button.classList.add("current");
    button.onclick = () => applySetColor(swatch.id);
    grid.append(button);
  }
  $("color-title").textContent = `Color for ${item.name}`;
  $("color-picker").showModal();
};

async function applySetColor(colorId) {
  const item = colorTarget;
  $("color-picker").close();
  if (!item) return;
  try {
    await apiJson("/api/set-color", { path: item.path, color_id: colorId });
    toast("Pad color updated", "ok");
    const keep = item.path;
    await load();
    state.selected.add(keep);
    renderRows();
  } catch (error) {
    toast(error.message, "error");
  }
}

$("color-cancel").onclick = () => $("color-picker").close();

$("btn-rename").onclick = () => {
  const item = chosenItems()[0];
  if (!item || isFactory()) return;
  const nameEl =
    document.querySelector(`#setgrid [data-path="${CSS.escape(item.path)}"] button.name`) ||
    document.querySelector(`#set-loose [data-path="${CSS.escape(item.path)}"] button.name`) ||
    rows.querySelector(`tr[data-path="${CSS.escape(item.path)}"] button.name`);
  if (nameEl) startInlineRename(item, nameEl);
};

$("btn-delete").onclick = async () => {
  const items = [...state.selected];
  if (!confirm(`Delete ${items.length} item${items.length === 1 ? "" : "s"} from Move?`)) return;
  try {
    const result = await apiJson("/api/delete", { kind: state.kind, items });
    toast(`Deleted ${result.removed.length}`, result.failed.length ? "error" : "ok");
    await load();
    refreshStorage();
  } catch (error) {
    toast(error.message, "error");
  }
};

$("btn-download").onclick = async () => {
  const chosen = chosenItems();
  if (!chosen.length) return;

  if (chosen.length === 1 && !chosen[0].is_dir) {
    window.location = `/api/download?kind=${state.kind}&path=${encodeURIComponent(chosen[0].path)}`;
    return;
  }

  setStatus("Building zip…");
  try {
    const response = await fetch("/api/download-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: state.kind,
        items: chosen.map((i) => i.path),
        folder: state.path,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `failed (${response.status})`);
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.path.split("/").pop() || state.kind}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast(`Downloaded ${chosen.length} item${chosen.length === 1 ? "" : "s"}`, "ok");
  } catch (error) {
    toast(error.message, "error");
  }
  setStatus("Ready");
};

/* ---------- kit builder ---------- */

const kit = { mode: "pads", folder: "", section: "samples", available: [], pads: [], sample: null, duration: 0, slices: [], peaks: [], hiPeaks: [] };

const KIT_PAD_KEYS = ["z", "x", "c", "v", "a", "s", "d", "f", "q", "w", "e", "r", "1", "2", "3", "4"];
const KIT_KEY_INDEX = Object.fromEntries(KIT_PAD_KEYS.map((key, index) => [key, index]));
const kitAudio = { buffers: new Map(), peaks: new Map(), voices: [], selected: null, live: null, raf: 0 };

function kitSamplePath(name) {
  if (!name) return null;
  if (name.includes("/")) return name;
  return [kit.folder, name].filter(Boolean).join("/");
}

function kitPadSource(index) {
  if (kit.mode === "slices") {
    const slice = kit.slices[index];
    if (!slice || !kit.sample) return null;
    return { path: kit.sample, start: slice.start, length: slice.length };
  }
  const sample = kit.pads[index]?.sample;
  if (!sample) return null;
  return { path: kitSamplePath(sample), start: 0, length: 1 };
}

function kitPreviewHref(path) {
  return `/api/preview?kind=${encodeURIComponent(kit.section)}&path=${encodeURIComponent(path)}`;
}

async function kitAudioBuffer(path) {
  const url = kitPreviewHref(path);
  if (kitAudio.buffers.has(url)) return kitAudio.buffers.get(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`couldn't load ${path.split("/").pop()}`);
  const data = await response.arrayBuffer();
  const buffer = await getAudioCtx().decodeAudioData(data.slice(0));
  kitAudio.buffers.set(url, buffer);
  const peaks = peaksFromBuffer(buffer, 2048);
  kitAudio.peaks.set(url, peaks);
  if (path === kit.sample) kit.hiPeaks = peaks;
  return buffer;
}

function hushListingPlayer() {
  try { player.pause(); } catch { /* nothing playing */ }
}

function kitVoicePlayhead(voice) {
  if (!voice || !audioCtx) return null;
  const elapsed = audioCtx.currentTime - voice.startedAt;
  if (elapsed < 0 || elapsed >= voice.dur) return null;
  return { elapsed, abs: (voice.offset + elapsed) / voice.buffer.duration, local: elapsed / voice.dur };
}

function kitAbsPlayhead() {
  const voice = [...kitAudio.voices].reverse().find((item) => item.index === kitAudio.live)
    || kitAudio.voices[kitAudio.voices.length - 1];
  return kitVoicePlayhead(voice)?.abs;
}

function kitPadLocalProgress(index) {
  const voice = [...kitAudio.voices].reverse().find((item) => item.index === index);
  return kitVoicePlayhead(voice)?.local;
}

function syncKitPadChrome() {
  const grid = $("padgrid");
  if (!grid) return;
  for (const cell of grid.children) {
    const index = Number(cell.dataset.index);
    cell.classList.toggle("selected", kitAudio.selected === index);
    cell.classList.toggle("playing", kitAudio.live === index);
  }
}

function tickKitPlay() {
  drawKitWaves();
  syncKitPadChrome();
  if (kitAudio.voices.length) kitAudio.raf = requestAnimationFrame(tickKitPlay);
  else kitAudio.raf = 0;
}

function stopKitPlayback() {
  for (const voice of kitAudio.voices) {
    try { voice.source.stop(); } catch { /* already stopped */ }
  }
  kitAudio.voices = [];
  kitAudio.live = null;
  cancelAnimationFrame(kitAudio.raf);
  kitAudio.raf = 0;
  syncKitPadChrome();
}

function resetKitAudio() {
  stopKitPlayback();
  kitAudio.selected = null;
  kitAudio.buffers.clear();
  kitAudio.peaks.clear();
  kit.hiPeaks = [];
}

function kitPeaksForPath(path) {
  if (!path) return [];
  return kitAudio.peaks.get(kitPreviewHref(path)) || [];
}

function kitPadPeaks(index) {
  if (kit.mode === "slices") return kit.hiPeaks.length ? kit.hiPeaks : kit.peaks;
  const spec = kitPadSource(index);
  return spec ? kitPeaksForPath(spec.path) : [];
}

function kitPadView(index) {
  const pad = kit.pads[index];
  if (!pad) return { start: 0, end: 1 };
  if (!pad.view) pad.view = { start: 0, end: 1 };
  return pad.view;
}

function rememberPadView(index) {
  if (kit.mode !== "pads" || index == null) return;
  const pad = kit.pads[index];
  if (!pad) return;
  pad.view = { start: sliceView.start, end: sliceView.end };
}

function showPadView(index) {
  const view = kit.pads[index]?.view;
  sliceView.start = Number.isFinite(view?.start) ? view.start : 0;
  sliceView.end = Number.isFinite(view?.end) ? view.end : 1;
  if (sliceView.end - sliceView.start < MIN_SLICE_VIEW) {
    sliceView.start = 0;
    sliceView.end = 1;
  }
}

function selectKitPad(index) {
  const switched = kitAudio.selected !== index;
  kitAudio.selected = index;
  if (kit.mode === "pads" && switched) showPadView(index);
  syncKitPadChrome();
}

function kitBufferForPath(path) {
  if (!path) return null;
  return kitAudio.buffers.get(kitPreviewHref(path)) || null;
}

function kitPadDurationLabel(index) {
  const spec = kitPadSource(index);
  const buffer = spec ? kitBufferForPath(spec.path) : null;
  return buffer ? `${buffer.duration.toFixed(2)}s` : "";
}

async function loadKitPadWaveform(index) {
  const spec = kitPadSource(index);
  if (!spec) {
    drawKitWaves();
    return;
  }
  try {
    await kitAudioBuffer(spec.path);
    if (!$("kit").open) return;
    const cell = [...$("padgrid").children].find((item) => Number(item.dataset.index) === index);
    const label = cell?.querySelector(".slice-label");
    if (label) label.textContent = kitPadDurationLabel(index);
    drawKitWaves();
  } catch {
    /* sample couldn't be decoded — pad still plays if fetch works later */
  }
}

async function loadKitPadWaveforms() {
  const order = [];
  if (kitAudio.selected != null) order.push(kitAudio.selected);
  for (let index = 0; index < 16; index++) {
    if (index !== kitAudio.selected) order.push(index);
  }
  for (const index of order) {
    if (!$("kit").open) return;
    if (!kitPadSource(index)) continue;
    await loadKitPadWaveform(index);
  }
}

function startKitVoice(index, buffer, startNorm, lengthNorm) {
  hushListingPlayer();
  const ctx = getAudioCtx();
  const offset = Math.max(0, Math.min(buffer.duration, startNorm * buffer.duration));
  const dur = Math.max(0.02, Math.min(buffer.duration - offset, lengthNorm * buffer.duration));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const voice = { source, index, startedAt: ctx.currentTime, offset, dur, buffer };
  kitAudio.voices.push(voice);
  while (kitAudio.voices.length > 16) {
    const old = kitAudio.voices.shift();
    try { old.source.stop(); } catch { /* already stopped */ }
  }
  kitAudio.live = index;
  source.onended = () => {
    kitAudio.voices = kitAudio.voices.filter((item) => item !== voice);
    if (kitAudio.live === index && !kitAudio.voices.some((item) => item.index === index)) {
      const last = kitAudio.voices[kitAudio.voices.length - 1];
      kitAudio.live = last ? last.index : null;
    }
    syncKitPadChrome();
    drawKitWaves();
  };
  source.start(0, offset, dur);
  syncKitPadChrome();
  if (!kitAudio.raf) tickKitPlay();
}

function focusKitPads() {
  try { $("padgrid").focus({ preventScroll: true }); } catch { /* hidden */ }
}

async function playKitPad(index) {
  const spec = kitPadSource(index);
  if (!spec) return;
  selectKitPad(index);
  drawKitWaves();
  focusKitPads();
  try {
    const buffer = await kitAudioBuffer(spec.path);
    if (!$("kit").open) return;
    startKitVoice(index, buffer, spec.start, spec.length);
  } catch (error) {
    toast(error.message, "error");
  }
}

function sliceIndexAt(xNorm) {
  for (let i = 0; i < kit.slices.length; i++) {
    const slice = kit.slices[i];
    const lo = slice.start;
    const hi = slice.start + slice.length;
    if (xNorm >= lo && xNorm < hi) return i;
  }
  if (kit.slices.length && xNorm >= kit.slices[kit.slices.length - 1].start) {
    return kit.slices.length - 1;
  }
  return null;
}

function renderPads() {
  const grid = $("padgrid");
  grid.innerHTML = "";

  // Move's 4x4: pad 1 is bottom-left. CSS grid fills top-first, so emit the
  // top row (pads 13–16) before the bottom row (pads 1–4).
  for (let visRow = 0; visRow < 4; visRow++) {
    const padRow = 3 - visRow;
    for (let col = 0; col < 4; col++) {
      const index = padRow * 4 + col;
      const cell = document.createElement("div");
      cell.className = "pad";
      cell.dataset.index = String(index);

      const head = document.createElement("div");
      head.className = "pad-head";
      head.innerHTML = `<span>${index + 1}<kbd class="pad-key">${KIT_PAD_KEYS[index]}</kbd></span>`;

      if (kit.mode === "pads") {
        const pad = kit.pads[index] || {};
        const role = document.createElement("span");
        role.className = "pad-role";
        role.textContent = pad.role || "";
        head.append(role);

        const select = document.createElement("select");
        select.innerHTML = `<option value="">— empty —</option>`;
        for (const name of kit.available) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          option.selected = name === pad.sample;
          select.append(option);
        }
        select.onchange = () => {
          mutateEditor("kit", () => {
            kit.pads[index].sample = select.value || null;
            kit.pads[index].view = { start: 0, end: 1 };
            if (kitAudio.selected === index) {
              sliceView.start = 0;
              sliceView.end = 1;
            }
          });
          renderPads();
          loadKitPadWaveform(index);
        };
        select.onpointerdown = (event) => event.stopPropagation();
        select.onwheel = (event) => event.stopPropagation();
        cell.append(head);
        if (pad.sample) {
          const wave = document.createElement("div");
          wave.className = "pad-wave";
          const canvas = document.createElement("canvas");
          canvas.className = "wave-pad";
          bindPadWaveNav(canvas, index);
          const label = document.createElement("div");
          label.className = "slice-label";
          label.textContent = kitPadDurationLabel(index);
          wave.append(canvas, label);
          cell.append(wave);
        }
        cell.append(select);
        if (pad.sample) cell.classList.add("filled");
      } else {
        const slice = kit.slices[index];
        head.innerHTML += `<span class="pad-role">${slice ? "slice" : ""}</span>`;
        cell.append(head);
        if (slice && kit.peaks.length) {
          const canvas = document.createElement("canvas");
          canvas.className = "wave-pad";
          canvas.dataset.start = String(slice.start);
          canvas.dataset.end = String(slice.start + slice.length);
          cell.append(canvas);
        }
        const label = document.createElement("div");
        label.className = "slice-label";
        label.textContent = slice
          ? `${slice.start_seconds.toFixed(2)}s → ${(slice.start_seconds + slice.length_seconds).toFixed(2)}s`
          : "— empty —";
        cell.append(label);
        if (slice) cell.classList.add("filled");
      }
      if (kitPadSource(index)) {
        cell.classList.add("playable");
        cell.addEventListener("pointerdown", (event) => {
          if (event.button && event.button !== 0) return;
          if (kit.mode === "pads" && (event.shiftKey || event.altKey || event.button === 1)) return;
          event.preventDefault();
          playKitPad(index);
        });
      }
      grid.append(cell);
    }
  }
  syncKitPadChrome();
  requestAnimationFrame(drawKitWaves);
}

function bindPadWaveNav(canvas, index) {
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectKitPad(index);
    const { norm } = overviewNorm(event, canvas);
    if (event.shiftKey) panSliceView((event.deltaY || event.deltaX) * 0.001 * sliceViewSpan());
    else zoomSliceView(event.deltaY > 0 ? 1.18 : 1 / 1.18, norm);
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectKitPad(index);
    const { norm } = overviewNorm(event, canvas);
    if (sliceViewZoomed()) setSliceView(0, 1);
    else zoomSliceView(0.25, norm);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!(event.shiftKey || event.altKey || event.button === 1)) return;
    selectKitPad(index);
    drawKitWaves();
    if (!sliceViewZoomed()) return;
    event.preventDefault();
    event.stopPropagation();
    sliceEdit.panning = true;
    sliceEdit.panX = event.clientX;
    canvas.classList.add("panning");
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!canvas.classList.contains("panning") || sliceEdit.boundary != null) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const dx = (sliceEdit.panX - event.clientX) / Math.max(1, rect.width);
    sliceEdit.panX = event.clientX;
    panSliceView(dx * sliceViewSpan());
  });
  const endPan = (event) => {
    if (!canvas.classList.contains("panning")) return;
    sliceEdit.panning = false;
    canvas.classList.remove("panning");
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
  };
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
}

function drawKitWaves() {
  const overview = $("kit-overview");
  if (!overview) return;
  const selectedIndex = kitAudio.selected;
  const peaks = kit.mode === "slices"
    ? (kit.hiPeaks.length ? kit.hiPeaks : kit.peaks)
    : kitPadPeaks(selectedIndex);
  const show = peaks.length && (kit.mode === "slices"
    ? !$("kit-slice-controls").hidden
    : selectedIndex != null && kitPadSource(selectedIndex));
  overview.hidden = !show;
  if (show) {
    const canvas = overview.querySelector("canvas");
    const selected = kit.mode === "slices" ? (kit.slices[selectedIndex] || null) : null;
    const abs = kitAbsPlayhead();
    const liveMatches = kit.mode === "slices" || kitAudio.live === selectedIndex;
    drawWaveform(canvas, peaks, {
      start: sliceView.start,
      end: sliceView.end,
      slices: kit.mode === "slices" ? kit.slices : undefined,
      activeBoundary: kit.mode === "slices" ? sliceEdit.boundary : null,
      highlightStart: selected ? selected.start : undefined,
      highlightEnd: selected ? selected.start + selected.length : undefined,
      absProgress: liveMatches ? abs : undefined,
    });
    waveResize.observe(overview);
    updateSliceViewNav();
  }
  waveResize.observe($("padgrid"));
  for (const canvas of $("padgrid").querySelectorAll("canvas.wave-pad")) {
    const index = Number(canvas.closest(".pad")?.dataset.index);
    const padPeaks = kitPadPeaks(index);
    if (!padPeaks.length) continue;
    const view = kit.mode === "slices"
      ? { start: Number(canvas.dataset.start), end: Number(canvas.dataset.end) }
      : (index === kitAudio.selected ? sliceView : kitPadView(index));
    const voice = [...kitAudio.voices].reverse().find((item) => item.index === index);
    const head = kitVoicePlayhead(voice);
    drawWaveform(canvas, padPeaks, kit.mode === "slices"
      ? { start: view.start, end: view.end, progress: head?.local }
      : { start: view.start, end: view.end, absProgress: head?.abs });
  }
}

const MIN_SLICE = 0.004;
const MIN_SLICE_VIEW = 0.02;
const sliceView = { start: 0, end: 1 };
const sliceEdit = { boundary: null, panning: false, panX: 0 };

function sliceViewSpan() {
  return Math.max(MIN_SLICE_VIEW, sliceView.end - sliceView.start);
}

function sliceViewZoomed() {
  return sliceView.start > 0.001 || sliceView.end < 0.999;
}

function setSliceView(start, end) {
  let lo = Math.max(0, Math.min(1, start));
  let hi = Math.max(0, Math.min(1, end));
  if (hi - lo < MIN_SLICE_VIEW) {
    const mid = (lo + hi) / 2;
    lo = Math.max(0, mid - MIN_SLICE_VIEW / 2);
    hi = Math.min(1, lo + MIN_SLICE_VIEW);
    lo = Math.max(0, hi - MIN_SLICE_VIEW);
  }
  sliceView.start = lo;
  sliceView.end = hi;
  rememberPadView(kitAudio.selected);
  drawKitWaves();
}

function resetSliceView() {
  sliceView.start = 0;
  sliceView.end = 1;
}

function zoomSliceView(factor, centerNorm) {
  const span = sliceViewSpan();
  const next = Math.min(1, Math.max(MIN_SLICE_VIEW, span * factor));
  if (next >= 0.999) {
    setSliceView(0, 1);
    return;
  }
  const center = Number.isFinite(centerNorm) ? centerNorm : (sliceView.start + sliceView.end) / 2;
  const ratio = span < 1e-6 ? 0.5 : (center - sliceView.start) / span;
  let lo = center - next * ratio;
  let hi = lo + next;
  if (lo < 0) {
    lo = 0;
    hi = next;
  }
  if (hi > 1) {
    hi = 1;
    lo = 1 - next;
  }
  setSliceView(lo, hi);
}

function panSliceView(deltaNorm) {
  const span = sliceViewSpan();
  let lo = sliceView.start + deltaNorm;
  let hi = lo + span;
  if (lo < 0) {
    lo = 0;
    hi = span;
  }
  if (hi > 1) {
    hi = 1;
    lo = 1 - span;
  }
  setSliceView(lo, hi);
}

function zoomSliceViewToIndex(index) {
  const slice = kit.slices[index];
  if (!slice) {
    setSliceView(0, 1);
    return;
  }
  const pad = Math.max(0.012, slice.length * 0.35);
  setSliceView(slice.start - pad, slice.start + slice.length + pad);
}

function updateSliceViewNav() {
  const nav = $("kit-overview-nav");
  const thumb = $("kit-overview-thumb");
  if (!nav || !thumb) return;
  nav.hidden = !sliceViewZoomed();
  thumb.style.left = `${sliceView.start * 100}%`;
  thumb.style.width = `${sliceViewSpan() * 100}%`;
}

function overviewNorm(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const viewX = (event.clientX - rect.left) / Math.max(1, rect.width);
  return {
    viewX,
    norm: sliceView.start + viewX * sliceViewSpan(),
    width: rect.width,
  };
}

function sliceBoundaryPositions() {
  const slices = kit.slices;
  if (!slices.length) return [];
  const points = [slices[0].start];
  for (const slice of slices) points.push(slice.start + slice.length);
  return points;
}

function syncSliceSeconds() {
  for (const slice of kit.slices) {
    slice.start_seconds = slice.start * kit.duration;
    slice.length_seconds = slice.length * kit.duration;
  }
}

function setSliceBoundary(index, position) {
  mutateEditor("kit", () => {
    setSliceBoundaryRaw(index, position);
  }, { coalesce: true });
}

function setSliceBoundaryRaw(index, position) {
  const slices = kit.slices;
  const n = slices.length;
  if (!n) return;
  position = Math.max(0, Math.min(1, position));
  if (index <= 0) {
    const end = slices[0].start + slices[0].length;
    slices[0].start = Math.min(position, end - MIN_SLICE);
    slices[0].length = end - slices[0].start;
  } else if (index >= n) {
    const start = slices[n - 1].start;
    slices[n - 1].length = Math.max(MIN_SLICE, position - start);
  } else {
    const left = slices[index - 1];
    const right = slices[index];
    const rightEnd = right.start + right.length;
    position = Math.max(left.start + MIN_SLICE, Math.min(rightEnd - MIN_SLICE, position));
    left.length = position - left.start;
    right.start = position;
    right.length = rightEnd - position;
  }
  syncSliceSeconds();
}

function nearestSliceBoundary(norm, pxWidth) {
  const points = sliceBoundaryPositions();
  if (!points.length) return null;
  const span = sliceViewSpan();
  const threshold = Math.max(0.008 * span, (12 / Math.max(1, pxWidth)) * span);
  let best = null;
  let bestDist = threshold;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(norm - points[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function applySliceVisuals() {
  for (const cell of $("padgrid").children) {
    const index = Number(cell.dataset.index);
    const slice = kit.slices[index];
    if (!slice) continue;
    const canvas = cell.querySelector("canvas.wave-pad");
    if (canvas) {
      canvas.dataset.start = String(slice.start);
      canvas.dataset.end = String(slice.start + slice.length);
    }
    const label = cell.querySelector(".slice-label");
    if (label) {
      label.textContent =
        `${slice.start_seconds.toFixed(2)}s → ${(slice.start_seconds + slice.length_seconds).toFixed(2)}s`;
    }
  }
  drawKitWaves();
}

function bindSliceEditor() {
  const canvas = $("kit-overview")?.querySelector("canvas");
  if (!canvas || canvas.dataset.sliceBound) return;
  canvas.dataset.sliceBound = "1";

  canvas.addEventListener("pointerdown", (event) => {
    if ($("kit-overview").hidden) return;
    const { viewX, norm, width } = overviewNorm(event, canvas);
    const pan = event.shiftKey || event.button === 1 || event.altKey;
    if (pan && sliceViewZoomed()) {
      event.preventDefault();
      sliceEdit.panning = true;
      sliceEdit.panX = event.clientX;
      canvas.classList.add("panning");
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
      return;
    }
    if (kit.mode === "slices") {
      const boundary = nearestSliceBoundary(norm, width);
      if (boundary != null) {
        event.preventDefault();
        event.stopPropagation();
        sliceEdit.boundary = boundary;
        canvas.classList.add("dragging");
        try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
        setSliceBoundary(boundary, norm);
        applySliceVisuals();
        return;
      }
      const index = sliceIndexAt(norm);
      if (index == null) return;
      event.preventDefault();
      playKitPad(index);
      return;
    }
    if (kitAudio.selected == null) return;
    event.preventDefault();
    playKitPad(kitAudio.selected);
  });
  canvas.addEventListener("pointermove", (event) => {
    if ($("kit-overview").hidden) return;
    const { viewX, norm, width } = overviewNorm(event, canvas);
    if (sliceEdit.panning) {
      event.preventDefault();
      const dx = (sliceEdit.panX - event.clientX) / Math.max(1, width);
      sliceEdit.panX = event.clientX;
      panSliceView(dx * sliceViewSpan());
      return;
    }
    if (kit.mode === "slices" && sliceEdit.boundary != null) {
      event.preventDefault();
      let next = norm;
      if (viewX < 0.06) panSliceView(-sliceViewSpan() * 0.03);
      else if (viewX > 0.94) panSliceView(sliceViewSpan() * 0.03);
      const mapped = overviewNorm(event, canvas);
      next = mapped.norm;
      setSliceBoundary(sliceEdit.boundary, next);
      applySliceVisuals();
      return;
    }
    const onHandle = kit.mode === "slices" && nearestSliceBoundary(norm, width) != null;
    canvas.style.cursor = onHandle ? "ew-resize" : event.shiftKey && sliceViewZoomed() ? "grab" : "pointer";
  });
  const endDrag = (event) => {
    if (sliceEdit.boundary == null && !sliceEdit.panning) return;
    sliceEdit.boundary = null;
    sliceEdit.panning = false;
    canvas.classList.remove("dragging", "panning");
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
    applySliceVisuals();
    endEditorGesture("kit");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (event) => {
    if ($("kit-overview").hidden) return;
    event.preventDefault();
    const { norm } = overviewNorm(event, canvas);
    if (event.shiftKey) {
      panSliceView((event.deltaY || event.deltaX) * 0.001 * sliceViewSpan());
      return;
    }
    zoomSliceView(event.deltaY > 0 ? 1.18 : 1 / 1.18, norm);
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    if ($("kit-overview").hidden) return;
    event.preventDefault();
    const { norm } = overviewNorm(event, canvas);
    if (sliceViewZoomed()) setSliceView(0, 1);
    else if (kit.mode === "slices") {
      const index = sliceIndexAt(norm);
      if (index != null) zoomSliceViewToIndex(index);
      else zoomSliceView(0.25, norm);
    } else {
      zoomSliceView(0.25, norm);
    }
  });

  const nav = $("kit-overview-nav");
  const thumb = $("kit-overview-thumb");
  if (nav && thumb && !nav.dataset.bound) {
    nav.dataset.bound = "1";
    nav.addEventListener("pointerdown", (event) => {
      if (event.target === thumb) return;
      const rect = nav.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width);
      const span = sliceViewSpan();
      setSliceView(x - span / 2, x + span / 2);
    });
    thumb.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sliceEdit.panning = true;
      sliceEdit.panX = event.clientX;
      try { thumb.setPointerCapture(event.pointerId); } catch { /* synthetic */ }
    });
    thumb.addEventListener("pointermove", (event) => {
      if (!sliceEdit.panning || sliceEdit.boundary != null) return;
      const rect = nav.getBoundingClientRect();
      const dx = (event.clientX - sliceEdit.panX) / Math.max(1, rect.width);
      sliceEdit.panX = event.clientX;
      panSliceView(dx);
    });
    const endPan = (event) => {
      if (!sliceEdit.panning) return;
      sliceEdit.panning = false;
      if (thumb.hasPointerCapture?.(event.pointerId)) {
        try { thumb.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      }
    };
    thumb.addEventListener("pointerup", endPan);
    thumb.addEventListener("pointercancel", endPan);
  }
}

async function ensureFxCatalog() {
  if (fx.catalog) return;
  const data = await api("/api/effects/catalog");
  fx.catalog = data.effects;
}

async function ensureInstrumentCatalog() {
  if (fx.instrumentCatalog) return;
  const data = await api("/api/presets/catalog");
  fx.instrumentCatalog = data.instruments || [];
}

function kitFxOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  return option;
}

function populateKitFxSelect(select, selected, presets) {
  const specs = fx.catalog && fx.catalog.length
    ? fx.catalog
    : [
        { kind: "reverb", name: "Reverb" },
        { kind: "delay", name: "Delay" },
        { kind: "autoFilter", name: "Auto Filter" },
        { kind: "chorus", name: "Chorus-Ensemble" },
        { kind: "phaser", name: "Phaser-Flanger" },
        { kind: "autoPan", name: "Auto Pan" },
        { kind: "autoShift", name: "Auto Shift" },
        { kind: "erosion", name: "Erosion" },
        { kind: "saturator", name: "Saturator" },
        { kind: "channelEq", name: "Channel EQ" },
        { kind: "compressor", name: "Compressor" },
        { kind: "limiter", name: "Limiter" },
        { kind: "redux2", name: "Redux" },
      ];
  select.innerHTML = "";
  select.append(kitFxOption("", "Off", selected === ""));
  const devices = document.createElement("optgroup");
  devices.label = "Devices";
  for (const spec of specs) {
    devices.append(kitFxOption(spec.kind, spec.name, spec.kind === selected));
  }
  select.append(devices);
  const presetsGroup = document.createElement("optgroup");
  presetsGroup.label = "Presets";
  if (presets.length) {
    for (const preset of presets) {
      const value = "preset:" + preset.path;
      presetsGroup.append(kitFxOption(value, preset.label || preset.name, value === selected));
    }
  } else {
    const empty = kitFxOption("", "No saved presets", false);
    empty.disabled = true;
    presetsGroup.append(empty);
  }
  select.append(presetsGroup);
  select.value = selected;
}

async function fillKitFxSelects() {
  try {
    await ensureFxCatalog();
  } catch (error) {
    if (!fx.catalog) toast(error.message, "error");
  }
  let presets = [];
  try {
    const data = await api("/api/effects/presets");
    presets = data.presets || [];
  } catch {
    presets = [];
  }
  populateKitFxSelect($("kit-return-fx"), "reverb", presets);
  populateKitFxSelect($("kit-insert-fx"), "saturator", presets);
}

async function openKitFromFolder() {
  if (state.kind !== "samples" && state.kind !== "recordings") {
    toast("Kits can only be built from Samples or Recordings", "error");
    return;
  }
  try {
    const plan = await apiJson("/api/kit/plan-pads", { folder: destFolder(), section: state.kind });
    kit.mode = "pads";
    kit.section = state.kind;
    kit.folder = plan.folder;
    kit.available = plan.available;
    kit.pads = plan.pads.map((pad) => ({ ...pad, view: { start: 0, end: 1 } }));

    if (!plan.available.length) {
      toast("No audio files in this folder", "error");
      return;
    }
    $("kit-name").value = (plan.folder.split("/").pop() || "New") + " Kit";
    $("kit-slice-controls").hidden = true;
    kit.sample = null;
    kit.peaks = [];
    resetKitAudio();
    resetSliceView();
    const first = plan.pads.findIndex((pad) => pad.sample);
    if (first >= 0) kitAudio.selected = first;
    await fillKitFxSelects();
    $("kit-hint").textContent = "";
    renderPads();
    $("kit").showModal();
    beginEditor("kit");
    bindSliceEditor();
    focusKitPads();
    requestAnimationFrame(() => requestAnimationFrame(drawKitWaves));
    loadKitPadWaveforms();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadSlicePlan() {
  const count = Number($("kit-slices").value);
  $("slice-count-label").textContent = count;
  stopKitPlayback();
  const record = $("kit")?.open;
  const before = record ? JSON.stringify(snapshotKit()) : null;
  try {
    const plan = await apiJson("/api/kit/plan-slices", { sample: kit.sample, count, section: kit.section });
    kit.duration = plan.duration;
    kit.slices = plan.slices;
    if (kitAudio.selected != null && kitAudio.selected >= kit.slices.length) kitAudio.selected = null;
    const fromPreview = preview.peaks?.length && previewUrl({ path: kit.sample }) === preview.url;
    kit.peaks = plan.peaks?.length ? plan.peaks : fromPreview ? preview.peaks : [];
    $("kit-slice-info").textContent =
      `${plan.duration.toFixed(2)}s · ${(plan.duration / count).toFixed(3)}s each`;
    $("kit-slice-info").classList.remove("error");
    renderPads();
  } catch (error) {
    $("kit-slice-info").textContent = error.message;
    $("kit-slice-info").classList.add("error");
    kit.slices = [];
    kit.peaks = [];
    renderPads();
  }
  if (before) commitEditorDiff("kit", before);
}

async function openKitFromSample() {
  if (state.kind !== "samples") {
    toast("Slice kits from Samples — move the recording there first", "error");
    return;
  }
  const [path] = [...state.selected];
  kit.mode = "slices";
  kit.sample = path;
  kit.section = state.kind;
  kit.folder = "";
  $("kit-name").value = path.split("/").pop().replace(/\.[^.]+$/, "") + " Slices";
  $("kit-slice-controls").hidden = false;
  $("kit-hint").textContent = "";
  resetKitAudio();
  resetSliceView();
  await fillKitFxSelects();
  await loadSlicePlan();
  $("kit").showModal();
  beginEditor("kit");
  bindSliceEditor();
  focusKitPads();
  requestAnimationFrame(() => requestAnimationFrame(drawKitWaves));
  kitAudioBuffer(kit.sample).then(() => drawKitWaves()).catch(() => {});
}

$("kit-slices").oninput = () => {
  $("slice-count-label").textContent = $("kit-slices").value;
};
$("kit-slices").onchange = loadSlicePlan;
function zoomFromButton(fn) {
  fn();
  focusKitPads();
}
$("kit-zoom-in").onclick = () => zoomFromButton(() => zoomSliceView(1 / 1.6, (sliceView.start + sliceView.end) / 2));
$("kit-zoom-out").onclick = () => zoomFromButton(() => zoomSliceView(1.6, (sliceView.start + sliceView.end) / 2));
$("kit-zoom-fit").onclick = () => zoomFromButton(() => setSliceView(0, 1));
$("kit-overview")?.querySelector(".kit-zoom")?.addEventListener("pointerdown", (event) => event.stopPropagation());

$("btn-kit").onclick = openKitFromFolder;
$("btn-slice").onclick = openKitFromSample;
$("kit-cancel").onclick = () => $("kit").close();
$("kit").addEventListener("close", () => {
  resetKitAudio();
  resetSliceView();
});

document.addEventListener("keydown", (event) => {
  if (!$("kit").open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest("input, select, textarea")) return;
  const index = KIT_KEY_INDEX[event.key.toLowerCase()];
  if (index == null) return;
  event.preventDefault();
  playKitPad(index);
});

function kitPayload(output) {
  return {
    name: $("kit-name").value.trim(),
    kit_type: $("kit-type").value,
    return_effect: $("kit-return-fx").value,
    insert_effect: $("kit-insert-fx").value,
    mode: kit.mode,
    folder: kit.folder,
    pads: kit.mode === "pads" ? kit.pads.map((p) => p.sample) : [],
    sample: kit.sample,
    count: Number($("kit-slices").value),
    slices: kit.mode === "slices"
      ? kit.slices.map((slice) => ({ start: slice.start, length: slice.length }))
      : [],
    output,
    section: kit.section,
  };
}

function bindSelectUndo(id, kind) {
  const el = $(id);
  if (!el) return;
  let before = null;
  el.addEventListener("pointerdown", () => {
    before = JSON.stringify(snapshotEditor(kind));
  });
  el.addEventListener("change", () => {
    if (before) commitEditorDiff(kind, before);
    before = JSON.stringify(snapshotEditor(kind));
  });
}

bindSelectUndo("kit-type", "kit");
bindSelectUndo("kit-return-fx", "kit");
bindSelectUndo("kit-insert-fx", "kit");
$("kit-name").addEventListener("focus", () => {
  editorUndo.fieldStart = JSON.stringify(snapshotKit());
});
$("kit-name").addEventListener("blur", () => {
  if (editorUndo.fieldStart) commitEditorDiff("kit", editorUndo.fieldStart);
  editorUndo.fieldStart = null;
});

$("kit-save").onclick = async () => {
  const payload = kitPayload("device");
  if (!payload.name) {
    $("kit-hint").textContent = "Give the kit a name first";
    return;
  }
  try {
    const result = await apiJson("/api/kit/build", payload);
    $("kit").close();
    toast(`Kit saved with ${result.filled_pads} pads`, "ok");
    if (!result.refreshed) {
      toast("Saved, but library refresh failed — restart Move to see it", "error");
    }
    refreshStorage();
  } catch (error) {
    $("kit-hint").textContent = error.message;
  }
};

$("kit-download").onclick = async () => {
  const payload = kitPayload("bundle");
  if (!payload.name) {
    $("kit-hint").textContent = "Give the kit a name first";
    return;
  }
  try {
    const response = await fetch("/api/kit/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `failed (${response.status})`);
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${payload.name}.ablpresetbundle`;
    link.click();
    URL.revokeObjectURL(link.href);
    $("kit").close();
    toast("Bundle downloaded", "ok");
  } catch (error) {
    $("kit-hint").textContent = error.message;
  }
};

/* ---------- effect builder ---------- */

const FX_MAX = 8;
const fx = { catalog: null, instrumentCatalog: null, devices: [], macros: emptyFxMacros(), arm: null, live: null, scrubbing: false, liveTimer: 0, editPath: "", editFolder: "", mode: "effect", instrument: null, instruments: [], instrumentDevices: {} };

function emptyEditorUndo() {
  return { past: [], current: null, coalescing: false, applying: false };
}

const editorUndo = {
  kit: emptyEditorUndo(),
  fx: emptyEditorUndo(),
  fieldStart: null,
};

function snapshotKit() {
  return {
    pads: (kit.pads || []).map((pad) => ({
      sample: pad.sample || null,
      role: pad.role || "",
      view: pad.view ? { start: pad.view.start, end: pad.view.end } : null,
    })),
    slices: (kit.slices || []).map((slice) => ({
      start: slice.start,
      length: slice.length,
      start_seconds: slice.start_seconds,
      length_seconds: slice.length_seconds,
    })),
    name: $("kit-name")?.value || "",
    type: $("kit-type")?.value || "",
    returnFx: $("kit-return-fx")?.value || "",
    insertFx: $("kit-insert-fx")?.value || "",
    sliceCount: $("kit-slices")?.value || "",
    selected: kitAudio.selected,
  };
}

function applyKitSnapshot(data) {
  kit.pads = (data.pads || []).map((pad) => ({
    sample: pad.sample || null,
    role: pad.role || "",
    view: pad.view ? { start: pad.view.start, end: pad.view.end } : { start: 0, end: 1 },
  }));
  kit.slices = (data.slices || []).map((slice) => ({ ...slice }));
  if ($("kit-name")) $("kit-name").value = data.name || "";
  if ($("kit-type") && data.type) $("kit-type").value = data.type;
  if ($("kit-return-fx")) $("kit-return-fx").value = data.returnFx || "";
  if ($("kit-insert-fx")) $("kit-insert-fx").value = data.insertFx || "";
  if ($("kit-slices") && data.sliceCount != null && data.sliceCount !== "") {
    $("kit-slices").value = data.sliceCount;
    if ($("slice-count-label")) $("slice-count-label").textContent = data.sliceCount;
  }
  kitAudio.selected = data.selected;
  if (kit.mode === "pads") showPadView(kitAudio.selected);
  syncSliceSeconds();
  renderPads();
  if (kit.mode === "pads") loadKitPadWaveforms();
}

function instrumentCacheKey(item) {
  if (!item) return "";
  if (item.source === "upload") return "upload";
  return `${item.source || ""}:${item.path || ""}`;
}

function rememberInstrumentDevice(item) {
  if (item?.device) fx.instrumentDevices[instrumentCacheKey(item)] = item.device;
}

function snapshotFx() {
  rememberInstrumentDevice(fx.instrument);
  return {
    name: $("fx-name")?.value || "",
    devices: fx.devices.map((item) => ({ kind: item.kind, parameters: { ...item.parameters } })),
    macros: fx.macros.map((slot) => ({ ...slot })),
    instrument: fx.instrument ? {
      name: fx.instrument.name,
      kind: fx.instrument.kind,
      source: fx.instrument.source,
      path: fx.instrument.path || "",
      parameters: { ...(fx.instrument.parameters || {}) },
    } : null,
  };
}

function applyFxSnapshot(data) {
  if ($("fx-name")) $("fx-name").value = data.name || "";
  fx.devices = (data.devices || []).map((item) => ({
    kind: item.kind,
    parameters: { ...(item.parameters || {}) },
  }));
  fx.macros = (data.macros || []).map((slot) => ({ ...slot }));
  while (fx.macros.length < 8) {
    fx.macros.push({ index: fx.macros.length, name: "", device: 0, param: "", min: null, max: null });
  }
  const meta = data.instrument;
  fx.instrument = meta ? {
    ...meta,
    parameters: { ...(meta.parameters || {}) },
    device: fx.instrumentDevices[instrumentCacheKey(meta)] || null,
  } : null;
  syncInstrumentSelect();
  updateInstrumentInfo();
  renderFxAdder();
  renderFxChain();
  updateFxHint();
}

function snapshotEditor(kind) {
  return kind === "kit" ? snapshotKit() : snapshotFx();
}

function applyEditor(kind, data) {
  if (kind === "kit") applyKitSnapshot(data);
  else applyFxSnapshot(data);
}

function beginEditor(kind) {
  editorUndo[kind] = emptyEditorUndo();
  editorUndo[kind].current = JSON.stringify(snapshotEditor(kind));
  editorUndo.fieldStart = null;
}

function commitEditorDiff(kind, before, { coalesce = false } = {}) {
  const stack = editorUndo[kind];
  if (stack.applying) return;
  const after = JSON.stringify(snapshotEditor(kind));
  if (before === after) return;
  if (!coalesce) stack.coalescing = false;
  if (!coalesce || !stack.coalescing) {
    stack.past.push(before);
    if (stack.past.length > 80) stack.past.shift();
    if (coalesce) stack.coalescing = true;
  }
  stack.current = after;
}

function mutateEditor(kind, fn, opts = {}) {
  const before = JSON.stringify(snapshotEditor(kind));
  fn();
  commitEditorDiff(kind, before, opts);
}

function endEditorGesture(kind) {
  const stack = editorUndo[kind];
  stack.coalescing = false;
  if (!stack.applying) stack.current = JSON.stringify(snapshotEditor(kind));
}

function undoInProgressField(kind) {
  const field = kind === "kit" ? $("kit-name") : $("fx-name");
  if (document.activeElement !== field || !editorUndo.fieldStart) return false;
  const now = JSON.stringify(snapshotEditor(kind));
  if (editorUndo.fieldStart === now) return false;
  const stack = editorUndo[kind];
  stack.applying = true;
  applyEditor(kind, JSON.parse(editorUndo.fieldStart));
  stack.applying = false;
  stack.current = editorUndo.fieldStart;
  return true;
}

function undoEditor(kind) {
  const stack = editorUndo[kind];
  endEditorGesture(kind);
  if (undoInProgressField(kind)) return true;
  const prev = stack.past.pop();
  if (!prev) return false;
  stack.applying = true;
  applyEditor(kind, JSON.parse(prev));
  stack.current = prev;
  stack.applying = false;
  return true;
}

function nativeTextUndoTarget(target) {
  const el = target?.closest?.("input, textarea");
  if (!el) return false;
  if (el.id === "kit-name" || el.id === "fx-name") return false;
  const type = (el.type || "text").toLowerCase();
  if (["range", "checkbox", "radio", "file", "number", "color"].includes(type)) return false;
  return true;
}

async function performUndo() {
  if ($("kit")?.open && undoEditor("kit")) {
    toast("Undid kit change");
    return;
  }
  if ($("fx")?.open && undoEditor("fx")) {
    toast("Undid rack change");
    return;
  }
  try {
    const result = await apiJson("/api/undo", {});
    toast(`Undid ${result.label}`, "ok");
    await load();
    refreshStorage();
  } catch (error) {
    toast(error.message, "error");
  }
}

function emptyFxMacros() {
  return Array.from({ length: 8 }, (_, index) => ({
    index, name: "", device: 0, param: "", min: null, max: null,
  }));
}

function fxOffset() {
  return fx.mode === "preset" && fx.instrument ? 1 : 0;
}

function fxItemAt(deviceIndex) {
  const offset = fxOffset();
  if (offset && deviceIndex === 0) return fx.instrument;
  return fx.devices[deviceIndex - offset] || null;
}

function fxMappableParams(spec) {
  return (spec?.params || []).filter((p) => p.id !== "Enabled" && p.type !== "enum");
}

function fxMacroFor(deviceIndex, paramId) {
  return (fx.macros || []).find((slot) => slot.param === paramId && slot.device === deviceIndex);
}

function fxParamSpec(kind, paramId) {
  return (fxSpec(kind)?.params || []).find((p) => p.id === paramId);
}

function fxSpec(kind) {
  return (fx.catalog || []).find((item) => item.kind === kind)
    || (fx.instrumentCatalog || []).find((item) => item.kind === kind);
}

function fxSlotsFull() {
  return fx.devices.length >= FX_MAX;
}

function updateFxHint() {
  const hint = $("fx-hint");
  if (!hint) return;
  if (fx.live != null) {
    const slot = fx.macros[fx.live];
    const source = slot ? fxMacroSource(slot) : "";
    const value = slot ? fxMacroValueText(slot) : "";
    hint.textContent = source
      ? `M${slot.index + 1} · ${source} · ${value}`
      : `Turning knob ${(slot?.index ?? 0) + 1}`;
  } else if (fx.arm != null) {
    hint.textContent = `Click a control to map knob ${fx.arm + 1}. Escape cancels.`;
  } else if (fx.mode === "preset" && !fx.instrument) {
    hint.textContent = "Pick a User or Core Library instrument, or upload a preset file.";
  } else if (fx.mode === "preset" && !fx.devices.length) {
    hint.textContent = "Click a knob, then a control on the instrument — or add effects to stack after it.";
  } else if (!fx.devices.length) {
    hint.textContent = "Add devices to the rack, then click a knob to map it.";
  } else if (fxSlotsFull()) {
    hint.textContent = `Rack is full (${FX_MAX}). Remove one to add another.`;
  } else {
    const n = fx.devices.length;
    hint.textContent = fx.mode === "preset"
      ? "Click a knob, then a control on the instrument or an effect to map it."
      : `${n} device${n === 1 ? "" : "s"} in the rack. Drag a mapped knob to turn it, or click then a control to map.`;
  }
}

function renderFxAdder() {
  const row = $("fx-add");
  row.innerHTML = "";
  const full = fxSlotsFull();
  for (const spec of fx.catalog || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = spec.name;
    button.disabled = full;
    button.title = full ? `Rack is full (${FX_MAX})` : `Add ${spec.name}`;
    button.onclick = () => addFxDevice(spec);
    row.append(button);
  }
}

function addFxDevice(spec) {
  if (fxSlotsFull()) {
    updateFxHint();
    return;
  }
  const parameters = Object.fromEntries(spec.params.map((p) => [p.id, p.default]));
  mutateEditor("fx", () => {
    fx.devices.push({ kind: spec.kind, parameters });
  });
  renderFxChain();
}

function fxCard(index) {
  return document.querySelector(`[data-fx-index="${index}"]`);
}

function redrawFxViz(index) {
  const item = fxItemAt(index);
  const card = fxCard(index);
  if (!item || !card || !window.FxViz) return;
  card.querySelectorAll("canvas.fx-viz").forEach((canvas) => window.FxViz.draw(canvas, item));
}

function syncFxControl(index, id, value) {
  const wrap = fxCard(index)?.querySelector(`[data-fx-param="${id}"]`);
  if (!wrap) return;
  const box = wrap.querySelector('input[type="checkbox"]');
  if (box) box.checked = Boolean(value);
  const select = wrap.querySelector("select");
  if (select) select.value = value;
  const slider = wrap.querySelector('input[type="range"]');
  const number = wrap.querySelector('input[type="number"]');
  if (slider) slider.value = value;
  if (number) number.value = value;
}

function setFxParam(index, id, value, fromViz) {
  const item = fxItemAt(index);
  if (!item) return;
  if (!item.parameters) item.parameters = {};
  if (item.parameters[id] === value) return;
  mutateEditor("fx", () => {
    item.parameters[id] = value;
  }, { coalesce: Boolean(fromViz) || fx.scrubbing });
  syncFxControl(index, id, value);
  redrawFxViz(index);
  updateFxKnobDials();
  if (fx.live != null && fx.macros[fx.live]?.device === index) {
    updateFxLiveCaption(fx.macros[fx.live]);
  }
}

function renderFxControl(index, spec) {
  const wrap = document.createElement("div");
  const mappable = spec.id !== "Enabled" && spec.type !== "enum";
  wrap.className = `fx-param ${spec.type}${mappable ? " mappable" : ""}`;
  wrap.dataset.fxParam = spec.id;
  const label = document.createElement("span");
  label.className = "fx-param-label";
  label.textContent = spec.unit ? `${spec.label} (${spec.unit})` : spec.label;
  const mapped = fxMacroFor(index, spec.id);
  if (mapped) {
    const badge = document.createElement("span");
    badge.className = "fx-m";
    badge.textContent = `M${mapped.index + 1}`;
    label.append(badge);
  }
  wrap.append(label);
  if (mappable) {
    wrap.addEventListener("click", (event) => {
      if (fx.arm == null) return;
      event.preventDefault();
      event.stopPropagation();
      mapArmedMacro(index, spec);
    }, true);
  }

  const value = fxItemAt(index)?.parameters?.[spec.id];
  if (spec.type === "bool") {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(value);
  box.onchange = () => setFxParam(index, spec.id, box.checked);
    wrap.append(box);
    return wrap;
  }
  if (spec.type === "enum") {
    const select = document.createElement("select");
    for (const choice of spec.choices) {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      if (choice === value) option.selected = true;
      select.append(option);
    }
    select.onchange = () => setFxParam(index, spec.id, select.value);
    wrap.append(select);
    return wrap;
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = spec.min;
  slider.max = spec.max;
  slider.step = spec.step;
  slider.value = value;
  const number = document.createElement("input");
  number.type = "number";
  number.min = spec.min;
  number.max = spec.max;
  number.step = spec.step;
  number.value = value;
  const sync = (raw, live) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(spec.min, Math.min(spec.max, n));
    slider.value = clamped;
    number.value = clamped;
    setFxParam(index, spec.id, clamped, live);
  };
  slider.oninput = () => sync(slider.value, true);
  number.onchange = () => sync(number.value);
  wrap.append(slider, number);
  return wrap;
}

function renderFxParamGroup(index, specs, className) {
  const params = document.createElement("div");
  params.className = `fx-params ${className || ""}`;
  for (const spec of specs) params.append(renderFxControl(index, spec));
  return params;
}

function instrumentSourceLabel(item) {
  if (!item) return "";
  if (item.source === "factory") return "Core Library";
  if (item.source === "upload") return "Uploaded";
  return "Presets";
}

function renderFxCard(index, item, { locked = false } = {}) {
  const spec = fxSpec(item.kind);
  const card = document.createElement("div");
  card.className = locked ? "fx-card fx-instrument-card" : "fx-card";
  card.dataset.fxIndex = String(index);
  card.dataset.fxKind = item.kind;
  const head = document.createElement("div");
  head.className = "fx-card-head";
  const title = document.createElement("strong");
  title.textContent = locked
    ? (fx.instrument?.name || spec?.name || item.kind)
    : (spec?.name || item.kind);
  const on = document.createElement("label");
  on.className = "fx-on";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = item.parameters?.Enabled !== false;
  box.onchange = () => setFxParam(index, "Enabled", box.checked);
  on.append(box, document.createTextNode("On"));
  head.append(title, on);
  if (locked) {
    const meta = document.createElement("span");
    meta.className = "fx-instrument-meta";
    meta.textContent = [spec?.name || item.kind, instrumentSourceLabel(fx.instrument)].filter(Boolean).join(" · ");
    head.append(meta);
  } else {
    const offset = fxOffset();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.onclick = () => {
      mutateEditor("fx", () => {
        fx.devices.splice(index - offset, 1);
        dropFxMacroDevice(index);
      });
      renderFxChain();
    };
    if (fx.devices.length > 1) {
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "Up";
      up.disabled = index <= offset;
      up.onclick = () => moveFxDevice(index, -1);
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "Down";
      down.disabled = index >= offset + fx.devices.length - 1;
      down.onclick = () => moveFxDevice(index, 1);
      head.append(up, down);
    }
    head.append(remove);
  }

  const body = document.createElement("div");
  body.className = "fx-device fx-device-live";
  const layout = window.FxViz?.sections
    ? window.FxViz.sections(item.kind, spec?.params || [])
    : [{ id: "all", name: "Parameters", viz: null, params: (spec?.params || []).filter((p) => p.id !== "Enabled") }];
  const grid = document.createElement("div");
  grid.className = "fx-sections";
  const solo = layout.length === 1;
  for (const section of layout) grid.append(renderFxSection(index, section, { solo }));
  body.append(grid);
  card.append(head, body);
  return card;
}

function renderFxPlot(index, plot) {
  const vizWrap = document.createElement("div");
  vizWrap.className = "fx-viz-wrap";
  if (plot.label) {
    const tag = document.createElement("div");
    tag.className = "fx-plot-name";
    tag.textContent = plot.label;
    vizWrap.append(tag);
  }
  const canvas = document.createElement("canvas");
  canvas.className = "fx-viz";
  canvas.dataset.fxViz = plot.viz;
  if (plot.map) canvas.dataset.fxMap = plot.map;
  if (plot.interactive === false) canvas.dataset.fxStatic = "1";
  canvas.width = 640;
  canvas.height = 220;
  if (plot.caption) canvas.title = plot.caption;
  const cap = document.createElement("div");
  cap.className = "fx-viz-cap";
  cap.dataset.idle = plot.caption || "";
  vizWrap.append(canvas, cap);
  if (window.FxViz) {
    window.FxViz.bind(canvas, () => fxItemAt(index), (id, value) => setFxParam(index, id, value, true));
  }
  return vizWrap;
}

function fxSectionPlots(section) {
  if (section.plots?.length) {
    return section.plots.map((plot) => ({
      ...plot,
      label: plot.caption || "",
      caption: plot.caption || "",
    }));
  }
  if (!section.viz) return [];
  return [{
    viz: section.viz,
    map: section.map,
    interactive: section.interactive,
    caption: section.caption || "",
  }];
}

function renderFxSection(index, section, { solo = false } = {}) {
  const plots = fxSectionPlots(section);
  const wrap = document.createElement("details");
  wrap.className = [
    "fx-section",
    section.open ? "main" : "folded",
    plots.length ? "has-viz" : "",
    plots.length > 1 ? "multi-plot" : "",
    solo ? "solo" : "",
  ].filter(Boolean).join(" ");
  wrap.open = Boolean(section.open) || solo;
  const name = document.createElement("summary");
  name.className = "fx-section-name";
  name.textContent = section.name;
  wrap.append(name);
  const body = document.createElement("div");
  body.className = "fx-section-body";
  if (plots.length) {
    const plotGrid = document.createElement("div");
    plotGrid.className = plots.length > 1 ? "fx-plots" : "fx-plots single";
    for (const plot of plots) plotGrid.append(renderFxPlot(index, plot));
    body.append(plotGrid);
  }
  if (section.params?.length) body.append(renderFxParamGroup(index, section.params, "section"));
  wrap.append(body);
  wrap.addEventListener("toggle", () => {
    if (!wrap.open) return;
    redrawFxViz(index);
    requestAnimationFrame(() => redrawFxViz(index));
  });
  return wrap;
}

function renderFxChain() {
  const chain = $("fx-chain");
  if (fx.resizeObs) fx.resizeObs.disconnect();
  chain.innerHTML = "";
  chain.className = "fx-chain";
  const offset = fxOffset();
  if (offset) {
    const instItem = {
      kind: fx.instrument.kind,
      parameters: fx.instrument.parameters || {},
    };
    chain.append(renderFxCard(0, instItem, { locked: true }));
    if (fx.devices.length) {
      const flow = document.createElement("div");
      flow.className = "fx-slot-flow";
      flow.setAttribute("aria-hidden", "true");
      chain.append(flow);
    }
  }
  if (!fx.devices.length) {
    const empty = document.createElement("div");
    empty.className = "fx-empty";
    empty.innerHTML = fx.mode === "preset"
      ? "<strong>No effects yet</strong><span>Add effects to stack after the instrument. Macros map onto the instrument and those effects.</span>"
      : "<strong>Empty rack</strong><span>Add an effect above. The whole chain saves as one device on Move.</span>";
    chain.append(empty);
  } else {
    fx.devices.forEach((item, index) => {
      if (index) {
        const flow = document.createElement("div");
        flow.className = "fx-slot-flow";
        flow.setAttribute("aria-hidden", "true");
        chain.append(flow);
      }
      chain.append(renderFxCard(index + offset, item));
    });
  }

  if (!fx.resizeObs) {
    fx.resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cardEl = entry.target.closest("[data-fx-index]");
        if (cardEl) redrawFxViz(Number(cardEl.dataset.fxIndex));
      }
    });
  }
  chain.querySelectorAll("[data-fx-index]").forEach((cardEl) => {
    const index = Number(cardEl.dataset.fxIndex);
    cardEl.querySelectorAll("canvas.fx-viz").forEach((canvas) => fx.resizeObs.observe(canvas));
    redrawFxViz(index);
    requestAnimationFrame(() => redrawFxViz(index));
  });
  renderFxAdder();
  updateFxHint();
  renderFxMacros();
}

function moveFxDevice(index, delta) {
  const offset = fxOffset();
  const next = index + delta;
  if (index < offset || next < offset || next >= offset + fx.devices.length) return;
  const a = index - offset;
  const b = next - offset;
  mutateEditor("fx", () => {
    [fx.devices[a], fx.devices[b]] = [fx.devices[b], fx.devices[a]];
    swapFxMacroDevices(index, next);
  });
  renderFxChain();
}

function swapFxMacroDevices(a, b) {
  for (const slot of fx.macros) {
    if (slot.device === a) slot.device = b;
    else if (slot.device === b) slot.device = a;
  }
}

function dropFxMacroDevice(index) {
  for (const slot of fx.macros) {
    if (slot.device === index) {
      slot.param = "";
      slot.name = "";
      slot.min = null;
      slot.max = null;
      slot.device = 0;
    } else if (slot.device > index) {
      slot.device -= 1;
    }
  }
}

function applyFxMacroParam(slot, deviceIndex, paramId) {
  slot.device = deviceIndex;
  slot.param = paramId;
  const item = fxItemAt(deviceIndex);
  const spec = item ? fxParamSpec(item.kind, paramId) : null;
  if (!spec) {
    slot.name = "";
    slot.min = null;
    slot.max = null;
    return;
  }
  if (!slot.name) slot.name = spec.label;
  if (spec.type === "bool") {
    slot.min = 0;
    slot.max = 1;
  } else {
    if (slot.min == null) slot.min = spec.min;
    if (slot.max == null) slot.max = spec.max;
  }
}

function fillFxMacrosFromDevice(deviceIndex) {
  const item = fxItemAt(deviceIndex);
  const spec = fxSpec(item?.kind);
  const knobs = spec?.knobs || fxMappableParams(spec).map((p) => p.id);
  const used = new Set(fx.macros.filter((s) => s.param).map((s) => `${s.device}:${s.param}`));
  for (const paramId of knobs) {
    const empty = fx.macros.find((s) => !s.param);
    if (!empty) return;
    const key = `${deviceIndex}:${paramId}`;
    if (used.has(key)) continue;
    const param = fxParamSpec(item.kind, paramId);
    if (!param || param.type === "enum") continue;
    applyFxMacroParam(empty, deviceIndex, paramId);
    used.add(key);
  }
}

function fillFxMacrosFromChain() {
  mutateEditor("fx", () => {
    fx.arm = null;
    fx.macros = emptyFxMacros();
    if (fxOffset()) fillFxMacrosFromDevice(0);
    fx.devices.forEach((_, index) => fillFxMacrosFromDevice(index + fxOffset()));
  });
  renderFxChain();
}

function fxMacroPosition(slot) {
  if (!slot.param) return 0;
  const item = fxItemAt(slot.device);
  const spec = item ? fxParamSpec(item.kind, slot.param) : null;
  if (!spec) return 0;
  const value = item.parameters?.[slot.param];
  if (spec.type === "bool") return value ? 1 : 0;
  const lo = slot.min ?? spec.min;
  const hi = slot.max ?? spec.max;
  if (hi === lo || value == null) return 0;
  return Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo)));
}

function fxKnobRotation(slot) {
  return -135 + fxMacroPosition(slot) * 270;
}

function fxFormatValue(spec, value) {
  if (spec.type === "bool") return value ? "On" : "Off";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const step = Number(spec.step);
  let text;
  if (step >= 1) text = String(Math.round(n));
  else {
    const abs = Math.abs(n);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    text = n.toFixed(digits);
  }
  return spec.unit ? `${text} ${spec.unit}` : text;
}

function fxMacroValueText(slot) {
  if (!slot.param) return "";
  const item = fxItemAt(slot.device);
  const spec = item ? fxParamSpec(item.kind, slot.param) : null;
  if (!spec) return "";
  return fxFormatValue(spec, item.parameters?.[slot.param]);
}

function snapFxValue(spec, lo, hi, value) {
  if (spec.type === "bool") return value >= 0.5;
  let n = Number(value);
  if (!Number.isFinite(n)) n = lo;
  const step = Number(spec.step);
  if (step > 0 && Number.isFinite(step)) {
    n = Math.round(n / step) * step;
    const decimals = Math.min(6, (String(step).split(".")[1] || "").length);
    n = Number(n.toFixed(decimals || 4));
  }
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return Math.max(a, Math.min(b, n));
}

function setFxMacroPosition(slot, pos) {
  if (!slot.param) return;
  const item = fxItemAt(slot.device);
  const spec = item ? fxParamSpec(item.kind, slot.param) : null;
  if (!item || !spec) return;
  const t = Math.max(0, Math.min(1, Number(pos) || 0));
  if (spec.type === "bool") setFxParam(slot.device, slot.param, t >= 0.5);
  else {
    const lo = slot.min ?? spec.min;
    const hi = slot.max ?? spec.max;
    setFxParam(slot.device, slot.param, snapFxValue(spec, lo, hi, lo + t * (hi - lo)));
  }
  if (fx.live === slot.index) updateFxHint();
}

function fxParamEl(deviceIndex, paramId) {
  return fxCard(deviceIndex)?.querySelector(`[data-fx-param="${paramId}"]`);
}

function updateFxLiveCaption(slot) {
  const item = fxItemAt(slot.device);
  const spec = item ? fxParamSpec(item.kind, slot.param) : null;
  const cap = fxParamEl(slot.device, slot.param)?.closest(".fx-section")?.querySelector(".fx-viz-cap")
    || fxCard(slot.device)?.querySelector(".fx-viz-cap");
  if (!cap || !spec) return;
  cap.textContent = `${spec.label}  ${fxMacroValueText(slot)}`;
}

function restoreFxCaption(slot) {
  const cap = slot
    ? (fxParamEl(slot.device, slot.param)?.closest(".fx-section")?.querySelector(".fx-viz-cap")
      || fxCard(slot.device)?.querySelector(".fx-viz-cap"))
    : null;
  if (cap) cap.textContent = cap.dataset.idle || "";
}

function clearFxLive() {
  window.clearTimeout(fx.liveTimer);
  fx.liveTimer = 0;
  const previous = fx.live != null ? fx.macros[fx.live] : null;
  document.querySelectorAll(".fx-param.live, .fx-card.live, .fx-viz-wrap.live, .fx-section.live, .fx-knob.turning").forEach((el) => {
    el.classList.remove("live", "turning");
  });
  $("fx")?.classList.remove("scrubbing");
  if (previous) restoreFxCaption(previous);
  fx.live = null;
}

function showFxLive(slot, opts) {
  if (!slot?.param) return;
  window.clearTimeout(fx.liveTimer);
  fx.liveTimer = 0;
  if (fx.live !== slot.index) {
    const previous = fx.live != null ? fx.macros[fx.live] : null;
    document.querySelectorAll(".fx-param.live, .fx-card.live, .fx-viz-wrap.live, .fx-section.live, .fx-knob.turning").forEach((el) => {
      el.classList.remove("live", "turning");
    });
    if (previous && previous !== slot) restoreFxCaption(previous);
  }
  fx.live = slot.index;
  $("fx")?.classList.add("scrubbing");
  const card = fxCard(slot.device);
  const wrap = fxParamEl(slot.device, slot.param);
  card?.classList.add("live");
  wrap?.classList.add("live");
  const section = wrap?.closest(".fx-section");
  section?.classList.add("live");
  (section?.querySelector(".fx-viz-wrap") || card?.querySelector(".fx-viz-wrap"))?.classList.add("live");
  document.querySelector(`[data-fx-knob="${slot.index}"]`)?.classList.add("turning");
  const more = wrap?.closest("details.fx-section, details.fx-more");
  if (more) more.open = true;
  if (opts?.scroll) wrap?.scrollIntoView({ block: "nearest", inline: "nearest" });
  updateFxLiveCaption(slot);
  updateFxHint();
}

function fadeFxLive() {
  window.clearTimeout(fx.liveTimer);
  fx.liveTimer = window.setTimeout(() => {
    if (fx.scrubbing) return;
    clearFxLive();
    updateFxHint();
  }, 420);
}

function fxMacroSource(slot) {
  if (!slot.param) return "";
  const item = fxItemAt(slot.device);
  const spec = item ? fxParamSpec(item.kind, slot.param) : null;
  const device = item ? (fxSpec(item.kind)?.name || item.kind) : "";
  return spec ? `${device} · ${spec.label}` : device;
}

function clearFxMacro(slot) {
  mutateEditor("fx", () => {
    slot.param = "";
    slot.name = "";
    slot.min = null;
    slot.max = null;
    slot.device = 0;
  });
}

function setFxArm(index) {
  fx.arm = fx.arm === index ? null : index;
  $("fx").classList.toggle("mapping", fx.arm != null);
  renderFxMacros();
  updateFxHint();
}

function mapArmedMacro(deviceIndex, spec) {
  if (fx.arm == null) return;
  if (spec.id === "Enabled" || spec.type === "enum") {
    toast("That control cannot be mapped", "error");
    return;
  }
  const slot = fx.macros[fx.arm];
  mutateEditor("fx", () => {
    for (const other of fx.macros) {
      if (other !== slot && other.device === deviceIndex && other.param === spec.id) {
        other.param = "";
        other.name = "";
        other.min = null;
        other.max = null;
        other.device = 0;
      }
    }
    slot.name = "";
    slot.min = null;
    slot.max = null;
    applyFxMacroParam(slot, deviceIndex, spec.id);
    fx.arm = null;
  });
  $("fx").classList.remove("mapping");
  renderFxChain();
}

function updateFxKnobDials() {
  for (const slot of fx.macros) {
    const el = document.querySelector(`[data-fx-knob="${slot.index}"]`);
    if (!el) continue;
    el.style.setProperty("--rot", `${fxKnobRotation(slot)}deg`);
    el.style.setProperty("--pos", String(fxMacroPosition(slot)));
    const readout = el.querySelector(".fx-knob-val");
    if (readout) readout.textContent = slot.param ? fxMacroValueText(slot) : "";
    if (slot.param) {
      el.setAttribute("aria-valuenow", String(Math.round(fxMacroPosition(slot) * 1000) / 1000));
    } else {
      el.removeAttribute("aria-valuenow");
    }
  }
}

function disarmFxKnobs() {
  fx.arm = null;
  $("fx")?.classList.remove("mapping");
  document.querySelectorAll(".fx-knob.armed").forEach((el) => el.classList.remove("armed"));
}

function bindFxKnobGestures(wrap, slot) {
  let clickTimer = 0;
  let pointer = null;

  wrap.onpointerdown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".fx-knob-name")) return;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pos: fxMacroPosition(slot),
      moved: false,
    };
    try { wrap.setPointerCapture(event.pointerId); } catch { /* tests / older browsers */ }
    if (slot.param) showFxLive(slot, { scroll: true });
  };

  wrap.onpointermove = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved && (dx * dx + dy * dy) < 25) return;
    pointer.moved = true;
    if (!slot.param) return;
    event.preventDefault();
    window.clearTimeout(clickTimer);
    if (fx.arm != null) disarmFxKnobs();
    fx.scrubbing = true;
    const scale = event.shiftKey ? 420 : 128;
    setFxMacroPosition(slot, pointer.pos + (-dy + dx * 0.28) / scale);
    showFxLive(slot, { scroll: true });
  };

  const endPointer = (event) => {
    if (!pointer || (event && event.pointerId !== pointer.id)) return;
    const moved = pointer.moved;
    pointer = null;
    fx.scrubbing = false;
    try { wrap.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (moved) {
      window.clearTimeout(clickTimer);
      fadeFxLive();
      return;
    }
    if (slot.param) fadeFxLive();
    else clearFxLive();
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => setFxArm(slot.index), 200);
  };
    wrap.onpointerup = endPointer;
    wrap.onpointercancel = endPointer;
    wrap.onpointerenter = () => {
      if (fx.scrubbing || fx.arm != null || !slot.param) return;
      showFxLive(slot);
    };
    wrap.onpointerleave = () => {
      if (fx.scrubbing || fx.live !== slot.index) return;
      fadeFxLive();
    };

  wrap.ondblclick = (event) => {
    event.preventDefault();
    window.clearTimeout(clickTimer);
    fx.scrubbing = false;
    clearFxMacro(slot);
    if (fx.arm === slot.index) fx.arm = null;
    renderFxChain();
  };
  wrap.oncontextmenu = (event) => {
    event.preventDefault();
    window.clearTimeout(clickTimer);
    fx.scrubbing = false;
    clearFxMacro(slot);
    if (fx.arm === slot.index) fx.arm = null;
    renderFxChain();
  };
  wrap.onkeydown = (event) => {
    if (event.target.closest(".fx-knob-name")) return;
    const nudge = event.shiftKey ? 0.012 : 0.045;
    if (slot.param && (event.key === "ArrowUp" || event.key === "ArrowRight")) {
      event.preventDefault();
      showFxLive(slot, { scroll: true });
      setFxMacroPosition(slot, fxMacroPosition(slot) + nudge);
      fadeFxLive();
      return;
    }
    if (slot.param && (event.key === "ArrowDown" || event.key === "ArrowLeft")) {
      event.preventDefault();
      showFxLive(slot, { scroll: true });
      setFxMacroPosition(slot, fxMacroPosition(slot) - nudge);
      fadeFxLive();
      return;
    }
    if (slot.param && event.key === "Home") {
      event.preventDefault();
      showFxLive(slot, { scroll: true });
      setFxMacroPosition(slot, 0);
      fadeFxLive();
      return;
    }
    if (slot.param && event.key === "End") {
      event.preventDefault();
      showFxLive(slot, { scroll: true });
      setFxMacroPosition(slot, 1);
      fadeFxLive();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFxArm(slot.index);
    }
  };
}

function renderFxMacros() {
  const row = $("fx-macros");
  if (!row) return;
  row.innerHTML = "";
  $("fx").classList.toggle("mapping", fx.arm != null);
  fx.macros.forEach((slot) => {
    const wrap = document.createElement("div");
    wrap.className = "fx-knob"
      + (slot.param ? " mapped" : "")
      + (fx.arm === slot.index ? " armed" : "")
      + (fx.live === slot.index ? " turning" : "");
    wrap.dataset.fxKnob = String(slot.index);
    wrap.style.setProperty("--rot", `${fxKnobRotation(slot)}deg`);
    wrap.style.setProperty("--pos", String(fxMacroPosition(slot)));
    wrap.tabIndex = 0;
    if (slot.param) {
      wrap.setAttribute("role", "slider");
      wrap.setAttribute("aria-valuemin", "0");
      wrap.setAttribute("aria-valuemax", "1");
      wrap.setAttribute("aria-valuenow", String(Math.round(fxMacroPosition(slot) * 1000) / 1000));
      wrap.setAttribute("aria-label", `Macro ${slot.index + 1} ${slot.name || fxMacroSource(slot)}`);
      wrap.title = `${fxMacroSource(slot)}. Drag to turn, click to remap, double-click to clear.`;
    } else {
      wrap.setAttribute("role", "button");
      wrap.setAttribute("aria-label", `Macro ${slot.index + 1}, unmapped`);
      wrap.title = "Click, then click a control to map this knob.";
    }

    const dial = document.createElement("div");
    dial.className = "fx-knob-dial";
    const arc = document.createElement("span");
    arc.className = "fx-knob-arc";
    const notch = document.createElement("span");
    notch.className = "fx-knob-notch";
    const num = document.createElement("span");
    num.className = "fx-knob-n";
    num.textContent = String(slot.index + 1).padStart(2, "0");
    dial.append(arc, notch, num);

    const value = document.createElement("span");
    value.className = "fx-knob-val";
    value.textContent = slot.param ? fxMacroValueText(slot) : "";

    const name = document.createElement("input");
    name.type = "text";
    name.className = "fx-knob-name";
    name.maxLength = 24;
    name.placeholder = "—";
    name.value = slot.name;
    name.onclick = (event) => event.stopPropagation();
    name.ondblclick = (event) => event.stopPropagation();
    name.onpointerdown = (event) => event.stopPropagation();
    name.oninput = () => {
      mutateEditor("fx", () => { slot.name = name.value; }, { coalesce: true });
    };
    name.onblur = () => endEditorGesture("fx");

    bindFxKnobGestures(wrap, slot);

    wrap.append(dial, value, name);
    row.append(wrap);
  });
}

async function openFxBuilder() {
  try {
    await showFxDialog({ name: "My Effect", devices: [], macros: [], path: "", folder: "" });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openFxEditor(path) {
  try {
    await ensureFxCatalog();
    const data = await api(`/api/effects/load?path=${encodeURIComponent(path)}`);
    await showFxDialog({
      name: data.name,
      devices: data.devices || [],
      macros: data.macros || [],
      path: data.path || path,
      folder: data.folder || "",
    });
    if (data.skipped?.length) {
      toast(`Skipped ${data.skipped.length} unknown device${data.skipped.length === 1 ? "" : "s"}`, "error");
    }
    if (data.truncated) toast(`Only the first ${FX_MAX} devices can be edited`, "error");
  } catch (error) {
    toast(error.message, "error");
  }
}

function applyFxMacros(entries) {
  fx.macros = emptyFxMacros();
  for (const entry of entries || []) {
    const index = Number(entry.index);
    if (!Number.isInteger(index) || index < 0 || index > 7 || !entry.param) continue;
    fx.macros[index] = {
      index,
      name: entry.name || "",
      device: Number(entry.device) || 0,
      param: entry.param,
      min: entry.min ?? null,
      max: entry.max ?? null,
    };
  }
}

async function showFxDialog({ name, devices, macros, path, folder, mode, instrument }) {
  await ensureFxCatalog();
  fx.mode = mode === "preset" ? "preset" : "effect";
  if (fx.mode === "preset") await ensureInstrumentCatalog();
  fx.instrument = instrument ? {
    ...instrument,
    parameters: { ...(instrument.parameters || {}) },
  } : null;
  rememberInstrumentDevice(fx.instrument);
  fx.devices = (devices || []).map((item) => ({
    kind: item.kind,
    parameters: { ...(item.parameters || {}) },
  }));
  applyFxMacros(macros);
  fx.arm = null;
  fx.scrubbing = false;
  fx.editPath = path || "";
  fx.editFolder = folder || "";
  clearFxLive();
  $("fx").classList.remove("mapping");
  $("fx-name").value = name || (fx.mode === "preset" ? "My Preset" : "My Effect");
  $("fx-name").placeholder = fx.mode === "preset" ? "My Preset" : "My Effect";
  $("fx-save").textContent = fx.editPath ? "Save changes" : "Save to Move";
  $("fx-instrument").hidden = fx.mode !== "preset";
  updateFxHint();
  renderFxAdder();
  renderFxChain();
  $("fx").showModal();
  beginEditor("fx");
  if (fx.mode === "preset") {
    await populateInstrumentSelect();
    syncInstrumentSelect();
    updateInstrumentInfo();
  }
}

function resetFxEditor() {
  fx.arm = null;
  fx.scrubbing = false;
  fx.editPath = "";
  fx.editFolder = "";
  fx.mode = "effect";
  fx.instrument = null;
  fx.instrumentDevices = {};
  clearFxLive();
  $("fx-save").textContent = "Save to Move";
  $("fx-instrument").hidden = true;
}

function fxPayload(output) {
  const base = {
    name: $("fx-name").value.trim(),
    folder: fx.editPath ? fx.editFolder : (state.kind === "presets" || state.kind === "effects" ? destFolder() : ""),
    replace: fx.editPath || "",
    output,
    devices: fx.devices.map((item) => ({ kind: item.kind, parameters: item.parameters })),
    macros: fx.macros
      .filter((slot) => slot.param)
      .map((slot) => ({
        index: slot.index,
        name: slot.name,
        device: slot.device,
        param: slot.param,
        min: slot.min,
        max: slot.max,
      })),
  };
  if (fx.mode === "preset") {
    base.instrument = fx.instrument?.source === "upload"
      ? { source: "upload", path: "", preset: fx.instrument.device, parameters: { ...(fx.instrument.parameters || {}) } }
      : { source: fx.instrument?.source || "presets", path: fx.instrument?.path || "", preset: null, parameters: { ...(fx.instrument?.parameters || {}) } };
  }
  return base;
}

function instrumentChoiceValue(item) {
  return `${item.source}:${item.path}`;
}

async function populateInstrumentSelect() {
  const select = $("fx-instrument-select");
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  try {
    try {
      const data = await api("/api/presets/instruments");
      fx.instruments = data.instruments || [];
    } catch (error) {
      fx.instruments = [];
      toast(error.message, "error");
    }
    const current = fx.instrument && fx.instrument.source !== "upload" && fx.instrument.path
      ? instrumentChoiceValue(fx.instrument)
      : "";
    select.innerHTML = "";
    select.append(kitFxOption("", "Pick an instrument…", !current && fx.instrument?.source !== "upload"));
    const groups = [
      { source: "presets", label: "User library" },
      { source: "factory", label: "Core Library" },
    ];
    for (const group of groups) {
      const items = fx.instruments.filter((item) => item.source === group.source);
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      if (!items.length) {
        const empty = kitFxOption("", group.source === "factory" ? "No Core Library instruments" : "No user presets", false);
        empty.disabled = true;
        optgroup.append(empty);
      } else {
        for (const item of items) {
          optgroup.append(kitFxOption(instrumentChoiceValue(item), item.label || item.name, instrumentChoiceValue(item) === current));
        }
      }
      select.append(optgroup);
    }
    if (fx.instrument?.source === "upload") {
      const uploaded = kitFxOption("upload:", fx.instrument.name || "Uploaded instrument", true);
      select.append(uploaded);
    }
    syncInstrumentSelect();
  } finally {
    select.onchange = onchange;
  }
}

function syncInstrumentSelect() {
  const select = $("fx-instrument-select");
  if (!select) return;
  if (fx.instrument?.source === "upload") {
    select.value = "upload:";
    return;
  }
  select.value = fx.instrument?.path ? instrumentChoiceValue(fx.instrument) : "";
}

function updateInstrumentInfo() {
  const info = $("fx-instrument-info");
  if (!info) return;
  if (!fx.instrument) {
    info.textContent = "";
    return;
  }
  info.textContent = `${instrumentSourceLabel(fx.instrument)} · ${fx.instrument.kind}`;
}

function applyLoadedInstrument(data, { keepName = false } = {}) {
  mutateEditor("fx", () => {
    fx.instrument = {
      name: data.name,
      kind: data.kind,
      source: data.source,
      path: data.path || "",
      device: data.instrument,
      parameters: { ...(data.parameters || {}) },
    };
    rememberInstrumentDevice(fx.instrument);
    fx.devices = (data.effects || []).map((item) => ({
      kind: item.kind,
      parameters: { ...(item.parameters || {}) },
    }));
    applyFxMacros(data.macros || []);
    const currentName = $("fx-name")?.value || "";
    if (!keepName && data.name && !currentName) $("fx-name").value = data.name;
  });
  updateInstrumentInfo();
  updateFxHint();
  renderFxAdder();
  renderFxChain();
}

async function loadInstrumentChoice(value) {
  if (!value) {
    mutateEditor("fx", () => {
      fx.instrument = null;
      fx.devices = [];
      applyFxMacros([]);
    });
    updateInstrumentInfo();
    updateFxHint();
    renderFxChain();
    return;
  }
  if (value === "upload:") return;
  const split = value.indexOf(":");
  const source = value.slice(0, split);
  const path = value.slice(split + 1);
  const data = await api(`/api/presets/load?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`);
  applyLoadedInstrument(data);
  syncInstrumentSelect();
}

async function openPresetBuilder() {
  try {
    await showFxDialog({
      mode: "preset",
      name: "My Preset",
      devices: [],
      macros: [],
      path: "",
      folder: destFolder(),
      instrument: null,
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openPresetEditor(path) {
  try {
    await ensureFxCatalog();
    await ensureInstrumentCatalog();
    const data = await api(`/api/presets/load?source=presets&path=${encodeURIComponent(path)}`);
    await showFxDialog({
      mode: "preset",
      name: data.name,
      devices: data.effects || [],
      macros: data.macros || [],
      path: data.path || path,
      folder: data.folder || "",
      instrument: {
        name: data.name,
        kind: data.kind,
        source: data.source,
        path: data.path || path,
        device: data.instrument,
        parameters: { ...(data.parameters || {}) },
      },
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

$("btn-fx").onclick = openFxBuilder;
$("btn-fx-edit").onclick = () => {
  const [path] = [...state.selected];
  if (path) openFxEditor(path);
};
$("btn-preset").onclick = openPresetBuilder;
$("btn-preset-edit").onclick = () => {
  const [path] = [...state.selected];
  if (path) openPresetEditor(path);
};
$("fx-instrument-select").onchange = async () => {
  try {
    await loadInstrumentChoice($("fx-instrument-select").value);
  } catch (error) {
    toast(error.message, "error");
  }
};
$("fx-instrument-upload").onclick = () => $("fx-instrument-file").click();
$("fx-instrument-file").onchange = async () => {
  const file = $("fx-instrument-file").files?.[0];
  $("fx-instrument-file").value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const preset = JSON.parse(text);
    const data = await apiJson("/api/presets/parse", { preset });
    applyLoadedInstrument(data);
    await populateInstrumentSelect();
  } catch (error) {
    toast(error.message || "Could not read that preset", "error");
  }
};
$("fx-cancel").onclick = () => {
  resetFxEditor();
  $("fx").close();
};
$("fx-name").addEventListener("focus", () => {
  editorUndo.fieldStart = JSON.stringify(snapshotFx());
});
$("fx-name").addEventListener("blur", () => {
  if (editorUndo.fieldStart) commitEditorDiff("fx", editorUndo.fieldStart);
  editorUndo.fieldStart = null;
});
$("fx").addEventListener("close", resetFxEditor);
$("fx").addEventListener("cancel", (event) => {
  if (fx.arm == null && !fx.scrubbing && fx.live == null) return;
  event.preventDefault();
  fx.arm = null;
  fx.scrubbing = false;
  clearFxLive();
  $("fx").classList.remove("mapping");
  renderFxMacros();
  updateFxHint();
});
$("fx-macros-fill").onclick = fillFxMacrosFromChain;

function fxBuildUrl() {
  return fx.mode === "preset" ? "/api/presets/build" : "/api/effects/build";
}

function fxValidatePayload(payload) {
  if (!payload.name) return fx.mode === "preset" ? "Give the preset a name first" : "Give the effect a name first";
  if (fx.mode === "preset" && !fx.instrument) return "Pick an instrument first";
  if (fx.mode !== "preset" && !payload.devices.length) return "Add at least one effect";
  return "";
}

$("fx-save").onclick = async () => {
  const payload = fxPayload("device");
  const problem = fxValidatePayload(payload);
  if (problem) {
    $("fx-hint").textContent = problem;
    return;
  }
  try {
    const result = await apiJson(fxBuildUrl(), payload);
    $("fx").close();
    toast(`Saved ${result.name}`, "ok");
    if (!result.refreshed) {
      toast("Saved, but library refresh failed — restart Move to see it", "error");
    }
    if (state.kind === "effects" || state.kind === "presets") await load();
    refreshStorage();
  } catch (error) {
    $("fx-hint").textContent = error.message;
  }
};

$("fx-download").onclick = async () => {
  const payload = fxPayload("file");
  const problem = fxValidatePayload(payload);
  if (problem) {
    $("fx-hint").textContent = problem;
    return;
  }
  try {
    const response = await fetch(fxBuildUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `failed (${response.status})`);
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${payload.name}.ablpreset`;
    link.click();
    URL.revokeObjectURL(link.href);
    $("fx").close();
    toast(fx.mode === "preset" ? "Preset downloaded" : "Effect downloaded", "ok");
  } catch (error) {
    $("fx-hint").textContent = error.message;
  }
};

/* ---------- boot ---------- */

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() !== "z") return;
  if (nativeTextUndoTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  performUndo();
}, true);

window.addEventListener("pointerup", () => {
  endEditorGesture("fx");
  endEditorGesture("kit");
});
window.addEventListener("pointercancel", () => {
  endEditorGesture("fx");
  endEditorGesture("kit");
});

document.querySelector(".tab").classList.add("active");
if ($("storage")) {
  $("storage").addEventListener("click", () => refreshStorage());
  $("storage").title = "Click to refresh storage";
}
loadStatus().then(() => {
  load();
  refreshStorage();
});
