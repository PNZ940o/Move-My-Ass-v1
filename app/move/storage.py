"""How full Move's disk is, split into samples / sets / presets / other.

On a real device this is `df` plus `du` over SSH. In mock mode it walks the
sandbox folder and pretends the disk is the ~50 GB Ableton advertises for user
files, so the bar still reads as a Move rather than the PC's drive.
"""

from __future__ import annotations

import os
import re
import shlex
from pathlib import Path

from . import paths
from .backend import LocalBackend, MoveBackend

# Ableton: 64 GB card, about 50 GB left for user data.
MOCK_TOTAL = 50 * 1024 * 1024 * 1024

TREES = (
    ("samples", paths.SAMPLES),
    ("recordings", paths.RECORDINGS),
    ("presets", paths.TRACK_PRESETS),
    ("sets", paths.SETS),
    ("effects", paths.AUDIO_EFFECTS),
    ("factory", paths.CORE_LIBRARY),
)

DISPLAY = (
    ("samples", "Samples"),
    ("sets", "Sets"),
    ("presets", "Presets"),
    ("other", "Other"),
)

OTHER_PARTS = (
    ("recordings", "Recordings"),
    ("effects", "Effects"),
    ("factory", "Core Library"),
    ("system", "System"),
)

LIBRARIES = (
    ("samples", "Samples", "sample"),
    ("recordings", "Recordings", "recording"),
    ("sets", "Sets", "set"),
    ("presets", "Presets", "preset"),
    ("effects", "Effects", "effect"),
    ("factory", "Core Library", "item"),
)

_AUDIO_FIND = (
    "-iname '*.wav' -o -iname '*.aif' -o -iname '*.aiff' -o "
    "-iname '*.flac' -o -iname '*.mp3' -o -iname '*.ogg' -o -iname '*.m4a'"
)
_PRESET_FIND = (
    "-iname '*.ablpreset' -o -iname '*.ablpresetbundle' -o -iname '*.json'"
)


class StorageError(RuntimeError):
    pass


def _tree_bytes_local(backend: LocalBackend, absolute: str) -> int:
    root = backend._local(absolute)
    if not root.exists():
        return 0
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            try:
                total += (Path(dirpath) / name).stat().st_size
            except OSError:
                continue
    return total


def _count_kind(name: str, suffix: str) -> bool:
    lower = name.lower()
    if lower.startswith("."):
        return False
    if suffix == "sets":
        return lower == "song.abl"
    ext = os.path.splitext(lower)[1]
    if suffix in {"samples", "recordings"}:
        return ext in paths.AUDIO_SUFFIXES
    if suffix in {"presets", "effects"}:
        return ext in paths.PRESET_SUFFIXES
    if suffix == "factory":
        return ext in paths.AUDIO_SUFFIXES or ext in paths.PRESET_SUFFIXES
    return False


def _tree_count_local(backend: LocalBackend, absolute: str, kind: str) -> int:
    root = backend._local(absolute)
    if not root.exists():
        return 0
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for name in filenames:
            if _count_kind(name, kind):
                total += 1
    return total


