"""Move set layout: UUID folder, display name, pad index, pad colour.

A set on disk looks like:

    /data/UserData/UserLibrary/Sets/<uuid>/<Display Name>/Song.abl

The UUID folder carries Linux xattrs `user.song-index` (pad 0–31) and
`user.song-color` (1–26). The name Move shows is the inner folder, not the UUID.
Renaming a set therefore renames that inner folder and rewrites sample URIs
inside Song.abl that embed the old name.

A set with no `user.song-index` stays in the same Sets folder but is off the
32-pad grid: Move cannot open it until it is copied onto an empty pad.

On a real device, copies are built under `.mma-incoming` and then moved into
Sets/ with the final pad xattrs already set. Dropping a folder into Sets/
with the source pad's index (what `cp -a` does) makes Set Overview ignore it
until the next power cycle.
"""

from __future__ import annotations

import io
import json
import posixpath
import re
import shlex
import uuid as uuidlib
import zipfile
from dataclasses import dataclass
from urllib.parse import quote

from . import paths, storage
from .backend import MoveBackend
from .pad_colors import PAD_COLORS, hex_color

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
COPY_NAME_RE = re.compile(r" \(copy(?: \d+)?\)$")
XATTR_FILE = ".xattrs.json"
# Leave headroom so a copy cannot fill `/data` to the last byte.
SPACE_MARGIN = 8 * 1024 * 1024
COPY_TIMEOUT = 300.0
MAX_IMPORT_FILES = 2500
MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024
SKIP_IMPORT_NAMES = {
    ".xattrs.json",
    "bundleinfo.json",
    ".ds_store",
    "thumbs.db",
}

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


def guard_write(kind: str, relative: str) -> None:
    """Refuse loose files or folders at the Sets root.

    That directory is only UUID set folders plus their inner display names.
    A random folder there is invisible on the 32-pad grid and can confuse Move.
    Writes *inside* an existing set UUID are allowed.
    """
    if kind != "sets":
        return
    rel = (relative or "").replace("\\", "/").strip("/")
    parts = [part for part in rel.split("/") if part and part not in {".", ".."}]
    if not parts or not is_set_uuid(parts[0]) or len(parts) < 2:
        raise ValueError(
            "Sets root only holds pad sets — copy a set off the grid instead of adding folders here"
        )


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


def listing_warnings(backend: MoveBackend, meta: dict[str, SetMeta]) -> list[str]:
    """Surface pad collisions and junk sitting next to real sets."""
    warnings: list[str] = []
    by_pad: dict[int, list[str]] = {}
    for item in meta.values():
        if item.pad_index is None:
            continue
        by_pad.setdefault(item.pad_index, []).append(item.name)
    for index, names in sorted(by_pad.items()):
        if len(names) < 2:
            continue
        shown = ", ".join(names[:3])
        extra = "…" if len(names) > 3 else ""
        warnings.append(
            f"Pad {index + 1} has {len(names)} sets ({shown}{extra}) — extras sit off the grid"
        )
    try:
        clutter = [
            entry.name
            for entry in backend.list_dir(paths.SETS)
            if not entry.name.startswith(".") and not is_set_uuid(entry.name)
        ]
    except OSError:
        clutter = []
    if clutter:
        warnings.append(
            "Sets root has items that are not pad sets — delete them so they don't clutter the device"
        )
    return warnings


def write_sidecar(backend: MoveBackend, uuid: str, pad_index: int | None, color_id: int) -> None:
    payload = {"user.song-color": str(color_id)}
    if pad_index is not None:
        payload["user.song-index"] = str(pad_index)
    backend.write_file(
        posixpath.join(paths.SETS, uuid, XATTR_FILE),
        json.dumps(payload).encode("utf-8"),
    )


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
        pad_index = _int_or_none(attrs.get("user.song-index", ""))
        write_sidecar(backend, uuid, pad_index, color_id)

    backend.refresh_library()
    return color_id


def rename_set(backend: MoveBackend, uuid: str, new_name: str, refresh: bool = True) -> str:
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

    if refresh:
        backend.refresh_library()
    return new_name


