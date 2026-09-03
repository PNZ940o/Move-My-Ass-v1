"""Reads and classifies the contents of Move's user library."""

from __future__ import annotations

import posixpath
import re

from . import paths, sets
from .backend import Entry, MoveBackend


HIDDEN_NAMES = {sets.XATTR_FILE}
COPY_SUFFIX_RE = re.compile(r" \(copy(?: \d+)?\)$")


def categorise(entry: Entry) -> str:
    if entry.is_dir:
        return "folder"
    suffix = posixpath.splitext(entry.name)[1].lower()
    if suffix in paths.AUDIO_SUFFIXES:
        return "audio"
    if suffix in paths.SET_SUFFIXES:
        return "set"
    if suffix in paths.PRESET_SUFFIXES:
        return "preset"
    return "other"


def _sort_key(item: dict) -> tuple:
    pad = item.get("pad")
    pad_key = pad if isinstance(pad, int) else 10_000
    return (not item["is_dir"], pad_key, item["name"].lower())


def _visible(entry: Entry) -> bool:
    return not entry.name.startswith(".") and entry.name not in HIDDEN_NAMES


def listing(backend: MoveBackend, kind: str, relative: str = "") -> dict:
    absolute = paths.resolve(kind, relative)
    at_sets_root = kind == "sets" and not relative.strip("/")
    meta = sets.collect(backend) if at_sets_root else {}

    items = []
    try:
        entries = backend.list_dir(absolute)
    except PermissionError:
        raise
    except OSError as exc:
        message = str(exc).lower()
        if "permission" in message or "denied" in message:
            raise PermissionError(f"can't read {absolute}") from exc
        raise

    for entry in entries:
        if not _visible(entry):
            continue
        info = meta.get(entry.name) if at_sets_root else None
        display = info.name if info else entry.name
        item = {
            "name": display,
            "path": paths.relative_to(kind, entry.path),
            "is_dir": entry.is_dir,
            "size": entry.size,
            "mtime": entry.mtime,
            "category": "set" if info else categorise(entry),
            "pad": info.pad_number if info else None,
            "color": info.color if info else None,
            "color_id": info.color_id if info else None,
        }
        items.append(item)

    items.sort(key=_sort_key)

    payload = {
        "kind": kind,
        "path": relative.strip("/"),
        "absolute": absolute,
        "exists": backend.exists(absolute),
        "readonly": not paths.writable(kind),
        "items": items,
        "total_bytes": sum(i["size"] for i in items),
    }
    if at_sets_root:
        payload["warnings"] = sets.listing_warnings(backend, meta)
    return payload


def copy_into_samples(backend: MoveBackend, kind: str, items: list[str], dest_folder: str = "Factory") -> tuple[list[str], list[dict]]:
    """Copy factory items into UserLibrary/Samples/<dest_folder>/, keeping relative paths."""
    if kind != "factory":
        raise ValueError("can only copy from the factory library")
    if not items:
        raise ValueError("nothing to copy")

    dest_folder = (dest_folder or "Factory").replace("\\", "/").strip("/")
    if not dest_folder:
        raise ValueError("invalid destination")

    # resolve() is the traversal check, and it is the same one the per-item
    # targets below go through.
    dest_root = paths.resolve("samples", dest_folder)
    copied, failed = [], []
    for item in items:
        try:
            source = paths.resolve(kind, item)
            target = paths.resolve("samples", posixpath.join(dest_folder, item))
            if source == dest_root or dest_root.startswith(source + "/"):
                raise ValueError("can't copy a library root onto itself")
            _copy_entry(backend, source, target)
            copied.append(item)
        except Exception as exc:
            failed.append({"name": item, "error": str(exc)})
    return copied, failed


def move_into_samples(backend: MoveBackend, kind: str, items: list[str], dest_folder: str = "Recordings") -> tuple[list[str], list[dict]]:
    """Move Recordings into UserLibrary/Samples/<dest_folder>/."""
    if kind != "recordings":
        raise ValueError("can only move from Recordings")
    if not items:
        raise ValueError("nothing to move")

    dest_folder = (dest_folder or "Recordings").replace("\\", "/").strip("/")
    if not dest_folder:
        raise ValueError("invalid destination")

    # resolve() is the traversal check, and it is the same one the per-item
    # targets below go through.
    dest_root = paths.resolve("samples", dest_folder)
    moved, failed = [], []
    for item in items:
        try:
            source = paths.resolve(kind, item)
            target = paths.resolve("samples", posixpath.join(dest_folder, item))
            if source == dest_root or dest_root.startswith(source + "/"):
                raise ValueError("can't move a library root onto itself")
            if backend.exists(target):
                raise FileExistsError(f"{posixpath.basename(item)} already exists in Samples/{dest_folder}")
            backend.makedirs(posixpath.dirname(target))
            try:
                backend.rename(source, target)
            except Exception:
                # Copy-then-delete fallback for backends that cannot rename across
                # directories. If the delete fails the move did not happen, so drop
                # the copy rather than leaving the file in both places.
                _copy_entry(backend, source, target)
                try:
                    backend.remove(source)
                except Exception:
                    backend.remove(target)
                    raise
            moved.append(item)
        except Exception as exc:
            failed.append({"name": item, "error": str(exc)})
    return moved, failed