def parse_df(text: str) -> tuple[int, int, int]:
    """Return `(total, used, free)` in bytes from POSIX `df -Pk` output."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    data = [line for line in lines if not line.lower().startswith("filesystem")]
    if not data:
        raise StorageError("could not read disk space")
    parts = data[-1].split()
    if len(parts) < 4:
        raise StorageError("disk space line is unreadable")
    try:
        blocks = int(parts[1])
        used = int(parts[2])
        free = int(parts[3])
    except ValueError as exc:
        raise StorageError("disk space numbers are unreadable") from exc
    scale = 1024
    total = blocks * scale
    used_bytes = used * scale
    free_bytes = free * scale
    if total <= 0:
        total = used_bytes + free_bytes
    return total, used_bytes, free_bytes


def parse_du(text: str) -> dict[str, int]:
    """Map known library paths to byte sizes from `du -sk` lines."""
    found: dict[str, int] = {key: 0 for key, _path in TREES}
    by_path = {path.rstrip("/"): key for key, path in TREES}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^(\d+)\s+(.*)$", line)
        if not match:
            continue
        kib = int(match.group(1))
        reported = match.group(2).strip().rstrip("/")
        key = by_path.get(reported)
        if not key:
            for path, name in by_path.items():
                if reported == path or reported.endswith(path):
                    key = name
                    break
        if key:
            found[key] = kib * 1024
    return found


def parse_counts(text: str) -> dict[str, int]:
    """Map library ids to item counts from `echo id $(find | wc -l)` lines."""
    found = {key: 0 for key, _label, _unit in LIBRARIES}
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) < 2 or parts[0] not in found:
            continue
        try:
            found[parts[0]] = int(parts[-1])
        except ValueError:
            continue
    return found


def _count_script() -> str:
    samples = shlex.quote(paths.SAMPLES)
    recordings = shlex.quote(paths.RECORDINGS)
    sets = shlex.quote(paths.SETS)
    presets = shlex.quote(paths.TRACK_PRESETS)
    effects = shlex.quote(paths.AUDIO_EFFECTS)
    factory = shlex.quote(paths.CORE_LIBRARY)
    return (
        "echo __COUNT__; "
        f"echo samples $(find {samples} -type f \\( {_AUDIO_FIND} \\) 2>/dev/null | wc -l); "
        f"echo recordings $(find {recordings} -type f \\( {_AUDIO_FIND} \\) 2>/dev/null | wc -l); "
        f"echo sets $(find {sets} -type f -iname Song.abl 2>/dev/null | wc -l); "
        f"echo presets $(find {presets} -type f \\( {_PRESET_FIND} \\) 2>/dev/null | wc -l); "
        f"echo effects $(find {effects} -type f \\( {_PRESET_FIND} \\) 2>/dev/null | wc -l); "
        f"echo factory $(find {factory} -type f \\( {_AUDIO_FIND} -o {_PRESET_FIND} \\) 2>/dev/null | wc -l)"
    )


def _remote_usage(backend: MoveBackend) -> tuple[int, int, int, dict[str, int], dict[str, int]]:
    quoted = " ".join(f'"{path}"' for _key, path in TREES)
    script = (
        "df -Pk /data 2>/dev/null || df -Pk /data/UserData; "
        "echo __DU__; "
        f"for p in {quoted}; do du -sk \"$p\" 2>/dev/null || echo \"0\t$p\"; done; "
        f"{_count_script()}"
    )
    result = backend.run(script, timeout=90.0)
    if not result.ok and "__DU__" not in result.stdout:
        detail = (result.stderr or result.stdout or "df/du failed").strip()
        raise StorageError(detail)
    raw = result.stdout
    if "__DU__" in raw:
        df_text, rest = raw.split("__DU__", 1)
    else:
        df_text, rest = raw, ""
    if "__COUNT__" in rest:
        du_text, count_text = rest.split("__COUNT__", 1)
    else:
        du_text, count_text = rest, ""
    total, used, free = parse_df(df_text)
    trees = parse_du(du_text)
    return total, used, free, trees, parse_counts(count_text)


def _local_usage(backend: LocalBackend) -> tuple[int, int, int, dict[str, int], dict[str, int]]:
    trees = {key: _tree_bytes_local(backend, path) for key, path in TREES}
    counts = {
        key: _tree_count_local(backend, path, key)
        for key, path in TREES
        if key in {item[0] for item in LIBRARIES}
    }
    used = sum(trees.values())
    total = MOCK_TOTAL if used < MOCK_TOTAL else used + 512 * 1024 * 1024
    free = max(0, total - used)
    return total, used, free, trees, counts


def tree_bytes(backend: MoveBackend, absolute: str) -> int:
    """Byte size of one folder, via `du` on the device or a local walk in mock."""
    if isinstance(backend, LocalBackend):
        return _tree_bytes_local(backend, absolute)
    result = backend.run(f"du -sk {shlex.quote(absolute)}", timeout=90.0)
    if not result.ok:
        raise StorageError((result.stderr or result.stdout or "du failed").strip())
    match = re.match(r"^(\d+)\s+", result.stdout.strip())
    if not match:
        raise StorageError("could not read folder size")
    return int(match.group(1)) * 1024


def free_bytes(backend: MoveBackend) -> int | None:
    """Free space on `/data`, or `None` if the device would not tell us."""
    if isinstance(backend, LocalBackend):
        try:
            return usage(backend)["free"]
        except StorageError:
            return None
    result = backend.run("df -Pk /data 2>/dev/null || df -Pk /data/UserData")
    if not result.ok:
        return None
    try:
        return parse_df(result.stdout)[2]
    except StorageError:
        return None


def usage(backend: MoveBackend) -> dict:
    """`{total, used, free, categories, libraries}` for the meter and detail dialog."""
    if isinstance(backend, LocalBackend):
        total, used, free, trees, counts = _local_usage(backend)
    else:
        total, used, free, trees, counts = _remote_usage(backend)

    named = trees["samples"] + trees["sets"] + trees["presets"]
    parts = {
        "recordings": trees["recordings"],
        "effects": trees["effects"],
        "factory": trees["factory"],
    }
    accounted = named + sum(parts.values())
    parts["system"] = max(0, used - accounted)
    other = parts["recordings"] + parts["effects"] + parts["factory"] + parts["system"]
    if named + other > used:
        other = max(0, used - named)

    grouped = {
        "samples": trees["samples"],
        "sets": trees["sets"],
        "presets": trees["presets"],
        "other": other,
    }
    categories = []
    for key, label in DISPLAY:
        entry: dict = {"id": key, "label": label, "bytes": grouped[key]}
        if key == "other":
            entry["parts"] = [
                {"id": part_id, "label": part_label, "bytes": parts[part_id]}
                for part_id, part_label in OTHER_PARTS
                if parts[part_id] > 0
            ]
        categories.append(entry)

    libraries = [
        {
            "id": key,
            "label": label,
            "unit": unit,
            "bytes": trees[key],
            "count": counts.get(key, 0),
        }
        for key, label, unit in LIBRARIES
    ]

    return {
        "total": total,
        "used": used,
        "free": free,
        "categories": categories,
        "libraries": libraries,
    }
