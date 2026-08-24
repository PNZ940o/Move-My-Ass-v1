from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    backend: str
    host: str
    port: int
    user: str
    key_path: Path | None
    mock_root: Path

    @classmethod
    def from_env(cls) -> Settings:
        key = os.environ.get("MOVE_KEY", "").strip()
        mock = os.environ.get("MOVE_MOCK_ROOT", "").strip()
        return cls(
            backend=os.environ.get("MOVE_BACKEND", "mock").strip().lower(),
            host=os.environ.get("MOVE_HOST", "move.local").strip(),
            port=int(os.environ.get("MOVE_PORT", "22")),
            user=os.environ.get("MOVE_USER", "ableton").strip(),
            key_path=Path(key).expanduser() if key else None,
            mock_root=Path(mock).expanduser() if mock else PROJECT_ROOT / "mock-move",
        )


settings = Settings.from_env()
