"""Undo stack for library mutations.

Each successful write is recorded as inverse steps plus a local snapshot of any
files that would be lost. Ctrl+Z asks the server to play that inverse back.
"""

from __future__ import annotations

import posixpath
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

from . import sets
from .backend import MoveBackend

MAX_ENTRIES = 40
DIR_MARK = ".dir"


class UndoError(RuntimeError):
    pass


@dataclass
class UndoEntry:
    label: str
    steps: list[dict]
    cache: Path
    refresh: bool = True


@dataclass
class UndoStack:
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _entries: list[UndoEntry] = field(default_factory=list)

    def push(self, entry: UndoEntry) -> None:
        with self._lock:
            self._entries.append(entry)
            while len(self._entries) > MAX_ENTRIES:
                old = self._entries.pop(0)
                _forget(old)

    def peek(self) -> dict:
        with self._lock:
            if not self._entries:
                return {"can_undo": False, "label": None, "count": 0}
            return {
                "can_undo": True,
                "label": self._entries[-1].label,
                "count": len(self._entries),
            }

    def pop(self) -> UndoEntry | None:
        with self._lock:
            if not self._entries:
                return None
            return self._entries.pop()

    def clear(self) -> None:
        with self._lock:
            entries = self._entries
            self._entries = []
        for entry in entries:
            _forget(entry)


class Builder:
    """Collect inverse steps while a mutation is still in flight."""

    def __init__(self, backend: MoveBackend, label: str):
        self.backend = backend
        self.label = label
        self.cache = Path(tempfile.mkdtemp(prefix="mma-undo-"))
        self.steps: list[dict] = []
        self._n = 0
        self._kept = False

    def will_overwrite(self, path: str) -> None:
        if self.backend.exists(path):
            self._capture(path)
        else:
            self.steps.append({"op": "remove", "path": path})

    def will_remove(self, path: str) -> None:
        if self.backend.exists(path):
            self._capture(path)

    def will_rename(self, src: str, dst: str) -> None:
        self.steps.append({"op": "rename", "src": dst, "dst": src})

    def will_rename_set(self, uuid: str, name: str) -> None:
        self.steps.append({"op": "rename_set", "uuid": uuid, "name": name})

    def will_set_color(self, uuid: str, color_id: int) -> None:
        self.steps.append({"op": "set_color", "uuid": uuid, "color_id": int(color_id)})

    def created(self, path: str) -> None:
        self.steps.append({"op": "remove", "path": path})

    def checkpoint(self) -> int:
        return len(self.steps)

    def revert_to(self, mark: int) -> None:
        while len(self.steps) > mark:
            self.drop_last()

    def drop_last(self) -> None:
        if not self.steps:
            return
        step = self.steps.pop()
        key = step.get("key")
        if key:
            shutil.rmtree(self.cache / str(key), ignore_errors=True)

    def commit(self, stack: UndoStack) -> None:
        if not self.steps:
            _rmtree(self.cache)
            return
        stack.push(UndoEntry(self.label, self.steps, self.cache))
        self._kept = True

    def discard(self) -> None:
        if not self._kept:
            _rmtree(self.cache)
            self._kept = True

    def _capture(self, path: str) -> None:
        key = str(self._n)
        self._n += 1
        dest = self.cache / key
        is_dir = self.backend.is_dir(path)
        dump_tree(self.backend, path, dest)
        self.steps.append({"op": "restore", "path": path, "key": key, "dir": is_dir})


def dump_tree(backend: MoveBackend, path: str, dest: Path) -> None:
    if backend.is_dir(path):
        dest.mkdir(parents=True, exist_ok=True)
        (dest / DIR_MARK).write_bytes(b"")
        for entry in backend.list_dir(path):
            dump_tree(backend, entry.path, dest / entry.name)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(backend.read_file(path))


def restore_tree(backend: MoveBackend, dest: Path, path: str) -> None:
    if dest.is_dir():
        backend.makedirs(path)
        for child in dest.iterdir():
            if child.name == DIR_MARK:
                continue
            restore_tree(backend, child, posixpath.join(path, child.name))
        return
    backend.write_file(path, dest.read_bytes())


def apply_entry(backend: MoveBackend, entry: UndoEntry) -> None:
    """Play an entry's inverse steps, newest first.

    Stops at the first failure and leaves the outstanding steps on the entry, so
    a retry resumes instead of replaying work that already succeeded. Only a
    clean run throws away the cached bytes, because they are the sole copy of
    anything the original operation overwrote.
    """
    pending = list(reversed(entry.steps))
    while pending:
        step = pending[0]
        try:
            _apply_step(backend, entry.cache, step)
        except Exception as exc:
            entry.steps = list(reversed(pending))
            raise UndoError(f"{step.get('op')} {step.get('path', '')}: {exc}".strip()) from exc
        pending.pop(0)
    entry.steps = []
    _forget(entry)


def apply(backend: MoveBackend, stack: UndoStack) -> str:
    entry = stack.pop()
    if entry is None:
        raise UndoError("nothing to undo")
    label = entry.label
    refresh = entry.refresh
    try:
        apply_entry(backend, entry)
    except UndoError:
        # Back on the stack with its cache, so the cause can be fixed and retried.
        stack.push(entry)
        raise
    finally:
        if refresh:
            try:
                backend.refresh_library()
            except Exception:
                pass
    return label


def _apply_step(backend: MoveBackend, cache: Path, step: dict) -> None:
    op = step.get("op")
    if op == "remove":
        path = step["path"]
        if backend.exists(path):
            backend.remove(path)
        return
    if op == "rename":
        backend.rename(step["src"], step["dst"])
        return
    if op == "restore":
        path = step["path"]
        dest = cache / str(step["key"])
        if backend.exists(path):
            backend.remove(path)
        restore_tree(backend, dest, path)
        return
    if op == "rename_set":
        sets.rename_set(backend, step["uuid"], step["name"])
        return
    if op == "set_color":
        sets.set_color(backend, step["uuid"], step["color_id"])
        return
    raise UndoError(f"unknown undo step {op!r}")


def _forget(entry: UndoEntry) -> None:
    _rmtree(entry.cache)


def _rmtree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
