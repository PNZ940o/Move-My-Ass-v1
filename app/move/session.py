"""Holds the live connection to a Move and lets it be reconfigured at runtime."""

from __future__ import annotations

import threading
from dataclasses import replace
from pathlib import Path

from ..config import Settings, settings
from .backend import LocalBackend, MoveBackend, SftpBackend


class MoveConnectionError(RuntimeError):
    pass


class MoveSession:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self._backend: MoveBackend | None = None
        self._lock = threading.Lock()
        self._last_error: str | None = None

    def backend(self) -> MoveBackend:
        with self._lock:
            if self._backend is None:
                self._backend = self._connect()
            return self._backend

    def _connect(self) -> MoveBackend:
        if self.config.backend != "sftp":
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