def _copy_entry(backend: MoveBackend, source: str, dest: str) -> None:
    """Copy a file or a whole tree.

    Every destination is checked before the first byte is written. A clash found
    partway through a deep tree would otherwise abort with the earlier siblings
    already copied, leaving a half-merged folder that is nobody's idea of a
    failed copy.
    """
    if not backend.exists(source):
        raise FileNotFoundError(f"{posixpath.basename(source)} not found")
    taken = _copy_clashes(backend, source, dest)
    if taken:
        raise FileExistsError(f"{posixpath.basename(taken[0])} already exists")
    _copy_tree(backend, source, dest)


def _copy_clashes(backend: MoveBackend, source: str, dest: str) -> list[str]:
    if not backend.is_dir(source):
        return [dest] if backend.exists(dest) else []
    clashes: list[str] = []
    for entry in backend.list_dir(source):
        if entry.name.startswith(".") or entry.name in HIDDEN_NAMES:
            continue
        clashes.extend(_copy_clashes(backend, entry.path, posixpath.join(dest, entry.name)))
    return clashes


def _copy_tree(backend: MoveBackend, source: str, dest: str) -> None:
    if backend.is_dir(source):
        backend.makedirs(dest)
        for entry in backend.list_dir(source):
            if entry.name.startswith(".") or entry.name in HIDDEN_NAMES:
                continue
            _copy_tree(backend, entry.path, posixpath.join(dest, entry.name))
        return
    backend.write_file(dest, backend.read_file(source))


def _top_level_items(items: list[str]) -> list[str]:
    cleaned = [item.replace("\\", "/").strip("/") for item in items if item and item.replace("\\", "/").strip("/")]
    return [
        path
        for path in cleaned
        if not any(path != other and path.startswith(other + "/") for other in cleaned)
    ]


def unique_copy_name(backend: MoveBackend, dest_dir: str, filename: str) -> str:
    """Pick `name (copy).ext`, then `name (copy 2).ext`, so a paste never clobbers."""
    stem, ext = posixpath.splitext(filename)
    base = COPY_SUFFIX_RE.sub("", stem).strip() or stem
    candidate = f"{base} (copy){ext}"
    n = 2
    while backend.exists(posixpath.join(dest_dir, candidate)):
        candidate = f"{base} (copy {n}){ext}"
        n += 1
    return candidate


def resolve_dest_dir(backend: MoveBackend, kind: str, dest: str) -> tuple[str, str]:
    """Folder to paste into. A file path means 'that file's folder', like Explorer."""
    dest = (dest or "").replace("\\", "/").strip("/")
    dest_abs = paths.resolve(kind, dest)
    if dest and backend.exists(dest_abs) and not backend.is_dir(dest_abs):
        dest = posixpath.dirname(dest)
        dest_abs = paths.resolve(kind, dest)
    if dest and not backend.is_dir(dest_abs):
        raise ValueError("destination folder not found")
    return dest, dest_abs


def copy_dest_name(backend: MoveBackend, dest_dir: str, filename: str) -> str:
    if not backend.exists(posixpath.join(dest_dir, filename)):
        return filename
    return unique_copy_name(backend, dest_dir, filename)


def can_paste(source_kind: str, dest_kind: str) -> bool:
    """Samples and Recordings are both audio libraries, so copy/paste works either way.

    Core Library can still be pasted into Samples. Other cross-section pastes
    (presets, effects, sets) stay refused.
    """
    if source_kind == dest_kind:
        return True
    if source_kind == "factory" and dest_kind == "samples":
        return True
    return {source_kind, dest_kind} <= {"samples", "recordings"}


def copy_items(
    backend: MoveBackend,
    source_kind: str,
    dest_kind: str,
    items: list[str],
    dest: str = "",
) -> tuple[list[dict], list[dict]]:
    """Copy files or folders into a destination folder.

    Same-section duplicates keep the original name when it is free, otherwise
    ` (copy)`. Factory items can be pasted into Samples. Samples and Recordings
    can be pasted into each other. Pad-set UUID folders must go through copy-set.
    """
    if not items:
        raise ValueError("nothing to copy")
    if not paths.writable(dest_kind):
        raise ValueError("can't paste into a read-only section")
    if not can_paste(source_kind, dest_kind):
        raise ValueError("can only paste within the same section")

    dest, dest_abs = resolve_dest_dir(backend, dest_kind, dest)

    copied, failed = [], []
    for item in _top_level_items(items):
        try:
            source = paths.resolve(source_kind, item)
            name = posixpath.basename(source)
            if not name:
                raise ValueError("cannot copy a library root")
            if not backend.exists(source):
                raise FileNotFoundError(f"{name} not found")

            source_at_sets_root = source_kind == "sets" and "/" not in item
            if source_at_sets_root and sets.is_set_uuid(item):
                raise ValueError("use copy-set to duplicate pad sets")

            if source == dest_abs or dest_abs.startswith(source + "/"):
                raise ValueError("can't copy a folder into itself")

            filename = copy_dest_name(backend, dest_abs, name)
            sets.guard_write(dest_kind, posixpath.join(dest, filename).replace("\\", "/"))
            target = posixpath.join(dest_abs, filename)
            _copy_entry(backend, source, target)
            copied.append({
                "src": item,
                "path": paths.relative_to(dest_kind, target),
            })
        except Exception as exc:
            failed.append({"name": item, "error": str(exc)})
    return copied, failed
