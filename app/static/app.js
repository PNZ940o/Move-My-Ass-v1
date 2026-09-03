const state = {
  kind: "samples",
  path: "",
  items: [],
  selected: new Set(),
  selectedPad: null,
  rangeAnchor: null,
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
  recordings: "recordings",
  sets: "sets",
  presets: "presets",
  effects: "effects",
  factory: "factory",
  other: "other",
};

const STORAGE_ORDER = ["samples", "sets", "presets", "factory"];
const STORAGE_NEST = {
  samples: ["recordings"],
  presets: ["effects"],
};

let lastStorage = null;

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
  lastStorage = data;
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
  if ($("storage-detail")?.open) renderStorageDetail(data);
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

function storageCountLabel(count, unit) {
  const n = Number(count) || 0;
  if (n === 1) return `1 ${unit}`;
  return `${n} ${unit}s`;
}

function fillStorageBar(bar, data) {
  if (!bar) return;
  bar.innerHTML = "";
  const total = Number(data.total) || 0;
  const used = Number(data.used) || 0;
  const free = Number(data.free) || Math.max(0, total - used);
  if (total <= 0) return;
  const segments = [...(data.categories || []), { id: "free", label: "Free", bytes: free }];
  for (const category of segments) {
    const bytes = Number(category.bytes) || 0;
    let width = (bytes / total) * 100;
    if (bytes > 0 && width < 0.7) width = 0.7;
    const seg = document.createElement("span");
    seg.className = `storage-seg ${category.id}`;
    seg.style.width = `${width}%`;
    seg.title = `${category.label} ${formatStorageSize(bytes)}`;
    bar.append(seg);
  }
}

function storageLibraries(data) {
  const byId = {};
  for (const item of data.libraries || []) byId[item.id] = item;
  if (!data.libraries?.length) {
    for (const category of data.categories || []) {
      if (category.id !== "other") {
        byId[category.id] = { id: category.id, label: category.label, unit: "item", bytes: category.bytes, count: 0 };
      }
      for (const part of category.parts || []) {
        byId[part.id] = { id: part.id, label: part.label, unit: "item", bytes: part.bytes, count: 0 };
      }
    }
  }
  const rows = [];
  for (const id of STORAGE_ORDER) {
    const item = byId[id];
    if (!item) continue;
    rows.push(item);
    for (const childId of STORAGE_NEST[id] || []) {
      const child = byId[childId];
      if (child) rows.push({ ...child, child: true });
    }
  }
  return rows;
}

function renderStorageDetail(data) {
  const summary = $("storage-detail-summary");
  const rows = $("storage-detail-rows");
  const hint = $("storage-detail-hint");
  if (!summary || !rows) return;
  const total = Number(data.total) || 0;
  const used = Number(data.used) || 0;
  const free = Number(data.free) || Math.max(0, total - used);
  const pct = total ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  summary.textContent = total
    ? `${formatStorageSize(used)} used of ${formatStorageSize(total)} · ${formatStorageSize(free)} free · ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% full`
    : "Storage is not available yet.";
  fillStorageBar($("storage-detail-bar"), data);
  rows.innerHTML = "";
  const libraries = storageLibraries(data);
  for (const item of libraries) {
    const tr = document.createElement("tr");
    const bytes = Number(item.bytes) || 0;
    const count = Number(item.count) || 0;
    if (item.child) tr.classList.add("child");
    if (!bytes && !count) tr.classList.add("empty");
    const name = document.createElement("td");
    const label = document.createElement("span");
    label.className = "label";
    const swatch = document.createElement("i");
    swatch.className = STORAGE_COLORS[item.id] || "other";
    label.append(swatch, document.createTextNode(item.label));
    name.append(label);
    const items = document.createElement("td");
    items.className = "n";
    items.textContent = storageCountLabel(count, item.unit || "item");
    const size = document.createElement("td");
    size.className = "n";
    size.textContent = formatStorageSize(bytes);
    tr.append(name, items, size);
    rows.append(tr);
  }
  const extras = [];
  for (const category of data.categories || []) {
    for (const part of category.parts || []) {
      if (libraries.some((item) => item.id === part.id)) continue;
      extras.push(`${part.label} ${formatStorageSize(part.bytes)}`);
    }
  }
  if (hint) {
    hint.textContent = extras.length
      ? `Also on disk: ${extras.join(" · ")}`
      : "These numbers come from the folders on Move.";
  }
}

function openStorageDetail() {
  const dialog = $("storage-detail");
  if (!dialog) return;
  if (lastStorage) renderStorageDetail(lastStorage);
  else if ($("storage-detail-summary")) $("storage-detail-summary").textContent = "Measuring storage…";
  if (!dialog.open) dialog.showModal();
  refreshStorage();
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

let connStatus = null;
let connBusy = false;

function applyStatus(status) {
  connStatus = status;
  const isMock = status.mode !== "sftp";
  $("conn-dot").className = `dot ${isMock ? "mock" : status.connected ? "on" : "off"}`;
  $("conn-text").textContent = isMock
    ? "mock folder"
    : `${status.user}@${status.host}${status.connected ? "" : " (idle)"}`;
  $("conn").title = isMock
    ? "Using mock folder — click to switch device"
    : "Using real Move — click to switch device";
  $("f-backend").value = status.mode;
  $("f-host").value = status.host || "";
  $("f-user").value = status.user || "";
  $("f-key").value = status.key_path || "";
  if (status.last_error) $("settings-hint").textContent = status.last_error;
}

async function loadStatus() {
  try {
    applyStatus(await api("/api/status"));
  } catch (error) {
    $("conn-dot").className = "dot off";
    $("conn-text").textContent = "offline";
    toast(error.message, "error");
  }
}

function closeConnMenu() {
  $("conn-drop")?.classList.remove("open");
  $("conn")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll(".conn-menu").forEach((el) => el.remove());
}

function connMenuItem(backend, title, hint, dotClass, selected) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `drop-item conn-choice${selected ? " on" : ""}`;
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", selected ? "true" : "false");
  const dot = document.createElement("span");
  dot.className = `dot ${dotClass}`;
  const copy = document.createElement("span");
  copy.className = "conn-choice-copy";
  const name = document.createElement("strong");
  name.textContent = title;
  const note = document.createElement("small");
  note.textContent = hint;
  copy.append(name, note);
  item.append(dot, copy);
  item.onclick = () => switchBackend(backend);
  return item;
}