def _rewrite_song_uuid(backend: MoveBackend, folder: str, old_uuid: str, new_uuid: str) -> None:
    """Point Song.abl at the copied UUID. Walk files so it works over SFTP too."""
    for entry in backend.list_dir(folder):
        if entry.is_dir:
            _rewrite_song_uuid(backend, entry.path, old_uuid, new_uuid)
            continue
        if entry.name != "Song.abl":
            continue
        text = backend.read_file(entry.path).decode("utf-8", "replace")
        if old_uuid not in text:
            continue
        backend.write_file(entry.path, text.replace(old_uuid, new_uuid).encode("utf-8"))


def _read_pad_index(backend: MoveBackend, uuid: str) -> int | None:
    if backend.label == "sftp":
        folder = posixpath.join(paths.SETS, uuid)
        result = backend.run(
            f"getfattr --only-values -n user.song-index {shlex.quote(folder)} 2>/dev/null || true"
        )
        return _int_or_none(result.stdout)
    return _int_or_none(_read_sidecar(backend, uuid).get("user.song-index", ""))


def _occupied_pads(meta_map: dict[str, SetMeta], exclude: str | None = None) -> set[int]:
    return {
        meta.pad_index
        for uuid, meta in meta_map.items()
        if meta.pad_index is not None and uuid != exclude
    }


def _fmt_bytes(n: int) -> str:
    value = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{n} B"


