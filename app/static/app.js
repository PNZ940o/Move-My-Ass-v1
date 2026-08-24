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

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `${response.status} ${response.statusText}`);
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
  const progress = options.progress;
  const { ctx, width, height } = sizeCanvas(canvas, options.width, options.height);
  ctx.clearRect(0, 0, width, height);

  const lo = Math.floor(start * peaks.length);
  const hi = Math.max(lo + 1, Math.ceil(end * peaks.length));
  const slice = peaks.slice(lo, hi);
  const mid = height / 2;
  const gap = slice.length > width ? 0 : 0.35;
  const bar = Math.max(1, width / slice.length);
  const playedX = Number.isFinite(progress) ? progress * width : -1;
  const played = options.played || "rgba(255, 61, 245, 0.95)";
  const rest = options.color || "rgba(0, 229, 255, 0.82)";

  for (let i = 0; i < slice.length; i++) {
    const amp = slice[i];
    const h = Math.max(1.2, amp * (height - 4) * 0.92);
    const x = i * bar;
    ctx.fillStyle = playedX >= 0 && x < playedX ? played : rest;
    ctx.fillRect(x, mid - h / 2, Math.max(0.8, bar - gap), h);
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
      const x = Math.round(Math.max(0, Math.min(width - 1, bounds[i] * width)));
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

function renderRows() {
  rows.innerHTML = "";
  $("empty").hidden = state.items.length > 0;
  $("empty").textContent = isFactory()
    ? "Nothing here — this account may not be able to read CoreLibrary."
    : "This folder is empty. Drop files here to upload.";
  appendTree(state.items, 0);
  renderSelection();
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
  const audioSection = !factory && (state.kind === "samples" || state.kind === "recordings");
  $("btn-upload").hidden = factory;
  $("btn-upload-folder").hidden = factory;
  $("btn-mkdir").hidden = factory;
  $("btn-mkdir").disabled = factory;
  $("btn-kit").hidden = !audioSection;
  $("btn-kit").disabled = !audioSection;
  $("btn-slice").hidden = !audioSection;
  $("btn-slice").disabled = !(audioSection && only?.category === "audio" && only.name.toLowerCase().endsWith(".wav"));
  $("toolbar-kit").hidden = !audioSection;
  $("btn-rename").hidden = factory;
  $("btn-delete").hidden = factory;
  $("btn-copy").hidden = !factory;
  $("btn-copy").disabled = !factory || count === 0;
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
  if (internalMove || isFactory()) return;
  dragDepth++;
  drop.classList.add("dragging");
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (internalMove) event.dataTransfer.dropEffect = "move";
});
drop.addEventListener("dragleave", () => {
  if (internalMove) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove("dragging");
  }
});
drop.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  drop.classList.remove("dragging");
  if (internalMove) return;
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
    const result = await apiJson("/api/copy-to-samples", { kind: "factory", items });
    const count = result.copied.length;
    if (count) toast(`Copied ${count} into Samples/${result.dest}`, "ok");
    for (const failure of (result.failed || []).slice(0, 3)) {
      toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
    }
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
  const row = rows.querySelector(`tr[data-path="${CSS.escape(item.path)}"]`);
  const nameEl = row?.querySelector("button.name");
  if (nameEl) startInlineRename(item, nameEl);
};