function openConnMenu() {
  const wrap = $("conn-drop");
  const btn = $("conn");
  wrap.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  const menu = document.createElement("div");
  menu.className = "drop-menu conn-menu";
  menu.setAttribute("role", "listbox");
  const status = connStatus || {};
  const host = status.user && status.host ? `${status.user}@${status.host}` : "ableton@move.local";
  menu.append(
    connMenuItem(
      "mock",
      "Mock folder",
      "Local fake device — no hardware needed",
      "mock",
      status.mode === "mock",
    ),
    connMenuItem(
      "sftp",
      host,
      status.connected && status.mode === "sftp" ? "Real Move over SFTP" : "Real Move over SFTP — connect",
      status.connected && status.mode === "sftp" ? "on" : "off",
      status.mode === "sftp",
    ),
  );
  document.body.append(menu);
  const box = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 6)}px`;
  menu.style.left = `${Math.round(box.left)}px`;
  menu.style.maxHeight = `${Math.max(8, window.innerHeight - box.bottom - 8)}px`;
}

async function switchBackend(backend) {
  closeDownMenus();
  const status = connStatus || {};
  if (status.mode === backend && (backend === "mock" || status.connected)) return;
  connBusy = true;
  $("conn").disabled = true;
  $("conn-text").textContent = backend === "mock" ? "opening mock…" : "connecting…";
  try {
    applyStatus(await apiJson("/api/connect", {
      backend,
      host: $("f-host").value,
      user: $("f-user").value,
      key_path: $("f-key").value,
    }));
    toast(backend === "mock" ? "Using mock folder" : "Connected to Move", "ok");
    await load();
    refreshStorage();
  } catch (error) {
    toast(error.message, "error");
    await loadStatus();
  } finally {
    connBusy = false;
    $("conn").disabled = false;
  }
}

$("conn").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (connBusy) return;
  const wrap = $("conn-drop");
  const open = wrap.classList.contains("open");
  closeDownMenus();
  if (!open) openConnMenu();
});

$("btn-settings").onclick = () => $("settings").showModal();

$("settings-form").addEventListener("submit", async (event) => {
  const clicked = event.submitter?.value;
  if (clicked !== "connect") return;
  event.preventDefault();
  const hint = $("settings-hint");
  hint.className = "hint";
  hint.textContent = "Connecting…";
  try {
    applyStatus(await apiJson("/api/connect", {
      backend: $("f-backend").value,
      host: $("f-host").value,
      user: $("f-user").value,
      key_path: $("f-key").value,
    }));
    hint.textContent = "";
    $("settings").close();
    toast("Connected", "ok");
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
  const root = document.createElement("button");
  root.textContent = sectionLabel(state.kind);
  root.title = "Library root";
  if (!parts.length) root.className = "current";
  root.onclick = () => navigate("");
  if (!isFactory()) bindFolderDrop(root, "");
  crumbs.append(root);
  if (!parts.length) return;

  const up = document.createElement("button");
  up.className = "crumb-up";
  up.textContent = "↑";
  up.title = "Up one level";
  const parent = parts.slice(0, -1).join("/");
  up.onclick = () => navigate(parent);
  bindFolderDrop(up, parent);
  crumbs.prepend(up);

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
let fileClipboard = null;

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
  const chosen = chosenItems();
  if (chosen.length === 1) {
    const item = chosen[0];
    if (item.is_dir && item.category !== "set") return item.path;
    return parentPath(item.path);
  }
  if (chosen.length > 1) {
    const parents = new Set(chosen.map((item) => parentPath(item.path)));
    if (parents.size === 1) return [...parents][0];
  }
  return state.path;
}

function pasteDest(clipPaths) {
  let dest = destFolder();
  if (fileClipboard && fileClipboard.kind !== state.kind) return dest;
  const blocked = (clipPaths || []).find((path) => destContainsSource(dest, path));
  if (blocked) dest = parentPath(blocked);
  return dest;
}

function canPasteClipboard(clip) {
  if (!clip?.kind) return false;
  if (clip.kind === state.kind) return true;
  if (clip.mode !== "copy") return false;
  if (clip.kind === "factory" && state.kind === "samples") return true;
  const audio = (kind) => kind === "samples" || kind === "recordings";
  return audio(clip.kind) && audio(state.kind);
}

function revealFolder(path) {
  if (!path) return;
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    state.expanded.add(cur);
    delete state.children[cur];
  }
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

function topLevelPaths(paths) {
  return paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)));
}

function sectionLabel(kind) {
  const tab = document.querySelector(`.tab[data-kind="${kind}"]`);
  return tab?.textContent?.trim() || kind;
}

function isCutPath(path) {
  return Boolean(fileClipboard && fileClipboard.mode === "cut" && fileClipboard.kind === state.kind && fileClipboard.items.some((item) => item.path === path));
}

function nativeClipboardTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function fileClipboardBlocked(target) {
  if (nativeClipboardTarget(target)) return true;
  return Boolean(document.querySelector("dialog[open]"));
}

function clipboardSelection() {
  const chosen = chosenItems();
  const top = new Set(topLevelPaths(chosen.map((item) => item.path)));
  return chosen.filter((item) => top.has(item.path)).map((item) => ({
    path: item.path,
    name: item.name,
    isSet: item.category === "set",
  }));
}

function markClipboardVisuals() {
  for (const row of rows.querySelectorAll("tr[data-path]")) {
    row.classList.toggle("cut", isCutPath(row.dataset.path));
  }
  for (const pad of document.querySelectorAll("#setgrid .set-pad[data-path]")) {
    pad.classList.toggle("cut", isCutPath(pad.dataset.path));
  }
  for (const row of document.querySelectorAll("#set-loose .set-loose-item[data-path]")) {
    row.classList.toggle("cut", isCutPath(row.dataset.path));
  }
}

function copySelection(mode) {
  const items = clipboardSelection();
  if (!items.length) return false;
  if (mode === "cut") {
    if (isFactory()) {
      toast("Core Library is read-only", "error");
      return true;
    }
    if (items.some((item) => item.isSet)) {
      toast("Pad sets stay on the grid", "error");
      return true;
    }
  }
  fileClipboard = { kind: state.kind, mode, items };
  const count = items.length;
  toast(
    `${mode === "cut" ? "Cut" : "Copied"} ${count} item${count === 1 ? "" : "s"}`,
    "ok",
  );
  markClipboardVisuals();
  return true;
}

async function pasteClipboard() {
  const clip = fileClipboard;
  if (!clip?.items?.length) return;
  if (isFactory()) {
    toast("Can't paste into Core Library", "error");
    return;
  }

  const setItems = clip.items.filter((item) => item.isSet);
  const fileItems = clip.items.filter((item) => !item.isSet);

  if (setItems.length) {
    if (clip.mode === "cut") {
      toast("Pad sets stay on the grid", "error");
      return;
    }
    if (state.kind !== "sets" || state.path) {
      toast("Paste sets on the Sets page", "error");
      return;
    }
    await pasteCopiedSets(setItems);
    return;
  }

  if (!canPasteClipboard(clip)) {
    toast(
      clip.mode === "cut"
        ? `Cut items stay in ${sectionLabel(clip.kind)} — copy them to paste here`
        : `Paste in ${sectionLabel(clip.kind)}`,
      "error",
    );
    return;
  }

  const paths = fileItems.map((item) => item.path);
  if (!paths.length) return;
  const dest = pasteDest(paths);
  if (clip.mode === "cut") {
    const result = await moveItems(paths, dest, clip.kind);
    if (!result) return;
    const keep = (result.moved.length ? result.moved : paths).map((path) => {
      const name = path.split("/").filter(Boolean).pop();
      return dest ? `${dest}/${name}` : name;
    });
    // Whatever did not move is still sitting where it was, so leave it on the
    // clipboard instead of stranding it — the user can retry elsewhere.
    const movedPaths = new Set(result.moved || []);
    const stranded = clip.items.filter((item) => !movedPaths.has(item.path));
    fileClipboard = stranded.length ? { ...clip, items: stranded } : null;
    state.selected = new Set(keep);
    renderRows();
    return;
  }
  await copyItems(paths, dest, clip.kind);
}

async function pasteCopiedSets(items) {
  const copied = [];
  const failed = [];
  for (const item of items) {
    try {
      const result = await apiJson("/api/copy-set", { path: item.path });
      copied.push(result.path);
    } catch (error) {
      failed.push({ name: item.name || item.path, error: error.message });
    }
  }
  if (copied.length) toast(`Copied ${copied.length} set${copied.length === 1 ? "" : "s"} off the grid`, failed.length ? "error" : "ok");
  else toast("Could not paste sets", "error");
  for (const failure of failed.slice(0, 3)) toast(`${failure.name}: ${failure.error}`, "error");
  await load();
  refreshStorage();
  if (copied.length) {
    state.selected = new Set(copied);
    renderRows();
  }
}

async function copyItems(paths, dest, sourceKind = state.kind) {
  try {
    const payload = { kind: state.kind, items: paths, dest };
    if (sourceKind !== state.kind) payload.source_kind = sourceKind;
    const result = await apiJson("/api/copy", payload);
    const count = result.copied.length;
    if (count) toast(`Pasted ${count} item${count === 1 ? "" : "s"}`, result.failed.length ? "error" : "ok");
    else toast("Could not paste", "error");
    for (const failure of (result.failed || []).slice(0, 3)) {
      toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
    }
    revealFolder(dest);
    await load();
    refreshStorage();
    if (count) {
      state.selected = new Set(result.copied.map((item) => item.path));
      renderRows();
    }
  } catch (error) {
    toast(error.message, "error");
  }
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
    drop.classList.remove("drop-here");
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
  const slash = (path || "").lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

async function moveItems(paths, dest, kind = state.kind) {
  const moving = paths.filter(
    (path) => path !== dest && parentPath(path) !== dest && !destContainsSource(dest, path),
  );
  if (!moving.length) return { moved: [], failed: [] };
  try {
    const result = await apiJson("/api/move", { kind, items: moving, dest });
    const count = result.moved.length;
    if (count) toast(`Moved ${count} item${count === 1 ? "" : "s"}`, result.failed.length ? "error" : "ok");
    for (const failure of (result.failed || []).slice(0, 3)) {
      toast(`${failure.name.split("/").pop()}: ${failure.error}`, "error");
    }
    revealFolder(dest);
    await load();
    refreshStorage();
    return result;
  } catch (error) {
    toast(error.message, "error");
    return null;
  }
}

/* ---------- audio preview ---------- */

const player = new Audio();
player.preload = "auto";

const previewUrl = (item) =>
  `/api/preview?kind=${state.kind}&path=${encodeURIComponent(item.path)}`;

// Decoding holds the whole file as float samples, several times its size on disk.
// Past this, play it but draw no waveform — a long recording is not worth the
// memory for a picture a few hundred pixels wide.
const PREVIEW_DECODE_LIMIT = 32 * 1024 * 1024;

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
  const played = options.played || "rgba(255, 142, 12, 0.92)";
  const rest = options.color || "rgba(34, 133, 240, 0.82)";
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
        ? "rgba(255, 233, 94, 0.95)"
        : rest;
    ctx.fillRect(x, mid - h / 2, Math.max(0.8, bar - gap), h);
  }

  if (Number.isFinite(hiStart) && Number.isFinite(hiEnd)) {
    const x = ((hiStart - start) / span) * width;
    const w = ((hiEnd - hiStart) / span) * width;
    const left = Math.max(0, x);
    const right = Math.min(width, x + w);
    if (right > left) {
      ctx.fillStyle = "rgba(34, 133, 240, 0.12)";
      ctx.fillRect(left, 0, right - left, height);
    }
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
      ctx.fillStyle = i === active ? "rgba(255, 233, 94, 0.95)" : "rgba(255, 233, 94, 0.65)";
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
      if (bytes.byteLength > PREVIEW_DECODE_LIMIT) throw new Error("too large to decode");
      // The Blob above already took its own copy, so hand the buffer straight over
      // rather than cloning it again — decodeAudioData detaches what it is given.
      const decoded = await getAudioCtx().decodeAudioData(bytes);
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
  if (isCutPath(item.path)) tr.classList.add("cut");

  const check = document.createElement("td");
  check.className = "c-check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.selected.has(item.path);
  box.addEventListener("mousedown", (event) => event.stopPropagation());
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.shiftKey) {
      event.preventDefault();
      selectPath(item.path, event);
      return;
    }
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
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      cancelPendingRename();
      selectPath(item.path, event);
      return;
    }
    const already = state.selected.size === 1 && state.selected.has(item.path);
    state.selected = new Set([item.path]);
    state.rangeAnchor = item.path;
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
    if (event.target.closest("button.name, .name-edit, input[type=checkbox]")) return;
    cancelPendingRename();
    if (event.shiftKey) event.preventDefault();
    selectPath(item.path, event);
  };
  if (isFolder) {
    tr.addEventListener("dblclick", (event) => {
      if (event.target.closest("input[type=checkbox], .fold, .name-edit")) return;
      event.preventDefault();
      cancelPendingRename();
      toggleFolder(item.path);
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
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      return;
    }
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
    drop.classList.remove("reordering", "drop-here");
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
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      selectSetPath(item.path, event);
      return;
    }
    state.selected = new Set([item.path]);
    state.rangeAnchor = item.path;
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
    pad.setAttribute("role", "button");
    pad.tabIndex = 0;
    pad.setAttribute("aria-label", `Empty pad ${num}`);
    pad.onclick = () => {
      if (padDragMoved) return;
      cancelPendingRename();
      selectEmptyPad(num);
    };
    pad.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectEmptyPad(num);
      }
    };
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
    selectSetPath(item.path, event);
  };
  pad.onkeydown = (event) => {
    if (event.target.closest(".name-edit")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectSetPath(item.path, event);
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
  const overlay = document.querySelector(".drop-overlay span");
  if (overlay) overlay.textContent = "Drop to upload here";
}

function renderSetGrid() {
  const grid = $("setgrid");
  const loose = $("set-loose");
  $("drop").classList.add("set-pads");
  document.querySelector("table.listing").hidden = true;
  grid.hidden = false;
  const overlay = document.querySelector(".drop-overlay span");
  if (overlay) overlay.textContent = "Drop a .ablbundle to import";

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
  hint.textContent = "Drop a set from the grid, or a .ablbundle from your PC. Move cannot open off-grid copies until you drop them onto an empty pad.";
  loose.append(hint);
  for (const item of extras) {
    const isSet = item.category === "set";
    const row = document.createElement("div");
    row.className = "set-loose-item" + (isSet ? "" : " folder");
    row.dataset.path = item.path;
    if (isCutPath(item.path)) row.classList.add("cut");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const nameEl = document.createElement("button");
    nameEl.type = "button";
    nameEl.className = "name";
    nameEl.textContent = item.name;
    bindSetName(nameEl, item);
    if (isSet && item.color) {
      row.classList.add("colored");
      row.style.background = item.color;
      row.style.color = inkOn(item.color);
    }
    const date = document.createElement("span");
    date.className = "set-loose-date";
    date.textContent = formatDate(item.mtime);
    row.append(nameEl, date);
    row.onclick = (event) => {
      if (padDragMoved) return;
      if (event.target.closest("button.name, .name-edit")) return;
      cancelPendingRename();
      selectSetPath(item.path, event);
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
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
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

function isSetArchivePath(path) {
  const base = (path || "").replace(/\\/g, "/").split("/").pop() || "";
  if (base.toLowerCase() === "song.abl") return false;
  return /\.(ablbundle|zip|abl)$/i.test(base);
}

function groupSetEntries(entries) {
  const items = entries.map((entry) => ({
    ...entry,
    path: (entry.path || entry.file.name || "").replace(/\\/g, "/").replace(/^\/+/, ""),
  }));
  const songDirs = [];
  const seen = new Set();
  for (const entry of items) {
    if (!/(^|\/)Song\.abl$/i.test(entry.path)) continue;
    const dir = entry.path.replace(/\/?Song\.abl$/i, "");
    if (seen.has(dir)) continue;
    seen.add(dir);
    songDirs.push(dir);
  }
  songDirs.sort((a, b) => b.split("/").filter(Boolean).length - a.split("/").filter(Boolean).length || b.length - a.length);

  const claimed = new Set();
  const groups = [];
  for (const dir of songDirs) {
    const prefix = dir ? `${dir}/` : "";
    const batch = [];
    for (const entry of items) {
      if (claimed.has(entry.path)) continue;
      if (dir) {
        if (entry.path !== `${dir}/Song.abl` && !entry.path.startsWith(prefix)) continue;
      } else if (isSetArchivePath(entry.path)) {
        continue;
      }
      batch.push(entry);
      claimed.add(entry.path);
    }
    if (batch.length) groups.push(batch);
  }
  for (const entry of items) {
    if (claimed.has(entry.path) || !isSetArchivePath(entry.path)) continue;
    groups.push([entry]);
    claimed.add(entry.path);
  }
  return groups;
}

function occupiedSetPads() {
  const occupied = new Set();
  for (const item of state.items) {
    if (item.category === "set" && Number.isInteger(item.pad) && item.pad >= 1 && item.pad <= 32) {
      occupied.add(item.pad);
    }
  }
  return occupied;
}

function emptyPadsFrom(start) {
  const occupied = occupiedSetPads();
  const origin = Number.isInteger(start) && start >= 1 && start <= 32 ? start : 1;
  const pads = [];
  for (let offset = 0; offset < 32; offset++) {
    const num = ((origin - 1 + offset) % 32) + 1;
    if (!occupied.has(num)) pads.push(num);
  }
  return pads;
}

function selectedEmptyPad() {
  return showingSetPads() && Number.isInteger(state.selectedPad) ? state.selectedPad : null;
}

async function importSetEntries(entries, options = {}) {
  if (!entries.length) return;
  const { offGrid = false } = options;
  const pad = options.pad ?? selectedEmptyPad();
  const batches = groupSetEntries(entries);
  if (!batches.length) {
    toast("That isn't a Move set — use a .ablbundle, .zip, or a folder with Song.abl", "error");
    return;
  }
  const imported = [];
  const failures = [];
  const pads = offGrid ? [] : emptyPadsFrom(pad);
  for (const [index, batch] of batches.entries()) {
    setStatus(batches.length > 1 ? `Importing set ${index + 1} of ${batches.length}…` : "Importing set…");
    const sendPad = offGrid ? null : (pads.shift() ?? null);
    try {
      imported.push(...await sendSetImport(batch, { pad: sendPad, offGrid: offGrid || sendPad == null }));
    } catch (error) {
      const label = batch[0]?.path || batch[0]?.file?.name || `set ${index + 1}`;
      failures.push({ name: label.split("/").pop(), error: error.message });
    }
  }
  const onPads = imported.filter((item) => item.pad);
  const off = imported.filter((item) => !item.pad);
  if (imported.length === 1) {
    const item = imported[0];
    if (item.pad) toast(`Imported ${item.name} onto pad ${item.pad}`, "ok");
    else toast(`Imported ${item.name} off the pad grid`, "ok");
  } else if (imported.length) {
    if (onPads.length) {
      toast(`Filled ${onPads.length} empty pad${onPads.length === 1 ? "" : "s"}`, "ok");
    }
    if (off.length) {
      toast(`Saved ${off.length} off the pad grid`, "ok");
    }
  }
  for (const failure of failures.slice(0, 3)) toast(`${failure.name}: ${failure.error}`, "error");
  const keep = imported.length ? imported[imported.length - 1].path : null;
  await load();
  refreshStorage();
  if (keep) {
    state.selected = new Set([keep]);
    renderRows();
  }
  setStatus("Ready");
}

function sendSetImport(entries, { pad, offGrid }) {
  const form = new FormData();
  if (offGrid) form.append("off_grid", "true");
  else if (Number.isInteger(pad)) form.append("pad", String(pad));
  for (const entry of entries) {
    form.append("files", entry.file, entry.file.name);
    form.append("relpaths", entry.path || entry.file.name);
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/import-set");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setStatus(`Importing… ${Math.round((event.loaded / event.total) * 100)}%`);
      }
    };
    request.onload = () => {
      let body = {};
      try { body = JSON.parse(request.responseText); } catch {}
      if (request.status >= 200 && request.status < 300) resolve(body.imported || []);
      else reject(new Error(body.detail || `import failed (${request.status})`));
    };
    request.onerror = () => reject(new Error("network error during import"));
    request.send(form);
  });
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
  state.selectedPad = null;
  if (on) state.selected.add(path);
  else state.selected.delete(path);
  state.rangeAnchor = path;
  highlightSelection();
}

function selectOnly(path) {
  state.selectedPad = null;
  state.selected = new Set([path]);
  state.rangeAnchor = path;
  highlightSelection();
}

function selectEmptyPad(num) {
  state.selected.clear();
  state.rangeAnchor = null;
  state.selectedPad = state.selectedPad === num ? null : num;
  highlightSelection();
}

function selectableGroups() {
  if (showingSetPads()) {
    const pads = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        const num = (3 - row) * 8 + col + 1;
        const el = document.querySelector(`#setgrid .set-pad[data-pad="${num}"][data-path]`);
        if (el?.dataset.path) pads.push(el.dataset.path);
      }
    }
    const loose = [...document.querySelectorAll("#set-loose .set-loose-item[data-path]")].map(
      (el) => el.dataset.path,
    );
    return [pads, loose];
  }
  return [visibleItems().map((item) => item.path)];
}