def _require_space(backend: MoveBackend, source: str) -> None:
    try:
        needed = storage.tree_bytes(backend, source)
    except (OSError, storage.StorageError):
        return
    free = storage.free_bytes(backend)
    if free is None:
        return
    margin = max(SPACE_MARGIN, needed // 20)
    if free < needed + margin:
        raise OSError(
            f"not enough free space on Move ({_fmt_bytes(free)} free, "
            f"need about {_fmt_bytes(needed + margin)} for this copy)"
        )


def _on_device(backend: MoveBackend) -> bool:
    return backend.label == "sftp"


def _work_root(backend: MoveBackend, uuid: str) -> str:
    """Where a new set is assembled before it is visible to Set Overview."""
    if _on_device(backend):
        return posixpath.join(paths.INCOMING_SETS, uuid)
    return posixpath.join(paths.SETS, uuid)


def _copy_and_detach(backend: MoveBackend, source: str, dest: str, color_id: int) -> None:
    """Copy a set folder and drop `song-index` before returning.

    `cp -a` copies xattrs, so without an immediate strip the duplicate would
    share a pad with the original until a later command ran.
    """
    if _on_device(backend):
        src_q, dst_q = shlex.quote(source), shlex.quote(dest)
        parent_q = shlex.quote(posixpath.dirname(dest))
        color = int(color_id)
        script = f"""
mkdir -p {parent_q} || exit 1
cp -a {src_q} {dst_q} || exit 1
setfattr -x user.song-index {dst_q} 2>/dev/null || true
setfattr -n user.song-color -v {color} {dst_q} || {{ rm -rf {dst_q}; exit 1; }}
idx=$(getfattr --only-values -n user.song-index {dst_q} 2>/dev/null | tr -d '\\n\\r' || true)
if [ -n "$idx" ]; then
  rm -rf {dst_q}
  echo "copy kept a pad index" >&2
  exit 1
fi
""".strip()
        result = backend.run(script, timeout=COPY_TIMEOUT)
        if not result.ok:
            if backend.exists(dest):
                backend.remove(dest)
            detail = (result.stderr or result.stdout or "copy failed").strip()
            raise RuntimeError(detail)
        return

    backend.copy_tree(source, dest)
    write_sidecar(backend, posixpath.basename(dest), None, color_id)


def _commit_set(
    backend: MoveBackend, uuid: str, pad_index: int | None, color_id: int
) -> None:
    """Give the set its final pad xattrs and, on device, move it into Sets/.

    Set Overview watches Sets/ appear. A folder that shows up already claiming
    an occupied pad is ignored; rewriting the index later does not light the
    pad until reboot. Staging + `mv` avoids that.
    """
    dest = posixpath.join(paths.SETS, uuid)
    if not _on_device(backend):
        write_sidecar(backend, uuid, pad_index, color_id)
        return

    stage = posixpath.join(paths.INCOMING_SETS, uuid)
    if not backend.is_dir(stage):
        raise RuntimeError("copied set is missing from staging")

    stage_q, dest_q = shlex.quote(stage), shlex.quote(dest)
    sets_q = shlex.quote(paths.SETS)
    color = int(color_id)
    extras = (
        f'setfattr -n user.last-modified-time -v "$(date -u +%Y-%m-%dT%H:%M:%SZ)" {stage_q}; '
        f"setfattr -n user.was-externally-modified -v false {stage_q}; "
        f"setfattr -n user.local-cloud-state -v notSynced {stage_q}"
    )
    if pad_index is None:
        index_part = f"setfattr -x user.song-index {stage_q} 2>/dev/null || true"
        verify = (
            f'test -z "$(getfattr --only-values -n user.song-index {dest_q} '
            r"2>/dev/null | tr -d '\n\r')\""
        )
    else:
        want = int(pad_index)
        index_part = f"setfattr -n user.song-index -v {want} {stage_q}"
        verify = (
            f'test "$(getfattr --only-values -n user.song-index {dest_q} '
            f"2>/dev/null | tr -d '\\n\\r')\" = \"{want}\""
        )
    script = f"""
test -d {stage_q} || exit 1
mkdir -p {sets_q} || exit 1
test ! -e {dest_q} || exit 1
setfattr -n user.song-color -v {color} {stage_q} || exit 1
{index_part} || exit 1
{extras}
mv {stage_q} {dest_q} || exit 1
{verify} || exit 1
touch {sets_q} || true
""".strip()
    result = backend.run(script, timeout=60)
    if not result.ok:
        detail = (result.stderr or result.stdout or "couldn't place set on Move").strip()
        raise RuntimeError(detail)


def _remove_copy(backend: MoveBackend, uuid: str) -> None:
    for folder in (
        posixpath.join(paths.INCOMING_SETS, uuid),
        posixpath.join(paths.SETS, uuid),
    ):
        if backend.exists(folder):
            backend.remove(folder)


def _duplicate_set(backend: MoveBackend, uuid: str) -> tuple[str, int]:
    """Copy a set folder to a new UUID with no pad assignment."""
    if not is_set_uuid(uuid):
        raise ValueError("not a pad set")
    source = posixpath.join(paths.SETS, uuid)
    if not backend.is_dir(source):
        raise FileNotFoundError("set not found")

    meta = collect(backend).get(uuid)
    color_id = meta.color_id if meta and meta.color_id is not None else 1
    _require_space(backend, source)

    new_uuid = str(uuidlib.uuid4())
    dest = _work_root(backend, new_uuid)
    while backend.exists(dest) or backend.exists(posixpath.join(paths.SETS, new_uuid)):
        new_uuid = str(uuidlib.uuid4())
        dest = _work_root(backend, new_uuid)

    try:
        _copy_and_detach(backend, source, dest, color_id)
        _rewrite_song_uuid(backend, dest, uuid, new_uuid)
        if not _on_device(backend) and _read_pad_index(backend, new_uuid) is not None:
            raise RuntimeError("copied set still has a pad index")
    except Exception:
        _remove_copy(backend, new_uuid)
        raise
    return new_uuid, color_id


def _unique_archive_name(taken: set[str], base: str) -> str:
    stem = COPY_NAME_RE.sub("", base).strip() or base
    candidate = f"{stem} (copy)"
    if candidate not in taken:
        return candidate
    n = 2
    while f"{stem} (copy {n})" in taken:
        n += 1
    return f"{stem} (copy {n})"


def copy_to_pad(backend: MoveBackend, uuid: str, pad_number: int) -> dict:
    """Duplicate a set onto an empty pad. Source stays put."""
    if not isinstance(pad_number, int) or pad_number < 1 or pad_number > 32:
        raise ValueError("pad must be 1–32")

    pad_index = pad_number - 1
    meta_map = collect(backend)
    if pad_index in _occupied_pads(meta_map):
        raise FileExistsError(f"pad {pad_number} is already used")

    new_uuid, color_id = _duplicate_set(backend, uuid)
    try:
        if pad_index in _occupied_pads(collect(backend), exclude=new_uuid):
            raise FileExistsError(f"pad {pad_number} is already used")
        _commit_set(backend, new_uuid, pad_index, color_id)
        if _read_pad_index(backend, new_uuid) != pad_index:
            raise RuntimeError(f"copy did not land on pad {pad_number}")
        others = collect(backend)
        holders = [
            meta.name
            for other, meta in others.items()
            if other != new_uuid and meta.pad_index == pad_index
        ]
        if holders:
            raise RuntimeError(
                f"pad {pad_number} already belongs to {holders[0]} — copy was not left on the grid"
            )
    except Exception:
        _remove_copy(backend, new_uuid)
        raise

    try:
        backend.refresh_library()
    except Exception:
        pass
    return {
        "path": new_uuid,
        "name": _inner_name(backend, new_uuid),
        "pad": pad_number,
        "color_id": color_id,
        "color": hex_color(color_id),
    }


def copy_off_grid(backend: MoveBackend, uuid: str) -> dict:
    """Duplicate a set on Move with no pad, so it sits under the grid."""
    new_uuid, color_id = _duplicate_set(backend, uuid)
    try:
        _commit_set(backend, new_uuid, None, color_id)
        if _read_pad_index(backend, new_uuid) is not None:
            raise RuntimeError("off-grid copy still has a pad index")
        taken = {meta.name for meta in collect(backend).values() if meta.uuid != new_uuid}
        current = _inner_name(backend, new_uuid)
        if current != new_uuid:
            archive_name = _unique_archive_name(taken, current)
            if archive_name != current:
                rename_set(backend, new_uuid, archive_name, refresh=False)
    except Exception:
        _remove_copy(backend, new_uuid)
        raise

    try:
        backend.refresh_library()
    except Exception:
        pass
    return {
        "path": new_uuid,
        "name": _inner_name(backend, new_uuid),
        "pad": None,
        "color_id": color_id,
        "color": hex_color(color_id),
    }


def _first_empty_pad(meta_map: dict[str, SetMeta]) -> int | None:
    occupied = _occupied_pads(meta_map)
    for index in range(32):
        if index not in occupied:
            return index + 1
    return None


def _require_bytes(backend: MoveBackend, needed: int) -> None:
    free = storage.free_bytes(backend)
    if free is None:
        return
    margin = max(SPACE_MARGIN, needed // 20)
    if free < needed + margin:
        raise OSError(
            f"not enough free space on Move ({_fmt_bytes(free)} free, "
            f"need about {_fmt_bytes(needed + margin)} for this set)"
        )


def _safe_set_name(name: str) -> str:
    name = (name or "").replace("\\", "/").strip().strip("/")
    name = posixpath.basename(name)
    lower = name.lower()
    for suffix in (".ablbundle", ".zip", ".abl"):
        if lower.endswith(suffix):
            name = name[: -len(suffix)]
            break
    name = re.sub(r'[<>:"|?*]', "_", name).strip(" .")
    if not name or name in {".", ".."}:
        return "Imported Set"
    return name[:80]


def _skip_import_path(relative: str) -> bool:
    parts = [part for part in relative.replace("\\", "/").split("/") if part]
    if not parts:
        return True
    if any(part == "__MACOSX" or part.startswith("._") for part in parts):
        return True
    return parts[-1].lower() in SKIP_IMPORT_NAMES


def _looks_like_song(raw: bytes) -> bool:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(payload, dict):
        return False
    schema = str(payload.get("$schema") or "").lower()
    if "preset" in schema and "song" not in schema:
        return False
    if "song" in schema:
        return True
    return "tracks" in payload and ("tempo" in payload or "scale" in payload)


def _unzip_set(data: bytes) -> dict[str, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("that file is not a Move set bundle") from exc
    found: dict[str, bytes] = {}
    total = 0
    for info in archive.infolist():
        name = info.filename.replace("\\", "/").lstrip("/")
        if name.endswith("/") or info.is_dir():
            continue
        if ".." in name.split("/"):
            raise ValueError("set bundle has an unsafe path")
        if _skip_import_path(name):
            continue
        if info.file_size < 0 or info.file_size > MAX_IMPORT_BYTES:
            raise ValueError("set bundle is too large")
        total += info.file_size
        if total > MAX_IMPORT_BYTES:
            raise ValueError("set bundle is too large")
        if len(found) >= MAX_IMPORT_FILES:
            raise ValueError("set bundle has too many files")
        found[name] = archive.read(info)
    return found


def unpack_upload(filename: str, data: bytes) -> dict[str, bytes]:
    """Turn one uploaded file into a relative path → bytes tree."""
    lower = (filename or "").lower()
    if lower.endswith(".ablbundle") or lower.endswith(".zip"):
        return _unzip_set(data)
    if zipfile.is_zipfile(io.BytesIO(data)):
        return _unzip_set(data)
    if lower.endswith(".abl"):
        return {"Song.abl": data}
    raise ValueError("upload a .ablbundle, .zip, or .abl set")


def _song_paths(tree: dict[str, bytes]) -> list[str]:
    return [
        path
        for path in tree
        if posixpath.basename(path).lower() == "song.abl" and not _skip_import_path(path)
    ]


def _tree_from_song(tree: dict[str, bytes], song_path: str) -> tuple[str, dict[str, bytes]]:
    """Keep files next to Song.abl; return (display name stem, relative tree)."""
    root = posixpath.dirname(song_path)
    prefix = f"{root}/" if root else ""
    trimmed: dict[str, bytes] = {}
    for path, payload in tree.items():
        if _skip_import_path(path):
            continue
        if root:
            if path == song_path:
                trimmed["Song.abl"] = payload
                continue
            if not path.startswith(prefix):
                continue
            relative = path[len(prefix):]
        else:
            relative = path
        if not relative or relative.endswith("/"):
            continue
        trimmed[relative] = payload
    display = _safe_set_name(posixpath.basename(root)) if root else ""
    if display and is_set_uuid(display):
        display = ""
    return display, trimmed


def _rewrite_imported_song(backend: MoveBackend, song: str, new_uuid: str, new_name: str) -> None:
    text = backend.read_file(song).decode("utf-8", "replace")
    updated = re.sub(
        r"(ableton:/user-library/Sets/)" + UUID_RE.pattern.lstrip("^").rstrip("$"),
        lambda match: match.group(1) + new_uuid,
        text,
        flags=re.IGNORECASE,
    )
    new_encoded = quote(new_name)
    for match in re.finditer(
        r"ableton:/user-library/Sets/" + re.escape(new_uuid) + r"/([^/]+)/",
        updated,
    ):
        old_encoded = match.group(1)
        if old_encoded != new_encoded:
            updated = updated.replace(
                f"Sets/{new_uuid}/{old_encoded}/",
                f"Sets/{new_uuid}/{new_encoded}/",
            )
    if updated != text:
        backend.write_file(song, updated.encode("utf-8"))


def _install_tree(backend: MoveBackend, uuid: str, display: str, tree: dict[str, bytes]) -> None:
    dest = posixpath.join(_work_root(backend, uuid), display)
    for relative, payload in tree.items():
        if relative in {"", ".", ".."} or ".." in relative.split("/"):
            raise ValueError("set has an unsafe path")
        backend.write_file(posixpath.join(dest, relative), payload)


def _place_imported(
    backend: MoveBackend,
    uuid: str,
    color_id: int,
    pad_number: int | None,
    off_grid: bool,
) -> int | None:
    meta_map = collect(backend)
    if off_grid:
        _commit_set(backend, uuid, None, color_id)
        if _read_pad_index(backend, uuid) is not None:
            raise RuntimeError("imported set still has a pad index")
        return None
    if pad_number is None:
        pad_number = _first_empty_pad(meta_map)
        if pad_number is None:
            _commit_set(backend, uuid, None, color_id)
            return None
    if not isinstance(pad_number, int) or pad_number < 1 or pad_number > 32:
        raise ValueError("pad must be 1–32")
    pad_index = pad_number - 1
    if pad_index in _occupied_pads(meta_map, exclude=uuid):
        raise FileExistsError(f"pad {pad_number} is already used")
    _commit_set(backend, uuid, pad_index, color_id)
    if _read_pad_index(backend, uuid) != pad_index:
        raise RuntimeError(f"import did not land on pad {pad_number}")
    return pad_number


def import_set(
    backend: MoveBackend,
    tree: dict[str, bytes],
    *,
    name_hint: str = "",
    pad_number: int | None = None,
    off_grid: bool = False,
    refresh: bool = True,
) -> dict:
    """Install a PC-saved Move set as a UUID folder. Empty pads get it; otherwise off-grid."""
    songs = _song_paths(tree)
    if not songs:
        raise ValueError("not a Move set — needs a Song.abl")
    song_path = min(songs, key=lambda path: (path.count("/"), len(path)))
    if not _looks_like_song(tree[song_path]):
        raise ValueError("Song.abl is not a Move set")

    display, files = _tree_from_song(tree, song_path)
    if "Song.abl" not in files:
        raise ValueError("not a Move set — needs a Song.abl")
    display = display or _safe_set_name(name_hint) or "Imported Set"
    needed = sum(len(payload) for payload in files.values())
    _require_bytes(backend, needed)

    new_uuid = str(uuidlib.uuid4())
    dest = _work_root(backend, new_uuid)
    while backend.exists(dest) or backend.exists(posixpath.join(paths.SETS, new_uuid)):
        new_uuid = str(uuidlib.uuid4())
        dest = _work_root(backend, new_uuid)

    color_id = 1
    try:
        _install_tree(backend, new_uuid, display, files)
        _rewrite_imported_song(
            backend,
            posixpath.join(dest, display, "Song.abl"),
            new_uuid,
            display,
        )
        pad = _place_imported(backend, new_uuid, color_id, pad_number, off_grid)
    except Exception:
        _remove_copy(backend, new_uuid)
        raise

    if refresh:
        try:
            backend.refresh_library()
        except Exception:
            pass
    return {
        "path": new_uuid,
        "name": _inner_name(backend, new_uuid),
        "pad": pad,
        "color_id": color_id,
        "color": hex_color(color_id),
    }


def _is_set_archive_name(relative: str) -> bool:
    base = posixpath.basename((relative or "").replace("\\", "/")).lower()
    if not base or base == "song.abl":
        return False
    return base.endswith(".ablbundle") or base.endswith(".zip") or base.endswith(".abl")


def _split_set_groups(uploads: list[tuple[str, bytes]]) -> list[tuple[str, dict[str, bytes]]]:
    """Split a folder of sets into one tree per Song.abl or .ablbundle."""
    tree = {
        path.replace("\\", "/").lstrip("/"): data
        for path, data in uploads
        if path.replace("\\", "/").strip("/")
    }
    song_dirs = []
    seen_dirs: set[str] = set()
    for path in tree:
        if posixpath.basename(path).lower() != "song.abl" or _skip_import_path(path):
            continue
        song_dir = posixpath.dirname(path)
        if song_dir in seen_dirs:
            continue
        seen_dirs.add(song_dir)
        song_dirs.append(song_dir)
    song_dirs.sort(key=lambda path: (-path.count("/"), -len(path), path))

    claimed: set[str] = set()
    groups: list[tuple[str, dict[str, bytes]]] = []
    for song_dir in song_dirs:
        prefix = f"{song_dir}/" if song_dir else ""
        files: dict[str, bytes] = {}
        for path, data in tree.items():
            if path in claimed:
                continue
            if song_dir:
                if path != posixpath.join(song_dir, "Song.abl") and not path.startswith(prefix):
                    continue
            elif _is_set_archive_name(path):
                continue
            files[path] = data
            claimed.add(path)
        if files:
            hint = posixpath.basename(song_dir) if song_dir else "Imported Set"
            groups.append((hint, files))

    for path, data in tree.items():
        if path in claimed or not _is_set_archive_name(path):
            continue
        try:
            groups.append((posixpath.basename(path), unpack_upload(path, data)))
        except ValueError:
            continue
        claimed.add(path)

    if not groups:
        raise ValueError("not a Move set — needs a Song.abl")
    return groups


def import_uploads(
    backend: MoveBackend,
    uploads: list[tuple[str, bytes]],
    *,
    pad_number: int | None = None,
    off_grid: bool = False,
) -> list[dict]:
    """Import one or more PC-saved sets. Empty pads fill first; extras go off-grid."""
    if not uploads:
        raise ValueError("nothing to import")
    groups = _split_set_groups(uploads)
    imported = []
    for index, (hint, tree) in enumerate(groups):
        this_off = off_grid
        this_pad = None if (off_grid or index > 0) else pad_number
        imported.append(
            import_set(
                backend,
                tree,
                name_hint=hint,
                pad_number=this_pad,
                off_grid=this_off,
                refresh=False,
            )
        )
    try:
        backend.refresh_library()
    except Exception:
        pass
    return imported
