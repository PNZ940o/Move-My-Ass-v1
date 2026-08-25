"""Reads and classifies the contents of Move's user library."""

from __future__ import annotations

import posixpath

from . import paths, sets
from .backend import Entry, MoveBackend


HIDDEN_NAMES = {sets.XATTR_FILE}


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

    return {
        "kind": kind,
        "path": relative.strip("/"),
        "absolute": absolute,
        "exists": backend.exists(absolute),
        "readonly": not paths.writable(kind),
        "items": items,
        "total_bytes": sum(i["size"] for i in items),
    }


def copy_into_samples(backend: MoveBackend, kind: str, items: list[str], dest_folder: str = "Factory") -> tuple[list[str], list[dict]]:
    """Copy factory items into UserLibrary/Samples/<dest_folder>/, keeping relative paths."""
    if kind != "factory":
        raise ValueError("can only copy from the factory library")
    if not items:
        raise ValueError("nothing to copy")

    dest_folder = (dest_folder or "Factory").replace("\\", "/").strip("/")
    if not dest_folder or ".." in dest_folder.split("/"):
        raise ValueError("invalid destination")

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
    if not dest_folder or ".." in dest_folder.split("/"):
        raise ValueError("invalid destination")

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
                _copy_entry(backend, source, target)
                backend.remove(source)
            moved.append(item)
        except Exception as exc:
            failed.append({"name": item, "error": str(exc)})
    return moved, failed


def _copy_entry(backend: MoveBackend, source: str, dest: str) -> None:
    if backend.is_dir(source):
        backend.makedirs(dest)
        for entry in backend.list_dir(source):
            if entry.name.startswith(".") or entry.name in HIDDEN_NAMES:
                continue
            _copy_entry(backend, entry.path, posixpath.join(dest, entry.name))
        return
    if backend.exists(dest):
        raise FileExistsError(f"{posixpath.basename(dest)} already exists in Samples")
    backend.write_file(dest, backend.read_file(source))