function selectPath(path, event = {}, options = {}) {
  state.selectedPad = null;
  const additive = Boolean(options.additive) || event.ctrlKey || event.metaKey;
  const groups = selectableGroups();
  const group = groups.find((list) => list.includes(path) && list.includes(state.rangeAnchor));
  if (event.shiftKey && group) {
    const a = group.indexOf(state.rangeAnchor);
    const b = group.indexOf(path);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = group.slice(lo, hi + 1);
    state.selected = additive ? new Set([...state.selected, ...range]) : new Set(range);
  } else if (additive) {
    if (state.selected.has(path)) state.selected.delete(path);
    else state.selected.add(path);
    state.rangeAnchor = path;
  } else {
    state.selected = new Set([path]);
    state.rangeAnchor = path;
  }
  highlightSelection();
}

function selectSetPath(path, event) {
  selectPath(path, event);
}

let selectionStamp = null;

function currentSelectionStamp() {
  return `${[...state.selected].sort().join("\n")}\0${state.selectedPad ?? ""}`;
}

function closeOrphanPreview() {
  if (!preview.url) return;
  if ([...state.selected].some((path) => previewUrl({ path }) === preview.url)) return;
  const url = preview.url;
  stopPlayback();
  for (const row of rows.querySelectorAll("tr[data-path]")) {
    if (previewUrl({ path: row.dataset.path }) !== url) continue;
    row.classList.remove("previewing", "playing");
    row.querySelector(".wave-player")?.remove();
    row.querySelector(".playbtn")?.classList.remove("loading", "on");
    break;
  }
  syncPlayButtons();
}

function highlightSelection() {
  const stamp = currentSelectionStamp();
  const selectionChanged = selectionStamp !== null && stamp !== selectionStamp;
  selectionStamp = stamp;
  if (selectionChanged) closeOrphanPreview();
  for (const row of rows.querySelectorAll("tr[data-path]")) {
    const on = state.selected.has(row.dataset.path);
    row.classList.toggle("selected", on);
    const box = row.querySelector("input[type=checkbox]");
    if (box) box.checked = on;
  }
  for (const pad of document.querySelectorAll("#setgrid .set-pad")) {
    const pathOn = pad.dataset.path && state.selected.has(pad.dataset.path);
    const emptyOn = !pad.dataset.path && Number(pad.dataset.pad) === state.selectedPad;
    pad.classList.toggle("selected", Boolean(pathOn || emptyOn));
  }
  for (const row of document.querySelectorAll("#set-loose .set-loose-item[data-path]")) {
    row.classList.toggle("selected", state.selected.has(row.dataset.path));
  }
  markClipboardVisuals();
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
  const padTarget = selectedEmptyPad();
  $("selcount").textContent = padTarget
    ? `Pad ${padTarget}`
    : count ? `${count} selected` : "";
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
  const setsRoot = showingSetPads();
  const only = count === 1 ? itemByPath([...state.selected][0]) : null;
  const samplesSection = !factory && state.kind === "samples";
  const recordingsSection = !factory && state.kind === "recordings";
  const audioSection = samplesSection || recordingsSection;
  $("btn-upload").hidden = factory;
  $("btn-upload").textContent = setsRoot ? "Upload set" : "Upload files";
  $("btn-upload").title = setsRoot && padTarget
    ? `Upload onto pad ${padTarget}`
    : "";
  $("btn-upload-folder").hidden = factory;
  $("btn-upload-folder").title = setsRoot
    ? padTarget
      ? `Fill from pad ${padTarget}; extras go off the 32-pad grid`
      : "Fill empty pads; extras go off the 32-pad grid"
    : "Upload a folder of files";
  $("btn-mkdir").hidden = factory || setsRoot;
  $("btn-mkdir").disabled = factory || setsRoot;
  const kitFolder = Boolean(audioSection && only?.is_dir && only.category !== "set");
  $("btn-kit").hidden = !audioSection;
  $("btn-kit").disabled = !audioSection;
  $("btn-kit").classList.toggle("on", kitFolder);
  $("btn-slice").hidden = !samplesSection;
  $("btn-slice").disabled = !(samplesSection && only?.category === "audio" && only.name.toLowerCase().endsWith(".wav"));
  $("toolbar-kit").hidden = !audioSection;
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
  state.selectedPad = null;
  const items = visibleItems();
  state.selected = event.target.checked ? new Set(items.map((i) => i.path)) : new Set();
  state.rangeAnchor = event.target.checked ? items.at(-1)?.path ?? null : null;
  highlightSelection();
};

let loadGen = 0;
let shownSetWarnings = "";

