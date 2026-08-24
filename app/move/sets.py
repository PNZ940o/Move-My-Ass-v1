"""Move set layout: UUID folder, display name, pad index, pad colour.

A set on disk looks like:

    /data/UserData/UserLibrary/Sets/<uuid>/<Display Name>/Song.abl

The UUID folder carries Linux xattrs `user.song-index` (pad 0–31) and
`user.song-color` (1–26). The name Move shows is the inner folder, not the UUID.
Renaming a set therefore renames that inner folder and rewrites sample URIs
inside Song.abl that embed the old name.
"""

from __future__ import annotations

import json
import posixpath
import re
import shlex
from dataclasses import dataclass
from urllib.parse import quote

from . import paths
from .backend import MoveBackend
from .pad_colors import PAD_COLORS, hex_color

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
XATTR_FILE = ".xattrs.json"

# One remote shell pass: uuid, pad, colour, display name. Name is last so it
# can contain spaces. getfattr is what Move itself uses for these attributes.
SETS_DUMP_CMD = r"""
for d in /data/UserData/UserLibrary/Sets/*; do
  [ -d "$d" ] || continue
  uuid=${d##*/}
  name=
  for c in "$d"/*; do
    [ -d "$c" ] || continue
    b=${c##*/}
    name=$b
    break
  done
  idx=$(getfattr --only-values -n user.song-index "$d" 2>/dev/null || true)
  col=$(getfattr --only-values -n user.song-color "$d" 2>/dev/null || true)
  printf '%s\t%s\t%s\t%s\n' "$uuid" "$idx" "$col" "$name"
done
""".strip()


@dataclass
class SetMeta:
    uuid: str
    name: str
    pad_index: int | None
    color_id: int | None

    @property
    def pad_number(self) -> int | None:
        """1-based pad number as shown on the 32-pad grid."""
        if self.pad_index is None:
            return None
        return self.pad_index + 1

    @property
    def color(self) -> str | None:
        return hex_color(self.color_id)


def is_set_uuid(name: str) -> bool:
    return bool(UUID_RE.match(name))


def _int_or_none(value: str) -> int | None:
    value = (value or "").strip()
    if value.isdigit():
        return int(value)
    return None


def _parse_dump(text: str) -> dict[str, SetMeta]:
    found: dict[str, SetMeta] = {}
    for line in text.splitlines():
        parts = line.split("\t", 3)
        if len(parts) < 4 or not is_set_uuid(parts[0]):
            continue
        uuid, idx, col, name = parts
        found[uuid] = SetMeta(
            uuid=uuid,
            name=name.strip() or uuid,
            pad_index=_int_or_none(idx),
            color_id=_int_or_none(col),
        )
    return found


def _inner_name(backend: MoveBackend, uuid: str) -> str:
    absolute = posixpath.join(paths.SETS, uuid)
    for entry in backend.list_dir(absolute):
        if entry.is_dir and not entry.name.startswith("."):
            return entry.name
    return uuid


def _read_sidecar(backend: MoveBackend, uuid: str) -> dict[str, str]:
    sidecar = posixpath.join(paths.SETS, uuid, XATTR_FILE)
    if not backend.exists(sidecar):
        return {}
    try:
        return json.loads(backend.read_file(sidecar).decode("utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}


def collect(backend: MoveBackend) -> dict[str, SetMeta]:
    """Return metadata keyed by UUID, using xattrs on the device or a sidecar in mock."""
    if backend.label == "sftp":
        result = backend.run(SETS_DUMP_CMD)
        dumped = _parse_dump(result.stdout) if result.ok else {}
        if dumped:
            return dumped

    found: dict[str, SetMeta] = {}
    for entry in backend.list_dir(paths.SETS):
        if not entry.is_dir or not is_set_uuid(entry.name):
            continue
        attrs = _read_sidecar(backend, entry.name)
        found[entry.name] = SetMeta(
            uuid=entry.name,
            name=_inner_name(backend, entry.name),
            pad_index=_int_or_none(attrs.get("user.song-index", "")),
            color_id=_int_or_none(attrs.get("user.song-color", "")),
        )
    return found


def write_sidecar(backend: MoveBackend, uuid: str, pad_index: int, color_id: int) -> None:
    payload = json.dumps(
        {"user.song-index": str(pad_index), "user.song-color": str(color_id)}
    ).encode("utf-8")
    backend.write_file(posixpath.join(paths.SETS, uuid, XATTR_FILE), payload)


def set_color(backend: MoveBackend, uuid: str, color_id: int) -> int:
    """Change the pad LED colour for a set. IDs match Move's 1–26 range."""
    if not is_set_uuid(uuid):
        raise ValueError("not a pad set")
    if color_id not in PAD_COLORS and color_id != 26:
        raise ValueError("unknown pad colour")

    folder = posixpath.join(paths.SETS, uuid)
    if not backend.is_dir(folder):
        raise FileNotFoundError("set not found")

    if backend.label == "sftp":
        quoted = shlex.quote(folder)
        result = backend.run(f"setfattr -n user.song-color -v {int(color_id)} {quoted}")
        if not result.ok:
            detail = (result.stderr or result.stdout or "setfattr failed").strip()
            raise RuntimeError(detail)
    else:
        attrs = _read_sidecar(backend, uuid)
        pad_index = _int_or_none(attrs.get("user.song-index", "")) or 0
        write_sidecar(backend, uuid, pad_index, color_id)

    backend.refresh_library()
    return color_id


def rename_set(backend: MoveBackend, uuid: str, new_name: str) -> str:
    """Rename the inner display folder and rewrite Song.abl sample URIs."""
    if "/" in new_name or new_name in {"", ".", ".."}:
        raise ValueError("invalid name")

    old_name = _inner_name(backend, uuid)
    if old_name == uuid:
        raise FileNotFoundError("this set has no named folder to rename")
    if old_name == new_name:
        return new_name

    src = posixpath.join(paths.SETS, uuid, old_name)
    dst = posixpath.join(paths.SETS, uuid, new_name)
    if backend.exists(dst):
        raise FileExistsError(f"{new_name} already exists")

    backend.rename(src, dst)

    song = posixpath.join(dst, "Song.abl")
    if backend.exists(song) and not backend.is_dir(song):
        text = backend.read_file(song).decode("utf-8", "replace")
        updated = text.replace(quote(old_name), quote(new_name))
        if old_name != quote(old_name):
            updated = updated.replace(old_name, new_name)
        if updated != text:
            backend.write_file(song, updated.encode("utf-8"))

    backend.refresh_library()
    return new_name