$("btn-delete").onclick = async () => {
  const items = [...state.selected];
  if (!confirm(`Delete ${items.length} item${items.length === 1 ? "" : "s"} from Move?`)) return;
  try {
    const result = await apiJson("/api/delete", { kind: state.kind, items });
    toast(`Deleted ${result.removed.length}`, result.failed.length ? "error" : "ok");
    await load();
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

const kit = { mode: "pads", folder: "", section: "samples", available: [], pads: [], sample: null, duration: 0, slices: [], peaks: [] };

function renderPads() {
  const grid = $("padgrid");
  grid.innerHTML = "";

  for (let index = 0; index < 16; index++) {
    const cell = document.createElement("div");
    cell.className = "pad";

    const head = document.createElement("div");
    head.className = "pad-head";
    head.innerHTML = `<span>${index + 1}</span>`;

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
        kit.pads[index].sample = select.value || null;
        renderPads();
      };
      cell.append(head, select);
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
    grid.append(cell);
  }
  requestAnimationFrame(drawKitWaves);
}

function drawKitWaves() {
  const overview = $("kit-overview");
  if (!overview) return;
  const show = kit.mode === "slices" && kit.peaks.length && !$("kit-slice-controls").hidden;
  overview.hidden = !show;
  if (show) {
    const canvas = overview.querySelector("canvas");
    drawWaveform(canvas, kit.peaks, {
      slices: kit.slices,
      activeBoundary: sliceEdit.boundary,
    });
    waveResize.observe(overview);
  }
  waveResize.observe($("padgrid"));
  for (const canvas of $("padgrid").querySelectorAll("canvas.wave-pad")) {
    drawWaveform(canvas, kit.peaks, {
      start: Number(canvas.dataset.start),
      end: Number(canvas.dataset.end),
    });
  }
}

const MIN_SLICE = 0.004;
const sliceEdit = { boundary: null };

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

function nearestSliceBoundary(xNorm, pxWidth) {
  const points = sliceBoundaryPositions();
  if (!points.length) return null;
  const threshold = Math.max(0.012, 10 / Math.max(1, pxWidth));
  let best = null;
  let bestDist = threshold;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(xNorm - points[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function applySliceVisuals() {
  const pads = $("padgrid").children;
  kit.slices.forEach((slice, index) => {
    const cell = pads[index];
    if (!cell) return;
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
  });
  drawKitWaves();
}

function overviewX(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / Math.max(1, rect.width),
    width: rect.width,
  };
}

function bindSliceEditor() {
  const canvas = $("kit-overview")?.querySelector("canvas");
  if (!canvas || canvas.dataset.sliceBound) return;
  canvas.dataset.sliceBound = "1";

  canvas.addEventListener("pointerdown", (event) => {
    if (kit.mode !== "slices" || $("kit-overview").hidden) return;
    const { x, width } = overviewX(event, canvas);
    const boundary = nearestSliceBoundary(x, width);
    if (boundary == null) return;
    event.preventDefault();
    event.stopPropagation();
    sliceEdit.boundary = boundary;
    canvas.classList.add("dragging");
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    setSliceBoundary(boundary, x);
    applySliceVisuals();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (kit.mode !== "slices" || $("kit-overview").hidden) return;
    const { x, width } = overviewX(event, canvas);
    if (sliceEdit.boundary != null) {
      event.preventDefault();
      setSliceBoundary(sliceEdit.boundary, x);
      applySliceVisuals();
      return;
    }
    canvas.style.cursor = nearestSliceBoundary(x, width) != null ? "ew-resize" : "default";
  });
  const endDrag = (event) => {
    if (sliceEdit.boundary == null) return;
    sliceEdit.boundary = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
    applySliceVisuals();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

function resetKitEffects() {
  $("kit-return-fx").value = "reverb";
  $("kit-insert-fx").value = "saturator";
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
    kit.pads = plan.pads;

    if (!plan.available.length) {
      toast("No audio files in this folder", "error");
      return;
    }
    $("kit-title").textContent = `Build kit from ${plan.folder || plan.section}`;
    $("kit-name").value = (plan.folder.split("/").pop() || "New") + " Kit";
    $("kit-slice-controls").hidden = true;
    $("kit-overview").hidden = true;
    kit.peaks = [];
    resetKitEffects();
    const placed = plan.pads.filter((p) => p.sample).length;
    $("kit-hint").textContent =
      `${placed} of 16 pads filled from ${plan.available.length} samples` +
      (plan.unplaced.length ? ` · ${plan.unplaced.length} didn't fit` : "");
    renderPads();
    $("kit").showModal();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadSlicePlan() {
  const count = Number($("kit-slices").value);
  $("slice-count-label").textContent = count;
  try {
    const plan = await apiJson("/api/kit/plan-slices", { sample: kit.sample, count, section: kit.section });
    kit.duration = plan.duration;
    kit.slices = plan.slices;
    const fromPreview = preview.peaks?.length && previewUrl({ path: kit.sample }) === preview.url;
    kit.peaks = plan.peaks?.length ? plan.peaks : fromPreview ? preview.peaks : [];
    $("kit-slice-info").textContent =
      `${plan.duration.toFixed(2)}s sample · ${(plan.duration / count).toFixed(3)}s per slice`;
    renderPads();
  } catch (error) {
    $("kit-slice-info").textContent = error.message;
    kit.slices = [];
    kit.peaks = [];
    renderPads();
  }
}

async function openKitFromSample() {
  const [path] = [...state.selected];
  kit.mode = "slices";
  kit.sample = path;
  kit.section = state.kind;
  kit.folder = "";
  $("kit-title").textContent = `Slice ${path.split("/").pop()}`;
  $("kit-name").value = path.split("/").pop().replace(/\.[^.]+$/, "") + " Slices";
  $("kit-slice-controls").hidden = false;
  $("kit-hint").textContent =
    "Drag the magenta markers to move start and end. Neighbours stay joined — no audio is cut.";
  resetKitEffects();
  await loadSlicePlan();
  $("kit").showModal();
  bindSliceEditor();
  requestAnimationFrame(() => requestAnimationFrame(drawKitWaves));
}

$("kit-slices").oninput = () => {
  $("slice-count-label").textContent = $("kit-slices").value;
};
$("kit-slices").onchange = loadSlicePlan;

$("btn-kit").onclick = openKitFromFolder;
$("btn-slice").onclick = openKitFromSample;
$("kit-cancel").onclick = () => $("kit").close();

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

/* ---------- boot ---------- */

document.querySelector(".tab").classList.add("active");
loadStatus().then(load);
