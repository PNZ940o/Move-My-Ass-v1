"""Holds the live connection to a Move and lets it be reconfigured at runtime."""

from __future__ import annotations

import subprocess
import sys
import threading
from dataclasses import replace
from pathlib import Path

from ..config import PROJECT_ROOT, Settings, settings
from .backend import LocalBackend, MoveBackend, SftpBackend
from .undo import UndoStack


class MoveConnectionError(RuntimeError):
    pass


def _target_key(config: Settings) -> tuple:
    """Identifies the device an undo history belongs to."""
    if config.backend != "sftp":
        return ("mock", str(config.mock_root))
    return ("sftp", config.host, config.port, config.user)


class MoveSession:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self._backend: MoveBackend | None = None
        self._lock = threading.Lock()
        self._last_error: str | None = None
        self.undo = UndoStack()
        self._undo_target = _target_key(config)

    def backend(self) -> MoveBackend:
        with self._lock:
            switched = False
            if self._backend is None:
                self._backend = self._connect()
                target = _target_key(self.config)
                switched = target != self._undo_target
                self._undo_target = target
            backend = self._backend
        # Undo snapshots hold files copied off one particular device, so they mean
        # nothing against a different one. Drop them only once the new device has
        # actually answered — a mistyped host should not cost the history.
        if switched:
            self.undo.clear()
        return backend

    def _ensure_mock(self) -> None:
        drums = self.config.mock_root / "data" / "UserData" / "UserLibrary" / "Samples" / "Drums"
        if drums.is_dir() and any(drums.iterdir()):
            return
        script = PROJECT_ROOT / "scripts" / "make_mock.py"
        subprocess.run([sys.executable, str(script)], check=True, cwd=PROJECT_ROOT)

    def _connect(self) -> MoveBackend:
        if self.config.backend != "sftp":
            try:
                self._ensure_mock()
            except Exception as exc:
                self._last_error = f"{type(exc).__name__}: {exc}"
                raise MoveConnectionError(self._last_error) from exc
            self._last_error = None
            return LocalBackend(self.config.mock_root)
        try:
            backend = SftpBackend(
                host=self.config.host,
                port=self.config.port,
                user=self.config.user,
                key_path=self.config.key_path,
            )
        except Exception as exc:
            self._last_error = f"{type(exc).__name__}: {exc}"
            raise MoveConnectionError(self._last_error) from exc
        self._last_error = None
        return backend

    def configure(
        self,
        backend: str | None = None,
        host: str | None = None,
        user: str | None = None,
        key_path: str | None = None,
    ) -> None:
        changes: dict[str, object] = {}
        if backend:
            changes["backend"] = backend.strip().lower()
        if host:
            changes["host"] = host.strip()
        if user:
            changes["user"] = user.strip()
        if key_path is not None:
            stripped = key_path.strip()
            changes["key_path"] = Path(stripped).expanduser() if stripped else None
        with self._lock:
            self.config = replace(self.config, **changes)  # type: ignore[arg-type]
            self._close_locked()

    def disconnect(self) -> None:
        with self._lock:
            self._close_locked()
        self.undo.clear()

    def invalidate(self) -> None:
        """Throw away a connection that has died, keeping the undo history.

        The next request dials again by itself.
        """
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._backend is not None:
            try:
                self._backend.close()
            except Exception:
                pass
            self._backend = None

    def status(self) -> dict:
        with self._lock:
            connected = self._backend is not None
            label = self._backend.label if self._backend else None
        return {
            "mode": self.config.backend,
            "connected": connected,
            "backend": label,
            "host": self.config.host,
            "user": self.config.user,
            "key_path": str(self.config.key_path) if self.config.key_path else None,
            "mock_root": str(self.config.mock_root),
            "last_error": self._last_error,
        }


session = MoveSession(settings)