async function load() {
  const gen = ++loadGen;
  setStatus("Loading…");
  try {
    const data = await api(`/api/list?kind=${state.kind}&path=${encodeURIComponent(state.path)}`);
    if (gen !== loadGen) return;
    state.items = data.items;
    // A refresh after an upload or a delete should not cost the user their
    // selection, so keep every path that is still here. Navigating elsewhere
    // clears it anyway, because none of the new paths match.
    const present = new Set(data.items.map((item) => item.path));
    for (const path of [...state.selected]) {
      if (!present.has(path)) state.selected.delete(path);
    }
    if (!state.selected.has(state.rangeAnchor)) state.rangeAnchor = null;
    state.selectedPad = null;
    if (state.kind === "sets" && !state.path) {
      state.setLabels = Object.fromEntries(
        data.items.filter((i) => i.category === "set").map((i) => [i.path, i.name])
      );
      // Only announce these when they change. Otherwise every trip back to Sets
      // re-toasts the same pad collision.
      const warnings = data.warnings || [];
      const signature = JSON.stringify(warnings);
      if (signature !== shownSetWarnings) {
        for (const warning of warnings) toast(warning, "error");
        shownSetWarnings = signature;
      }
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
  if (showingSetPads()) {
    await importSetEntries(entries);
    return;
  }
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

$("btn-upload").onclick = () => {
  if (showingSetPads()) $("set-file-input").click();
  else $("file-input").click();
};
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
$("set-file-input").onchange = (event) => {
  importSetEntries(fromInput(event.target));
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

function listingRowHit(event) {
  return event.target.closest("tr[data-path], .set-pad, .set-loose-item, .name-edit");
}

function clearListingSelection(event) {
  if (listingRowHit(event)) return;
  if (event.target.closest("button, input, a, dialog, .toolbar")) return;
  cancelPendingRename();
  if (!state.selected.size && state.selectedPad == null) return;
  state.selected.clear();
  state.selectedPad = null;
  state.rangeAnchor = null;
  highlightSelection();
}

drop.addEventListener("click", clearListingSelection);

drop.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (internalMove || internalSetCopy || isFactory()) return;
  dragDepth++;
  drop.classList.add("dragging");
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (internalMove) {
    const overFolder = event.target.closest("tr.folder, .crumbs button, .crumb-up");
    const here = state.path;
    const canLand = internalMove.paths.some(
      (path) => path !== here && parentPath(path) !== here && !destContainsSource(here, path),
    );
    if (overFolder || !canLand) {
      drop.classList.remove("drop-here");
      if (!overFolder) event.dataTransfer.dropEffect = "none";
    } else {
      event.dataTransfer.dropEffect = "move";
      drop.classList.add("drop-here");
    }
    return;
  }
  if (internalSetCopy) event.dataTransfer.dropEffect = "copy";
});
drop.addEventListener("dragleave", (event) => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("drop-here");
  if (internalMove || internalSetCopy) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove("dragging");
  }
});
drop.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  drop.classList.remove("dragging", "drop-here");
  if (internalSetCopy) return;
  if (internalMove) {
    if (event.target.closest("tr.folder")) return;
    const { paths } = internalMove;
    internalMove = null;
    if (isFactory() || showingSetPads()) return;
    await moveItems(paths, state.path);
    return;
  }
  if (isFactory()) {
    toast("Factory library is read-only — copy items into Samples", "error");
    return;
  }
  if (showingSetPads()) {
    const entries = await collectDropped(event.dataTransfer);
    const hit = setDropFromPoint(event.clientX, event.clientY);
    if (hit?.kind === "filled-pad") {
      toast(`Pad ${hit.pad} already has a set`, "error");
      return;
    }
    await importSetEntries(entries, {
      pad: hit?.kind === "empty-pad" ? hit.pad : null,
      offGrid: hit?.kind === "offgrid",
    });
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
    // Navigating to the URL would replace the whole app with a raw error page
    // whenever the download fails, so fetch it and keep failures in a toast.
    const item = chosen[0];
    try {
      const response = await fetch(
        `/api/download?kind=${state.kind}&path=${encodeURIComponent(item.path)}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `failed (${response.status})`);
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = item.name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      toast(error.message, "error");
    }
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

const kit = { mode: "pads", folder: "", section: "samples", available: [], pads: [], sample: null, duration: 0, slices: [], peaks: [], hiPeaks: [], fxPresets: [] };

const KIT_PAD_KEYS = ["z", "x", "c", "v", "a", "s", "d", "f", "q", "w", "e", "r", "1", "2", "3", "4"];
const KIT_KEY_INDEX = Object.fromEntries(KIT_PAD_KEYS.map((key, index) => [key, index]));
const kitAudio = {
  buffers: new Map(),
  peaks: new Map(),
  voices: [],
  held: new Set(),
  pointers: new Map(),
  playGen: 0,
  selected: null,
  live: null,
  raf: 0,
};

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
  const pad = kit.pads[index];
  if (!pad?.sample) return null;
  const trim = kitPadTrim(index);
  return { path: kitSamplePath(pad.sample), start: trim.start, length: trim.length };
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

function stopKitVoice(voice) {
  if (!voice || voice.stopping) return;
  voice.stopping = true;
  const ctx = audioCtx;
  if (ctx && voice.gain) {
    const now = ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      voice.source.stop(now + 0.018);
      return;
    } catch { /* fall through */ }
  }
  try { voice.source.stop(); } catch { /* already stopped */ }
}

function stopKitPlayback() {
  for (const voice of kitAudio.voices) stopKitVoice(voice);
  kitAudio.voices = [];
  kitAudio.held.clear();
  kitAudio.pointers.clear();
  kitAudio.live = null;
  cancelAnimationFrame(kitAudio.raf);
  kitAudio.raf = 0;
  syncKitPadChrome();
}

function stopKitPad(index) {
  kitAudio.held.delete(index);
  for (const [pointerId, pad] of [...kitAudio.pointers]) {
    if (pad === index) kitAudio.pointers.delete(pointerId);
  }
  for (const voice of kitAudio.voices) {
    if (voice.index === index) stopKitVoice(voice);
  }
}

function resetKitAudio() {
  stopKitPlayback();
  kitAudio.playGen += 1;
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

function kitPadTrim(index) {
  const pad = kit.pads[index];
  if (!pad) return { start: 0, length: 1 };
  const start = Math.max(0, Math.min(1, Number(pad.trim?.start) || 0));
  const length = Math.max(MIN_SLICE, Math.min(1 - start, Number.isFinite(pad.trim?.length) ? pad.trim.length : 1));
  pad.trim = { start, length };
  return pad.trim;
}

function padTrimPoints(index) {
  const trim = kitPadTrim(index);
  return [trim.start, trim.start + trim.length];
}

function setPadTrimBoundary(edge, position) {
  if (kit.mode !== "pads" || kitAudio.selected == null) return;
  mutateEditor(() => {
    const trim = kitPadTrim(kitAudio.selected);
    const end = trim.start + trim.length;
    position = Math.max(0, Math.min(1, position));
    if (edge <= 0) {
      trim.start = Math.min(position, end - MIN_SLICE);
      trim.length = end - trim.start;
    } else {
      trim.length = Math.max(MIN_SLICE, position - trim.start);
    }
  }, { coalesce: true });
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
  return buffer ? `${(spec.length * buffer.duration).toFixed(2)}s` : "";
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
  for (let index = 0; index < 16; index++) {
    if (!$("kit").open) return;
    if (!kitPadSource(index)) continue;
    await loadKitPadWaveform(index);
  }
}

function startKitVoice(index, buffer, startNorm, lengthNorm) {
  hushListingPlayer();
  if (kitType() === "choke") {
    for (const voice of kitAudio.voices) stopKitVoice(voice);
  }
  const ctx = getAudioCtx();
  const offset = Math.max(0, Math.min(buffer.duration, startNorm * buffer.duration));
  const dur = Math.max(0.02, Math.min(buffer.duration - offset, lengthNorm * buffer.duration));
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(ctx.destination);
  const voice = { source, gain, index, startedAt: ctx.currentTime, offset, dur, buffer };
  kitAudio.voices.push(voice);
  while (kitAudio.voices.length > 16) {
    stopKitVoice(kitAudio.voices.shift());
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
  const gen = ++kitAudio.playGen;
  const gated = kitType() === "gate";
  try {
    const buffer = await kitAudioBuffer(spec.path);
    if (!$("kit").open) return;
    if (kitType() === "choke" && gen !== kitAudio.playGen) return;
    if (gated && !kitAudio.held.has(index)) return;
    startKitVoice(index, buffer, spec.start, spec.length);
  } catch (error) {
    toast(error.message, "error");
  }
}

function noteOnKitPad(index, pointerId, target) {
  if (kitType() === "gate") {
    kitAudio.held.add(index);
    if (pointerId != null) {
      kitAudio.pointers.set(pointerId, index);
      try { target?.setPointerCapture?.(pointerId); } catch { /* unsupported */ }
    }
  }
  playKitPad(index);
}

function noteOffKitPad(index) {
  if (kitType() !== "gate") return;
  stopKitPad(index);
}

function releaseKitPointer(event) {
  const index = kitAudio.pointers.get(event.pointerId);
  if (index == null) return;
  kitAudio.pointers.delete(event.pointerId);
  noteOffKitPad(index);
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
      head.innerHTML = `<span>${index + 1} <kbd class="pad-key">(${KIT_PAD_KEYS[index]})</kbd></span>`;

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
          mutateEditor(() => {
            kit.pads[index].sample = select.value || null;
            kit.pads[index].view = { start: 0, end: 1 };
            kit.pads[index].trim = { start: 0, length: 1 };
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
          noteOnKitPad(index, event.pointerId, cell);
        });
        cell.addEventListener("pointerup", releaseKitPointer);
        cell.addEventListener("pointercancel", releaseKitPointer);
      }
      grid.append(cell);
    }
  }
  syncKitPadChrome();
  requestAnimationFrame(drawKitWaves);
}

function bindWaveTwoFinger(canvas) {
  if (canvas.dataset.twoFingerBound) return;
  canvas.dataset.twoFingerBound = "1";
  const pointers = new Map();
  const gesture = { active: false, lastX: 0, lastY: 0, center: 0 };

  function centroid() {
    let x = 0;
    let y = 0;
    for (const point of pointers.values()) {
      x += point.x;
      y += point.y;
    }
    const n = Math.max(1, pointers.size);
    return { x: x / n, y: y / n };
  }

  function endTwoFinger() {
    if (!gesture.active) return;
    gesture.active = false;
    sliceEdit.twoFinger = false;
    canvas.classList.remove("panning");
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* already captured */ }
    if (pointers.size < 2) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    sliceEdit.twoFinger = true;
    sliceEdit.boundary = null;
    sliceEdit.panning = false;
    canvas.classList.remove("dragging");
    canvas.classList.add("panning");
    const mid = centroid();
    gesture.active = true;
    gesture.lastX = mid.x;
    gesture.lastY = mid.y;
    gesture.center = overviewNorm({ clientX: mid.x, clientY: mid.y }, canvas).norm;
    for (const id of pointers.keys()) {
      try { canvas.setPointerCapture(id); } catch { /* already captured */ }
    }
  }, true);

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture.active || pointers.size < 2) return;
    event.preventDefault();
    const mid = centroid();
    const dx = mid.x - gesture.lastX;
    const dy = mid.y - gesture.lastY;
    gesture.lastX = mid.x;
    gesture.lastY = mid.y;
    const width = Math.max(1, canvas.getBoundingClientRect().width);
    if (dx) panSliceView((dx / width) * sliceViewSpan());
    if (dy) zoomSliceView(Math.exp(dy * 0.012), gesture.center);
  });

  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
    if (pointers.size < 2) endTwoFinger();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}

function handleWaveWheel(event, canvas) {
  event.preventDefault();
  const { norm } = overviewNorm(event, canvas);
  if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    panSliceView((event.deltaX || event.deltaY) * 0.001 * sliceViewSpan());
    return;
  }
  zoomSliceView(event.deltaY > 0 ? 1.18 : 1 / 1.18, norm);
}

function bindPadWaveNav(canvas, index) {
  bindWaveTwoFinger(canvas);
  canvas.addEventListener("wheel", (event) => {
    event.stopPropagation();
    selectKitPad(index);
    handleWaveWheel(event, canvas);
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
    if (sliceEdit.twoFinger) return;
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
    if (sliceEdit.twoFinger || !sliceEdit.panning || sliceEdit.boundary != null) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const dx = (sliceEdit.panX - event.clientX) / Math.max(1, rect.width);
    sliceEdit.panX = event.clientX;
    panSliceView(dx * sliceViewSpan());
  });
  const endPan = (event) => {
    if (sliceEdit.twoFinger || !sliceEdit.panning) return;
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
    const trim = kit.mode === "pads" && selectedIndex != null ? kitPadTrim(selectedIndex) : null;
    const region = selected || (trim ? { start: trim.start, length: trim.length } : null);
    const abs = kitAbsPlayhead();
    const liveMatches = kit.mode === "slices" || kitAudio.live === selectedIndex;
    drawWaveform(canvas, peaks, {
      start: sliceView.start,
      end: sliceView.end,
      slices: kit.mode === "slices" ? kit.slices : (region ? [region] : undefined),
      activeBoundary: sliceEdit.boundary,
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
    const trim = kit.mode === "pads" ? kitPadTrim(index) : null;
    const view = kit.mode === "slices"
      ? { start: Number(canvas.dataset.start), end: Number(canvas.dataset.end) }
      : { start: trim.start, end: trim.start + trim.length };
    const voice = [...kitAudio.voices].reverse().find((item) => item.index === index);
    const head = kitVoicePlayhead(voice);
    drawWaveform(canvas, padPeaks, {
      start: view.start,
      end: view.end,
      progress: head?.local,
    });
  }
}

const MIN_SLICE = 0.004;
const MIN_SLICE_VIEW = 0.02;
const sliceView = { start: 0, end: 1 };
const sliceEdit = { boundary: null, panning: false, panX: 0, twoFinger: false };

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
  mutateEditor(() => {
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

function nearestBoundary(norm, pxWidth, points) {
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

function nearestSliceBoundary(norm, pxWidth) {
  return nearestBoundary(norm, pxWidth, sliceBoundaryPositions());
}

function applySliceVisuals() {
  if (kit.mode === "pads") {
    for (const cell of $("padgrid").children) {
      const index = Number(cell.dataset.index);
      const label = cell.querySelector(".slice-label");
      if (label) label.textContent = kitPadDurationLabel(index);
    }
    drawKitWaves();
    return;
  }
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

  bindWaveTwoFinger(canvas);

  canvas.addEventListener("pointerdown", (event) => {
    if ($("kit-overview").hidden || sliceEdit.twoFinger) return;
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
      noteOnKitPad(index, event.pointerId, canvas);
      return;
    }
    if (kitAudio.selected == null) return;
    const trimEdge = nearestBoundary(norm, width, padTrimPoints(kitAudio.selected));
    if (trimEdge != null) {
      event.preventDefault();
      event.stopPropagation();
      sliceEdit.boundary = trimEdge;
      canvas.classList.add("dragging");
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
      setPadTrimBoundary(trimEdge, norm);
      applySliceVisuals();
      return;
    }
    event.preventDefault();
    noteOnKitPad(kitAudio.selected, event.pointerId, canvas);
  });
  canvas.addEventListener("pointermove", (event) => {
    if ($("kit-overview").hidden || sliceEdit.twoFinger) return;
    const { viewX, norm, width } = overviewNorm(event, canvas);
    if (sliceEdit.panning) {
      event.preventDefault();
      const dx = (sliceEdit.panX - event.clientX) / Math.max(1, width);
      sliceEdit.panX = event.clientX;
      panSliceView(dx * sliceViewSpan());
      return;
    }
    if (sliceEdit.boundary != null && (kit.mode === "slices" || kit.mode === "pads")) {
      event.preventDefault();
      let next = norm;
      if (viewX < 0.06) panSliceView(-sliceViewSpan() * 0.03);
      else if (viewX > 0.94) panSliceView(sliceViewSpan() * 0.03);
      const mapped = overviewNorm(event, canvas);
      next = mapped.norm;
      if (kit.mode === "pads") setPadTrimBoundary(sliceEdit.boundary, next);
      else setSliceBoundary(sliceEdit.boundary, next);
      applySliceVisuals();
      return;
    }
    const onHandle = kit.mode === "slices"
      ? nearestSliceBoundary(norm, width) != null
      : kitAudio.selected != null && nearestBoundary(norm, width, padTrimPoints(kitAudio.selected)) != null;
    canvas.style.cursor = onHandle ? "ew-resize" : event.shiftKey && sliceViewZoomed() ? "grab" : "pointer";
  });
  const endDrag = (event) => {
    if (sliceEdit.twoFinger) return;
    if (sliceEdit.boundary == null && !sliceEdit.panning) return;
    sliceEdit.boundary = null;
    sliceEdit.panning = false;
    canvas.classList.remove("dragging", "panning");
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
    applySliceVisuals();
    endEditorGesture();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (event) => {
    if ($("kit-overview").hidden) return;
    handleWaveWheel(event, canvas);
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

function kitFxOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  return option;
}

function kitFxSpecs() {
  return fx.catalog && fx.catalog.length
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
}

function kitFxName(kind) {
  return (kitFxSpecs().find((item) => item.kind === kind) || {}).name || kind;
}

function kitFxPresetMatches(item, kind) {
  if (!kind || !item) return false;
  const needle = String(kind).toLowerCase();
  const name = kitFxName(kind).toLowerCase().replace(/-/g, " ");
  if (String(item.kind || "").toLowerCase() === needle) return true;
  const group = String(item.group || "").toLowerCase().replace(/-/g, " ");
  if (group === name || group.replace(/\s+/g, "") === needle) return true;
  const parts = String(item.path || "").replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  const folder = parts.length >= 2 ? parts[parts.length - 2].replace(/-/g, " ") : "";
  return folder === needle || folder === name || folder.replace(/\s+/g, "") === needle;
}

function kitFxPresetValue(item) {
  if (item.source === "factory") return "factory:" + item.path;
  return "preset:" + item.path;
}

function kitFxKindFromValue(value) {
  if (!value) return "";
  if (!String(value).startsWith("preset:") && !String(value).startsWith("factory:")) return value;
  const item = (kit.fxPresets || []).find((entry) => kitFxPresetValue(entry) === value);
  return item?.kind || "";
}

function kitType() {
  return document.querySelector(".kit-type-btn.on")?.dataset.type || "drum";
}

function setKitType(value) {
  const prev = kitType();
  const type = value || "drum";
  for (const btn of document.querySelectorAll(".kit-type-btn")) {
    const on = btn.dataset.type === type;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
  }
  if (prev === "gate" && type !== "gate") stopKitPlayback();
}

function kitFxValue(slot) {
  const kind = $(`kit-${slot}-fx`)?.value || "";
  if (!kind) return "";
  return $(`kit-${slot}-fx-preset`)?.value || kind;
}

function populateKitFxKindSelect(select, selected) {
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  select.innerHTML = "";
  select.append(kitFxOption("", "Off", !selected));
  for (const spec of kitFxSpecs()) {
    select.append(kitFxOption(spec.kind, spec.name, spec.kind === selected));
  }
  if (selected && ![...select.options].some((option) => option.value === selected)) {
    select.append(kitFxOption(selected, selected, true));
  }
  select.value = selected || "";
  select.onchange = onchange;
}

function populateKitFxPresetSelect(select, kind, selected) {
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  select.innerHTML = "";
  if (!kind) {
    select.append(kitFxOption("", "Off", true));
    select.disabled = true;
    select.onchange = onchange;
    return;
  }
  select.disabled = false;
  select.append(kitFxOption(kind, `Default (${kitFxName(kind)})`, selected === kind || !selected));
  const matching = (kit.fxPresets || []).filter((item) => kitFxPresetMatches(item, kind));
  function appendGroup(label, items) {
    if (!items.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const item of items) {
      group.append(kitFxOption(kitFxPresetValue(item), item.name || item.label, kitFxPresetValue(item) === selected));
    }
    select.append(group);
  }
  appendGroup("User library", matching.filter((item) => (item.source || "effects") === "effects"));
  appendGroup("Core Library", matching.filter((item) => item.source === "factory"));
  select.value = selected || kind;
  select.onchange = onchange;
}

function applyKitFxSlot(slot, value) {
  const kind = kitFxKindFromValue(value);
  populateKitFxKindSelect($(`kit-${slot}-fx`), kind);
  populateKitFxPresetSelect($(`kit-${slot}-fx-preset`), kind, value || kind);
}

function syncKitFxPreset(slot) {
  const kind = $(`kit-${slot}-fx`)?.value || "";
  populateKitFxPresetSelect($(`kit-${slot}-fx-preset`), kind, kind);
}

async function fillKitFxSelects() {
  try {
    await ensureFxCatalog();
  } catch (error) {
    if (!fx.catalog) toast(error.message, "error");
  }
  try {
    const data = await api("/api/effects/presets");
    kit.fxPresets = data.presets || [];
  } catch (error) {
    kit.fxPresets = [];
    toast(error.message || "Could not load effect presets", "error");
  }
  applyKitFxSlot("return", "reverb");
  applyKitFxSlot("insert", "saturator");
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
    kit.pads = plan.pads.map((pad) => ({ ...pad, view: { start: 0, end: 1 }, trim: { start: 0, length: 1 } }));

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
    setKitType("drum");
    const first = plan.pads.findIndex((pad) => pad.sample);
    if (first >= 0) kitAudio.selected = first;
    await fillKitFxSelects();
    $("kit-hint").textContent = "";
    renderPads();
    $("kit").showModal();
    beginEditor();
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
  if (before) commitEditorDiff(before);
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
  setKitType("drum");
  await fillKitFxSelects();
  await loadSlicePlan();
  $("kit").showModal();
  beginEditor();
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
  noteOnKitPad(index);
});

document.addEventListener("keyup", (event) => {
  if (!$("kit").open) return;
  const index = KIT_KEY_INDEX[event.key.toLowerCase()];
  if (index == null) return;
  noteOffKitPad(index);
});

function kitPayload(output) {
  return {
    name: $("kit-name").value.trim(),
    kit_type: kitType(),
    return_effect: kitFxValue("return"),
    insert_effect: kitFxValue("insert"),
    mode: kit.mode,
    folder: kit.folder,
    pads: kit.mode === "pads" ? kit.pads.map((pad) => {
      if (!pad.sample) return null;
      const start = pad.trim?.start ?? 0;
      const length = pad.trim?.length ?? 1;
      if (start <= 1e-6 && length >= 0.999) return pad.sample;
      return { sample: pad.sample, start, length };
    }) : [],
    sample: kit.sample,
    count: Number($("kit-slices").value),
    slices: kit.mode === "slices"
      ? kit.slices.map((slice) => ({ start: slice.start, length: slice.length }))
      : [],
    output,
    section: kit.section,
  };
}

function bindSelectUndo(id) {
  const el = $(id);
  if (!el) return;
  let before = null;
  el.addEventListener("pointerdown", () => {
    before = JSON.stringify(snapshotKit());
  });
  el.addEventListener("change", () => {
    if (before) commitEditorDiff(before);
    before = JSON.stringify(snapshotKit());
  });
}

bindSelectUndo("kit-return-fx");
bindSelectUndo("kit-return-fx-preset");
bindSelectUndo("kit-insert-fx");
bindSelectUndo("kit-insert-fx-preset");
$("kit-return-fx").addEventListener("change", () => syncKitFxPreset("return"));
$("kit-insert-fx").addEventListener("change", () => syncKitFxPreset("insert"));
for (const btn of document.querySelectorAll(".kit-type-btn")) {
  let before = null;
  btn.addEventListener("pointerdown", () => {
    before = JSON.stringify(snapshotKit());
  });
  btn.addEventListener("click", () => {
    setKitType(btn.dataset.type);
    if (before) commitEditorDiff(before);
    before = JSON.stringify(snapshotKit());
  });
}
$("kit-name").addEventListener("focus", () => {
  editorUndo.fieldStart = JSON.stringify(snapshotKit());
});
$("kit-name").addEventListener("blur", () => {
  if (editorUndo.fieldStart) commitEditorDiff(editorUndo.fieldStart);
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

/* ---------- shared effect catalog ---------- */

// Fetched once from /api/effects/catalog, then reused by the kit and preset dialogs
// to name and group Move's stock effects.
const fx = { catalog: null };

function emptyEditorUndo() {
  return { past: [], current: null, coalescing: false, applying: false };
}

const editorUndo = {
  kit: emptyEditorUndo(),
  fieldStart: null,
};

function snapshotKit() {
  return {
    pads: (kit.pads || []).map((pad) => ({
      sample: pad.sample || null,
      role: pad.role || "",
      view: pad.view ? { start: pad.view.start, end: pad.view.end } : null,
      trim: pad.trim ? { start: pad.trim.start, length: pad.trim.length } : null,
    })),
    slices: (kit.slices || []).map((slice) => ({
      start: slice.start,
      length: slice.length,
      start_seconds: slice.start_seconds,
      length_seconds: slice.length_seconds,
    })),
    name: $("kit-name")?.value || "",
    type: kitType(),
    returnFx: kitFxValue("return"),
    insertFx: kitFxValue("insert"),
    sliceCount: $("kit-slices")?.value || "",
    selected: kitAudio.selected,
  };
}

function applyKitSnapshot(data) {
  kit.pads = (data.pads || []).map((pad) => ({
    sample: pad.sample || null,
    role: pad.role || "",
    view: pad.view ? { start: pad.view.start, end: pad.view.end } : { start: 0, end: 1 },
    trim: pad.trim ? { start: pad.trim.start, length: pad.trim.length } : { start: 0, length: 1 },
  }));
  kit.slices = (data.slices || []).map((slice) => ({ ...slice }));
  if ($("kit-name")) $("kit-name").value = data.name || "";
  setKitType(data.type);
  applyKitFxSlot("return", data.returnFx || "");
  applyKitFxSlot("insert", data.insertFx || "");
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

function beginEditor() {
  editorUndo.kit = emptyEditorUndo();
  editorUndo.kit.current = JSON.stringify(snapshotKit());
  editorUndo.fieldStart = null;
}

function commitEditorDiff(before, { coalesce = false } = {}) {
  const stack = editorUndo.kit;
  if (stack.applying) return;
  const after = JSON.stringify(snapshotKit());
  if (before === after) return;
  if (!coalesce) stack.coalescing = false;
  if (!coalesce || !stack.coalescing) {
    stack.past.push(before);
    if (stack.past.length > 80) stack.past.shift();
    if (coalesce) stack.coalescing = true;
  }
  stack.current = after;
}

function mutateEditor(fn, opts = {}) {
  const before = JSON.stringify(snapshotKit());
  fn();
  commitEditorDiff(before, opts);
}

function endEditorGesture() {
  const stack = editorUndo.kit;
  stack.coalescing = false;
  if (!stack.applying) stack.current = JSON.stringify(snapshotKit());
}

function undoInProgressField() {
  const field = $("kit-name");
  if (document.activeElement !== field || !editorUndo.fieldStart) return false;
  const now = JSON.stringify(snapshotKit());
  if (editorUndo.fieldStart === now) return false;
  const stack = editorUndo.kit;
  stack.applying = true;
  applyKitSnapshot(JSON.parse(editorUndo.fieldStart));
  stack.applying = false;
  stack.current = editorUndo.fieldStart;
  return true;
}

function undoEditor() {
  const stack = editorUndo.kit;
  endEditorGesture();
  if (undoInProgressField()) return true;
  const prev = stack.past.pop();
  if (!prev) return false;
  stack.applying = true;
  applyKitSnapshot(JSON.parse(prev));
  stack.current = prev;
  stack.applying = false;
  return true;
}

function nativeTextUndoTarget(target) {
  const el = target?.closest?.("input, textarea");
  if (!el) return false;
  if (el.id === "kit-name") return false;
  const type = (el.type || "text").toLowerCase();
  if (["range", "checkbox", "radio", "file", "number", "color"].includes(type)) return false;
  return true;
}

async function performUndo() {
  if ($("kit")?.open && undoEditor()) {
    toast("Undid kit change");
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

const preset = {
  instrument: null,
  instruments: [],
  samples: [],
  fxPresets: [],
  uploads: { slot1: null, slot2: null },
  editPath: "",
  editFolder: "",
};

const PRESET_INSTRUMENT_FAMILIES = [
  { kind: "drift", name: "Drift" },
  { kind: "wavetable", name: "Wavetable" },
  { kind: "drumRack", name: "Drum Rack" },
  { kind: "melodicSampler", name: "Sampler" },
];

const DRUM_KIT_PRESETS = [
  { variant: "drum", name: "Sample kit" },
  { variant: "choke", name: "Choke kit" },
  { variant: "gate", name: "Gate kit" },
];

const PRESET_FX_FALLBACK = [
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

function instrumentChoiceValue(item) {
  return `${item.source}:${item.path}`;
}

function instrumentSourceLabel(item) {
  if (!item) return "";
  if (item.source === "factory") return "Core Library";
  if (item.source === "upload") return "Uploaded";
  return "User library";
}

function isEngineType(value) {
  return PRESET_INSTRUMENT_FAMILIES.some((item) => item.kind === value);
}

function isSoundType(value) {
  return String(value || "").startsWith("sound:");
}

function soundCategoryKey(name) {
  return String(name || "").trim().toLowerCase();
}

function soundTypeValue(name) {
  return "sound:" + soundCategoryKey(name);
}

function listedInstrument(item) {
  if (!item || !item.path) return null;
  return preset.instruments.find((entry) => entry.source === item.source && entry.path === item.path) || null;
}

function instrumentKindOf(item) {
  if (!item) return "";
  if (item.source === "default") return item.kind || "";
  const listed = listedInstrument(item);
  if (listed?.kind && isEngineType(listed.kind)) return listed.kind;
  if (item.kind && isEngineType(item.kind)) return item.kind;
  if (item.source === "upload") return item.kind || "upload";
  return "";
}

function instrumentTypeOf(item) {
  if (!item) return "";
  const engine = instrumentKindOf(item);
  if (engine) return engine;
  const listed = listedInstrument(item);
  const category = listed?.category || item.category || "";
  return category ? soundTypeValue(category) : "";
}

function isSamplerKind(kind) {
  return kind === "melodicSampler";
}

function selectedInstrumentIsSampler() {
  return $("preset-instrument-kind")?.value === "melodicSampler";
}

function syncSamplerSampleField() {
  const field = $("preset-sample-field");
  if (!field) return;
  field.hidden = !selectedInstrumentIsSampler();
}

function soundCategories() {
  const found = new Map();
  const skip = new Set(["samples", "sample", "recordings", "recording"]);
  for (const item of preset.instruments) {
    if (!item.category) continue;
    const key = soundCategoryKey(item.category);
    if (skip.has(key)) continue;
    if (!found.has(key)) found.set(key, item.category);
  }
  return [...found.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([key, name]) => ({ value: "sound:" + key, name }));
}

function instrumentsForType(type) {
  if (isEngineType(type)) return preset.instruments.filter((item) => item.kind === type);
  if (isSoundType(type)) {
    const category = type.slice("sound:".length);
    return preset.instruments.filter((item) => soundCategoryKey(item.category) === category);
  }
  return [];
}

function stockFxSpecs() {
  return fx.catalog && fx.catalog.length ? fx.catalog : PRESET_FX_FALLBACK;
}

function stockFxName(kind) {
  return (stockFxSpecs().find((item) => item.kind === kind) || {}).name || kind;
}

function fxPresetValue(item) {
  if (item.source === "factory") return "factory:" + item.path;
  return "preset:" + item.path;
}

function fxKindFromSlot(value) {
  if (!value) return "";
  if (value === "upload:") return "";
  if (!String(value).startsWith("preset:") && !String(value).startsWith("factory:")) return value;
  const item = (preset.fxPresets || []).find((entry) => fxPresetValue(entry) === value);
  return item?.kind || "";
}

async function fillPresetFxSelects(slot1, slot2) {
  try {
    await ensureFxCatalog();
  } catch (error) {
    if (!fx.catalog) toast(error.message, "error");
  }
  try {
    const data = await api("/api/effects/presets");
    preset.fxPresets = data.presets || [];
  } catch {
    preset.fxPresets = [];
  }
  populatePresetFxKindSelect($("preset-slot1-kind"), fxKindFromSlot(slot1));
  populatePresetFxKindSelect($("preset-slot2-kind"), fxKindFromSlot(slot2));
  populatePresetFxSelect($("preset-slot1"), $("preset-slot1-kind")?.value || "", slot1 ?? "");
  populatePresetFxSelect($("preset-slot2"), $("preset-slot2-kind")?.value || "", slot2 ?? "");
}

function populatePresetFxKindSelect(select, selected) {
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  select.innerHTML = "";
  select.append(kitFxOption("", "Off", !selected));
  for (const spec of stockFxSpecs()) {
    select.append(kitFxOption(spec.kind, spec.name, spec.kind === selected));
  }
  if (selected && ![...select.options].some((option) => option.value === selected)) {
    select.append(kitFxOption(selected, selected, true));
  }
  select.value = selected || "";
  select.onchange = onchange;
}

function populatePresetFxSelect(select, kind, selected) {
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  select.innerHTML = "";
  const selectedPreset = String(selected || "").startsWith("preset:") || String(selected || "").startsWith("factory:") || selected === "upload:";
  if (!kind && !selectedPreset) {
    select.append(kitFxOption("", "Off", true));
    select.disabled = true;
    select.onchange = onchange;
    return;
  }
  select.disabled = false;
  if (kind) {
    select.append(kitFxOption(kind, `Default (${stockFxName(kind)})`, selected === kind || !selected));
  } else {
    select.append(kitFxOption("", "Pick a preset…", !selectedPreset));
  }
  const uploaded = select.id === "preset-slot2" ? preset.uploads.slot2 : preset.uploads.slot1;
  if (uploaded && (!kind || uploaded.kind === kind)) {
    select.append(kitFxOption("upload:", uploaded.name || "Uploaded effect", selected === "upload:"));
  }
  const matching = (preset.fxPresets || []).filter((item) => kind && item.kind === kind);
  function appendGroup(label, items) {
    const group = document.createElement("optgroup");
    group.label = label;
    if (!items.length) {
      const empty = kitFxOption("", "No presets", false);
      empty.disabled = true;
      group.append(empty);
    } else {
      for (const item of items) {
        group.append(kitFxOption(fxPresetValue(item), item.name || item.label, fxPresetValue(item) === selected));
      }
    }
    select.append(group);
  }
  if (kind) {
    appendGroup("User library", matching.filter((item) => (item.source || "effects") === "effects"));
    appendGroup("Core Library", matching.filter((item) => item.source === "factory"));
  }
  select.value = selected || kind || "";
  select.onchange = onchange;
}

async function loadPresetInstrumentCatalog() {
  try {
    const data = await api("/api/presets/instruments");
    preset.instruments = data.instruments || [];
  } catch (error) {
    preset.instruments = [];
    toast(error.message, "error");
  }
}

async function loadPresetSampleCatalog() {
  try {
    const data = await api("/api/presets/samples");
    preset.samples = data.samples || [];
  } catch {
    preset.samples = [];
  }
}

function populateInstrumentKindSelect() {
  const select = $("preset-instrument-kind");
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  const current = instrumentTypeOf(preset.instrument);
  select.innerHTML = "";
  select.append(kitFxOption("", "Pick a type…", !current));
  const instruments = document.createElement("optgroup");
  instruments.label = "Instruments";
  for (const group of PRESET_INSTRUMENT_FAMILIES) {
    instruments.append(kitFxOption(group.kind, group.name, group.kind === current));
  }
  select.append(instruments);
  const sounds = soundCategories();
  if (sounds.length) {
    const group = document.createElement("optgroup");
    group.label = "Sounds";
    for (const sound of sounds) {
      group.append(kitFxOption(sound.value, sound.name, sound.value === current));
    }
    select.append(group);
  }
  select.value = current || "";
  select.onchange = onchange;
  syncSamplerSampleField();
}

function populateInstrumentPresetSelect() {
  const select = $("preset-instrument");
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  const type = $("preset-instrument-kind")?.value || "";
  const current = preset.instrument && preset.instrument.source !== "upload" && preset.instrument.path
    ? instrumentChoiceValue(preset.instrument)
    : (preset.instrument?.source === "default" ? `default:${preset.instrument.kind}` : "");
  select.innerHTML = "";
  if (!type) {
    select.append(kitFxOption("", "Pick a type first", true));
    select.disabled = true;
    select.onchange = onchange;
    syncSamplerSampleField();
    return;
  }
  select.disabled = false;
  const family = PRESET_INSTRUMENT_FAMILIES.find((item) => item.kind === type);
  const items = instrumentsForType(type);
  const defaultValue = preset.instrument?.source === "default"
    ? (preset.instrument.kind === "drumRack"
      ? `default:drumRack:${preset.instrument.variant || "drum"}`
      : `default:${preset.instrument.kind}`)
    : "";
  const usingDefault = Boolean(defaultValue) && preset.instrument?.kind === type;
  select.append(kitFxOption("", "Pick a preset…", !current && preset.instrument?.source !== "upload" && !usingDefault));
  if (type === "drumRack") {
    const kits = document.createElement("optgroup");
    kits.label = "Kits";
    for (const kit of DRUM_KIT_PRESETS) {
      const value = `default:drumRack:${kit.variant}`;
      kits.append(kitFxOption(value, kit.name, defaultValue === value));
    }
    select.append(kits);
  } else if (family) {
    select.append(kitFxOption(`default:${type}`, `Default ${family.name}`, usingDefault));
  }
  for (const group of [
    { source: "presets", label: "User library" },
    { source: "factory", label: "Core Library" },
  ]) {
    const grouped = items.filter((item) => item.source === group.source);
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    if (!grouped.length) {
      const empty = kitFxOption("", group.source === "factory" ? "No Core Library presets" : "No user presets", false);
      empty.disabled = true;
      optgroup.append(empty);
    } else {
      for (const item of grouped) {
        optgroup.append(kitFxOption(instrumentChoiceValue(item), item.name || item.label, instrumentChoiceValue(item) === current));
      }
    }
    select.append(optgroup);
  }
  if (preset.instrument?.source === "upload" && instrumentTypeOf(preset.instrument) === type) {
    select.append(kitFxOption("upload:", preset.instrument.name || "Uploaded instrument", true));
  }
  if (preset.instrument?.source === "upload") select.value = "upload:";
  else if (usingDefault) select.value = defaultValue;
  else select.value = current;
  select.onchange = onchange;
  syncSamplerSampleField();
}

function populatePresetSampleSelect(selected) {
  const select = $("preset-sample");
  if (!select) return;
  const onchange = select.onchange;
  select.onchange = null;
  const current = selected ?? (preset.instrument?.sample || "");
  select.innerHTML = "";
  select.append(kitFxOption("", "Pick a sample…", !current));
  for (const group of [
    { section: "samples", label: "Samples" },
    { section: "recordings", label: "Recordings" },
  ]) {
    const items = (preset.samples || []).filter((item) => item.section === group.section);
    if (!items.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const item of items) {
      optgroup.append(kitFxOption(item.value, item.label || item.name, item.value === current));
    }
    select.append(optgroup);
  }
  if (current && ![...select.options].some((option) => option.value === current)) {
    select.append(kitFxOption(current, current.split(":").slice(1).join(":") || current, true));
  }
  select.value = current || "";
  select.onchange = onchange;
}

async function populatePresetInstrumentSelect() {
  await loadPresetInstrumentCatalog();
  await loadPresetSampleCatalog();
  populateInstrumentKindSelect();
  populateInstrumentPresetSelect();
  populatePresetSampleSelect();
}

function updatePresetHint(message) {
  const hint = $("preset-hint");
  if (hint) hint.textContent = message || "";
}

function applyLoadedInstrument(data) {
  preset.instrument = {
    name: data.name,
    kind: data.kind,
    source: data.source,
    path: data.path || "",
    device: data.instrument,
    sample: data.sample || "",
  };
  const nameField = $("preset-name");
  const currentName = nameField?.value || "";
  if (data.name && (!currentName || currentName === "My Preset")) nameField.value = data.name;
  populatePresetSampleSelect(preset.instrument.sample);
  syncSamplerSampleField();
  updatePresetHint();
}

function applyDefaultInstrument(kind, variant) {
  const family = PRESET_INSTRUMENT_FAMILIES.find((item) => item.kind === kind);
  const kit = kind === "drumRack" ? DRUM_KIT_PRESETS.find((item) => item.variant === (variant || "drum")) : null;
  preset.instrument = {
    name: kit?.name || family?.name || kind,
    kind,
    source: "default",
    path: "",
    variant: kit ? (variant || "drum") : "",
    device: null,
    sample: isSamplerKind(kind) ? ($("preset-sample")?.value || "") : "",
  };
  syncSamplerSampleField();
  updatePresetHint();
}

async function loadPresetInstrumentChoice(value) {
  if (!value) {
    preset.instrument = null;
    syncSamplerSampleField();
    updatePresetHint();
    return;
  }
  if (value === "upload:") return;
  if (value.startsWith("default:")) {
    const rest = value.slice("default:".length);
    const split = rest.indexOf(":");
    const kind = split === -1 ? rest : rest.slice(0, split);
    const variant = split === -1 ? "" : rest.slice(split + 1);
    applyDefaultInstrument(kind, variant);
    return;
  }
  const split = value.indexOf(":");
  const data = await api(`/api/presets/load?source=${encodeURIComponent(value.slice(0, split))}&path=${encodeURIComponent(value.slice(split + 1))}`);
  applyLoadedInstrument(data);
}

async function showPresetDialog({ name, path, folder, instrument, slot1, slot2, title }) {
  preset.editPath = path || "";
  preset.editFolder = folder || "";
  preset.instrument = instrument || null;
  preset.uploads = { slot1: null, slot2: null };
  $("preset-title").textContent = title || (preset.editPath ? "Edit preset" : "Make preset");
  $("preset-name").value = name || "My Preset";
  $("preset-save").textContent = preset.editPath ? "Save changes" : "Save to Move";
  await fillPresetFxSelects(slot1 || "", slot2 || "");
  await populatePresetInstrumentSelect();
  updatePresetHint();
  $("preset").showModal();
}

function resetPresetEditor() {
  preset.instrument = null;
  preset.uploads = { slot1: null, slot2: null };
  preset.editPath = "";
  preset.editFolder = "";
  $("preset-save").textContent = "Save to Move";
}

function slotPayload(slot) {
  const value = $(`preset-slot${slot}`)?.value || "";
  const uploaded = preset.uploads[`slot${slot}`];
  if (value === "upload:" && uploaded?.device) {
    return { source: "upload", device: uploaded.device };
  }
  return value;
}

function applyUploadedEffects(data) {
  const devices = (data.devices || []).slice(0, 2);
  if (!devices.length) throw new Error("No effects in that file");
  const slot1On = Boolean($("preset-slot1-kind")?.value);
  const slot2On = Boolean($("preset-slot2-kind")?.value);
  let start = 1;
  if (devices.length === 1 && slot1On && !slot2On) start = 2;
  devices.forEach((item, index) => {
    const slot = start + index;
    if (slot > 2) return;
    preset.uploads[`slot${slot}`] = item;
    populatePresetFxKindSelect($(`preset-slot${slot}-kind`), item.kind);
    populatePresetFxSelect($(`preset-slot${slot}`), item.kind, "upload:");
  });
  const names = devices.map((item) => item.name || item.kind).join(" + ");
  updatePresetHint();
  toast(`Loaded ${names}`, "ok");
}

function presetPayload(output) {
  const kind = $("preset-instrument-kind")?.value || preset.instrument?.kind || "";
  const sample = isSamplerKind(kind) ? ($("preset-sample")?.value || "") : "";
  return {
    name: $("preset-name").value.trim(),
    folder: preset.editPath ? preset.editFolder : (state.kind === "presets" ? destFolder() : ""),
    replace: preset.editPath || "",
    output,
    slot1: slotPayload(1),
    slot2: slotPayload(2),
    instrument: preset.instrument?.source === "upload"
      ? { source: "upload", path: "", kind, preset: preset.instrument.device, sample }
      : {
          source: preset.instrument?.source || "presets",
          path: preset.instrument?.path || "",
          kind,
          preset: null,
          sample,
          variant: preset.instrument?.variant || "",
        },
  };
}

async function savePreset(output) {
  const payload = presetPayload(output);
  if (!payload.name) {
    $("preset-hint").textContent = "Give the preset a name first";
    return;
  }
  if (!preset.instrument) {
    $("preset-hint").textContent = "Pick an instrument first";
    return;
  }
  if (isSamplerKind(preset.instrument.kind) && preset.instrument.source === "default" && !$("preset-sample")?.value) {
    $("preset-hint").textContent = "Pick a sample for Sampler";
    return;
  }
  if (output === "file") {
    try {
      const response = await fetch("/api/presets/build", {
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
      $("preset").close();
      toast("Preset downloaded", "ok");
    } catch (error) {
      $("preset-hint").textContent = error.message;
    }
    return;
  }
  try {
    const result = await apiJson("/api/presets/build", payload);
    $("preset").close();
    toast(`Saved ${result.name}`, "ok");
    if (!result.refreshed) {
      toast("Saved, but library refresh failed — restart Move to see it", "error");
    }
    if (state.kind === "presets") await load();
    refreshStorage();
  } catch (error) {
    $("preset-hint").textContent = error.message;
  }
}

async function openPresetBuilder() {
  try {
    await showPresetDialog({
      name: "My Preset",
      path: "",
      folder: destFolder(),
      instrument: null,
      slot1: "",
      slot2: "",
      title: "Make preset",
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openPresetEditor(path) {
  try {
    const data = await api(`/api/presets/load?source=presets&path=${encodeURIComponent(path)}`);
    await showPresetDialog({
      name: data.name,
      path: data.path || path,
      folder: data.folder || "",
      instrument: {
        name: data.name,
        kind: data.kind,
        source: data.source,
        path: data.path || path,
        device: data.instrument,
        sample: data.sample || "",
      },
      slot1: data.slot1 || "",
      slot2: data.slot2 || "",
      title: "Edit preset",
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

function closeDownMenus() {
  document.querySelectorAll(".drop.open").forEach((el) => el.classList.remove("open"));
  document.querySelectorAll(".drop-menu").forEach((el) => el.remove());
  closeConnMenu();
}

function downMenuLabel(select) {
  return select.selectedOptions[0]?.textContent || "—";
}

function syncDownSelect(select) {
  const wrap = select.closest(".drop");
  const btn = wrap?.querySelector(".drop-toggle");
  if (!btn) return;
  btn.textContent = downMenuLabel(select);
  btn.disabled = select.disabled;
  wrap.classList.toggle("disabled", select.disabled);
}

function openDownMenu(select, btn) {
  const wrap = select.closest(".drop");
  wrap.classList.add("open");
  const menu = document.createElement("div");
  menu.className = "drop-menu";
  for (const node of select.children) {
    if (node.tagName === "OPTGROUP") {
      const group = document.createElement("div");
      group.className = "drop-group";
      group.textContent = node.label;
      menu.append(group);
      for (const opt of node.children) menu.append(downMenuItem(select, opt));
    } else if (node.tagName === "OPTION") {
      menu.append(downMenuItem(select, node));
    }
  }
  (select.closest("dialog") || document.body).append(menu);
  const box = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  menu.style.left = `${Math.round(box.left)}px`;
  menu.style.width = `${Math.round(box.width)}px`;
  menu.style.maxHeight = `${Math.max(8, window.innerHeight - box.bottom - 8)}px`;
}

function downMenuItem(select, opt) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `drop-item${opt.selected ? " on" : ""}${opt.disabled ? " off" : ""}`;
  item.textContent = opt.textContent;
  item.disabled = opt.disabled;
  if (!opt.disabled) {
    item.onclick = () => {
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeDownMenus();
    };
  }
  return item;
}

function bindDownSelect(select) {
  if (select.closest(".drop")) return;
  const wrap = document.createElement("div");
  wrap.className = "drop";
  select.after(wrap);
  wrap.append(select);
  select.classList.add("drop-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "drop-toggle";
  wrap.insertBefore(btn, select);
  select.addEventListener("change", () => syncDownSelect(select));
  new MutationObserver(() => syncDownSelect(select)).observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  syncDownSelect(select);
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (select.disabled) return;
    const open = wrap.classList.contains("open");
    closeDownMenus();
    if (!open) openDownMenu(select, btn);
  });
}

document.querySelectorAll("#preset select").forEach(bindDownSelect);
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".drop, .drop-menu")) closeDownMenus();
});
window.addEventListener("resize", closeDownMenus);
$("preset").addEventListener("cancel", (event) => {
  if (!document.querySelector(".drop-menu")) return;
  event.preventDefault();
  closeDownMenus();
});
$("preset").addEventListener("close", closeDownMenus);

$("btn-preset").onclick = openPresetBuilder;
$("btn-preset-edit").onclick = () => {
  const [path] = [...state.selected];
  if (path) openPresetEditor(path);
};
$("preset-instrument-kind").onchange = () => {
  const type = $("preset-instrument-kind").value;
  if (!type) {
    preset.instrument = null;
    populateInstrumentPresetSelect();
    updatePresetHint();
    return;
  }
  if (isEngineType(type)) {
    if (instrumentTypeOf(preset.instrument) !== type) applyDefaultInstrument(type);
  } else if (instrumentTypeOf(preset.instrument) !== type) {
    preset.instrument = null;
    updatePresetHint();
  }
  populateInstrumentPresetSelect();
};
$("preset-instrument").onchange = async () => {
  try {
    await loadPresetInstrumentChoice($("preset-instrument").value);
  } catch (error) {
    toast(error.message, "error");
  }
};
$("preset-slot1-kind").onchange = () => {
  const kind = $("preset-slot1-kind").value;
  if (preset.uploads.slot1 && preset.uploads.slot1.kind !== kind) preset.uploads.slot1 = null;
  populatePresetFxSelect($("preset-slot1"), kind, preset.uploads.slot1 ? "upload:" : kind);
};
$("preset-slot2-kind").onchange = () => {
  const kind = $("preset-slot2-kind").value;
  if (preset.uploads.slot2 && preset.uploads.slot2.kind !== kind) preset.uploads.slot2 = null;
  populatePresetFxSelect($("preset-slot2"), kind, preset.uploads.slot2 ? "upload:" : kind);
};
$("preset-instrument-upload").onclick = () => $("preset-instrument-file").click();
$("preset-instrument-file").onchange = async () => {
  const file = $("preset-instrument-file").files?.[0];
  $("preset-instrument-file").value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = await apiJson("/api/presets/parse", { preset: JSON.parse(text) });
    applyLoadedInstrument(data);
    await populatePresetInstrumentSelect();
  } catch (error) {
    toast(error.message || "Could not read that preset", "error");
  }
};
$("preset-effects-upload").onclick = () => $("preset-effects-file").click();
$("preset-effects-file").onchange = async () => {
  const file = $("preset-effects-file").files?.[0];
  $("preset-effects-file").value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = await apiJson("/api/effects/parse", { preset: JSON.parse(text) });
    applyUploadedEffects(data);
  } catch (error) {
    toast(error.message || "Could not read that effect", "error");
  }
};
$("preset-cancel").onclick = () => {
  resetPresetEditor();
  $("preset").close();
};
$("preset").addEventListener("close", resetPresetEditor);
$("preset-save").onclick = () => savePreset("device");
$("preset-download").onclick = () => savePreset("file");

/* ---------- boot ---------- */

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    if (nativeTextUndoTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    performUndo();
    return;
  }
  if (key === "a") {
    if (fileClipboardBlocked(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const items = showingSetPads() ? selectableGroups().flat() : visibleItems().map((item) => item.path);
    state.selectedPad = null;
    state.selected = new Set(items);
    state.rangeAnchor = items.at(-1) || null;
    highlightSelection();
    return;
  }
  if (key !== "c" && key !== "x" && key !== "v") return;
  if (fileClipboardBlocked(event.target)) return;
  if (event.repeat) return;
  if (key === "c") {
    if (!copySelection("copy")) return;
  } else if (key === "x") {
    if (!copySelection("cut")) return;
  } else if (!fileClipboard?.items?.length) {
    return;
  } else {
    // Not awaited on purpose: preventDefault below has to run in this tick, so
    // surface a failure through the toast instead of an unhandled rejection.
    pasteClipboard().catch((error) => toast(error.message, "error"));
  }
  event.preventDefault();
  event.stopPropagation();
}, true);

window.addEventListener("pointerup", (event) => {
  releaseKitPointer(event);
  endEditorGesture();
});
window.addEventListener("pointercancel", (event) => {
  releaseKitPointer(event);
  endEditorGesture();
});
window.addEventListener("blur", () => {
  if (kitType() === "gate") stopKitPlayback();
});

document.querySelector(".tab")?.classList.add("active");
if ($("storage")) {
  $("storage").addEventListener("click", () => openStorageDetail());
  $("storage").title = "Click for a storage breakdown";
}
if ($("storage-detail-close")) {
  $("storage-detail-close").onclick = () => $("storage-detail").close();
}
loadStatus().then(() => {
  load();
  refreshStorage();
});
