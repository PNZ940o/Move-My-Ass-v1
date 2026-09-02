from __future__ import annotations

import io
import json
import posixpath
import re
import zipfile

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .config import PROJECT_ROOT
from .move import effects, kits, library, paths, presets, sets, storage, undo
from .move.backend import MoveBackend
from .move.pad_colors import PAD_COLORS, hex_color
from .move.paths import UnsafePath
from .move.session import MoveConnectionError, session

app = FastAPI(title="Move My Ass v1")
app.mount("/static", StaticFiles(directory=PROJECT_ROOT / "app" / "static"), name="static")
templates = Jinja2Templates(directory=PROJECT_ROOT / "app" / "templates")


def get_backend() -> MoveBackend:
    try:
        return session.backend()
    except MoveConnectionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def require_writable(kind: str) -> None:
    if not paths.writable(kind):
        raise HTTPException(status_code=403, detail="factory library is read-only")


def commit_undo(builder: undo.Builder) -> None:
    builder.commit(session.undo)


@app.exception_handler(UnsafePath)
async def unsafe_path_handler(request: Request, exc: UnsafePath) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "sections": list(paths.LIBRARY_ROOTS),
            "section_labels": paths.SECTION_LABELS,
        },
    )


@app.get("/api/status")
async def status():
    return session.status()


@app.get("/api/storage")
async def device_storage():
    try:
        backend = get_backend()
        return await run_in_threadpool(storage.usage, backend)
    except storage.StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ConnectRequest(BaseModel):
    backend: str | None = None
    host: str | None = None
    user: str | None = None
    key_path: str | None = None


@app.post("/api/connect")
async def connect(body: ConnectRequest):
    session.configure(
        backend=body.backend, host=body.host, user=body.user, key_path=body.key_path
    )
    get_backend()
    return session.status()


@app.post("/api/disconnect")
async def disconnect():
    session.disconnect()
    return session.status()


@app.get("/api/list")
async def list_dir(kind: str, path: str = ""):
    try:
        return library.listing(get_backend(), kind, path)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/api/upload")
async def upload(
    kind: str = Form(...),
    dest: str = Form(""),
    files: list[UploadFile] = File(...),
    relpaths: list[str] = Form(default=[]),
):
    require_writable(kind)
    backend = get_backend()
    written, failed = [], []
    dest_folder = (dest or "").replace("\\", "/").strip("/")
    label = "upload" if len(files) != 1 else posixpath.basename(
        (relpaths[0] if relpaths else files[0].filename) or "file"
    )
    builder = undo.Builder(backend, f"Upload {label}" if len(files) == 1 else f"Upload {len(files)} files")

    for index, upload_file in enumerate(files):
        name = upload_file.filename or f"upload-{index}"
        relative = relpaths[index] if index < len(relpaths) and relpaths[index] else name
        relative = relative.replace("\\", "/").lstrip("/")
        mark = builder.checkpoint()
        try:
            sets.guard_write(kind, posixpath.join(dest_folder, relative))
            target = paths.resolve(kind, posixpath.join(dest_folder, relative))
            builder.will_overwrite(target)
            backend.write_file(target, await upload_file.read())
            written.append(relative)
        except Exception as exc:
            builder.revert_to(mark)
            failed.append({"name": relative, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            await upload_file.close()

    commit_undo(builder)
    return {"written": written, "failed": failed, "count": len(written)}


class PathRequest(BaseModel):
    kind: str
    path: str = ""


@app.post("/api/mkdir")
async def mkdir(body: PathRequest):
    require_writable(body.kind)
    try:
        sets.guard_write(body.kind, body.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    target = paths.resolve(body.kind, body.path)
    if target == paths.LIBRARY_ROOTS[body.kind]:
        raise HTTPException(status_code=400, detail="give the folder a name")
    backend = get_backend()
    existed = backend.exists(target)
    backend.makedirs(target)
    if not existed:
        builder = undo.Builder(backend, f"New folder {posixpath.basename(target)}")
        builder.created(target)
        commit_undo(builder)
    return {"ok": True, "path": target}


class DeleteRequest(BaseModel):
    kind: str
    items: list[str]


@app.post("/api/delete")
async def delete(body: DeleteRequest):
    require_writable(body.kind)
    backend = get_backend()
    removed, failed = [], []
    label = (
        f"Delete {posixpath.basename(body.items[0])}"
        if len(body.items) == 1
        else f"Delete {len(body.items)} items"
    )
    builder = undo.Builder(backend, label)
    for item in body.items:
        mark = builder.checkpoint()
        try:
            target = paths.resolve(body.kind, item)
            builder.will_remove(target)
            backend.remove(target)
            removed.append(item)
        except Exception as exc:
            builder.revert_to(mark)
            failed.append({"name": item, "error": f"{type(exc).__name__}: {exc}"})
    commit_undo(builder)
    return {"removed": removed, "failed": failed}


class RenameRequest(BaseModel):
    kind: str
    path: str
    new_name: str


def _keep_suffix(original: str, new_name: str) -> str:
    """Re-attach a file's extension if the new name dropped it.

    Renaming `Kit.ablpreset` to `Kit 2` would otherwise leave Move with a file it
    no longer recognises. Matching on the whole suffix rather than "has any dot"
    means a name like `Kit 2.0` keeps its extension too.
    """
    suffix = posixpath.splitext(original)[1]
    if not suffix or new_name.lower().endswith(suffix.lower()):
        return new_name
    return new_name + suffix


@app.post("/api/rename")
async def rename(body: RenameRequest):
    require_writable(body.kind)
    if "/" in body.new_name or body.new_name in {"", ".", ".."}:
        raise HTTPException(status_code=400, detail="invalid name")

    backend = get_backend()
    source = paths.resolve(body.kind, body.path)
    name = body.new_name

    # A set's UUID folder is not the name Move shows. Rename the inner folder.
    at_sets_root = body.kind == "sets" and "/" not in body.path.strip("/")
    if at_sets_root and sets.is_set_uuid(body.path) and backend.is_dir(source):
        old_name = sets._inner_name(backend, body.path)
        try:
            name = sets.rename_set(backend, body.path, name)
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if name != old_name:
            builder = undo.Builder(backend, f"Rename {old_name}")
            builder.will_rename_set(body.path, old_name)
            commit_undo(builder)
        return {"ok": True, "name": name}

    if not backend.is_dir(source):
        name = _keep_suffix(posixpath.basename(source), name)

    target = posixpath.join(posixpath.dirname(source), name)
    if target != source and backend.exists(target):
        raise HTTPException(status_code=409, detail=f"{name} already exists")

    if target != source:
        builder = undo.Builder(backend, f"Rename {posixpath.basename(source)}")
        builder.will_rename(source, target)
        backend.rename(source, target)
        commit_undo(builder)
    return {"ok": True, "name": name}


@app.get("/api/pad-colors")
async def pad_colors():
    return {
        "colors": [
            {"id": color_id, "hex": hex_color(color_id)}
            for color_id in sorted(PAD_COLORS)
        ]
    }


class SetColorRequest(BaseModel):
    path: str
    color_id: int


@app.post("/api/set-color")
async def change_set_color(body: SetColorRequest):
    """Set the LED colour on a pad set. Does not move the set on the grid."""
    backend = get_backend()
    meta = sets.collect(backend).get(body.path)
    previous = meta.color_id if meta and meta.color_id is not None else 1
    try:
        color_id = sets.set_color(backend, body.path, body.color_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if color_id != previous:
        builder = undo.Builder(backend, "Pad color")
        builder.will_set_color(body.path, previous)
        commit_undo(builder)
    return {"ok": True, "color_id": color_id, "color": hex_color(color_id)}


class CopySetRequest(BaseModel):
    path: str
    pad: int | None = None


@app.post("/api/copy-set")
async def copy_set(body: CopySetRequest):
    """Duplicate a set onto an empty pad, or off the grid when pad is omitted."""
    backend = get_backend()
    try:
        if body.pad is None:
            copied = sets.copy_off_grid(backend, body.path)
        else:
            copied = sets.copy_to_pad(backend, body.path, body.pad)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc
    builder = undo.Builder(backend, f"Copy {copied.get('name') or 'set'}")
    builder.created(posixpath.join(paths.SETS, copied["path"]))
    commit_undo(builder)
    return {"ok": True, **copied}


@app.post("/api/import-set")
async def import_set(
    files: list[UploadFile] = File(...),
    relpaths: list[str] = Form(default=[]),
    pad: int | None = Form(None),
    off_grid: bool = Form(False),
):
    """Install a PC-saved .ablbundle / .zip / .abl / Song.abl folder as a real set."""
    backend = get_backend()
    uploads: list[tuple[str, bytes]] = []
    try:
        for index, upload_file in enumerate(files):
            name = upload_file.filename or f"upload-{index}"
            relative = relpaths[index] if index < len(relpaths) and relpaths[index] else name
            uploads.append((relative.replace("\\", "/").lstrip("/"), await upload_file.read()))
    finally:
        for upload_file in files:
            await upload_file.close()

    try:
        imported = await run_in_threadpool(
            lambda: sets.import_uploads(
                backend, uploads, pad_number=pad, off_grid=off_grid
            )
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc

    if imported:
        label = (
            f"Import {imported[0].get('name') or 'set'}"
            if len(imported) == 1
            else f"Import {len(imported)} sets"
        )
        builder = undo.Builder(backend, label)
        for item in imported:
            builder.created(posixpath.join(paths.SETS, item["path"]))
        commit_undo(builder)
    return {"ok": True, "imported": imported, "count": len(imported)}


class MoveRequest(BaseModel):
    kind: str
    items: list[str]
    dest: str = ""


@app.post("/api/move")
async def move_items(body: MoveRequest):
    """Move files or folders into a destination folder in the same section."""
    require_writable(body.kind)
    if not body.items:
        raise HTTPException(status_code=400, detail="nothing to move")

    backend = get_backend()
    try:
        dest, dest_abs = library.resolve_dest_dir(backend, body.kind, body.dest)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    moved, failed = [], []
    builder = undo.Builder(
        backend,
        f"Move {posixpath.basename(body.items[0])}"
        if len(body.items) == 1
        else f"Move {len(body.items)} items",
    )
    for item in body.items:
        mark = builder.checkpoint()
        try:
            source = paths.resolve(body.kind, item)
            name = posixpath.basename(source)
            if not name:
                raise ValueError("cannot move a library root")

            at_sets_root = body.kind == "sets" and "/" not in item.strip("/")
            if at_sets_root and sets.is_set_uuid(item):
                raise ValueError("pad sets stay on the grid")

            sets.guard_write(body.kind, posixpath.join(dest, name).replace("\\", "/"))

            if source == dest_abs or dest_abs.startswith(source + "/"):
                raise ValueError("can't move a folder into itself")

            target = posixpath.join(dest_abs, name)
            if posixpath.dirname(source) == dest_abs:
                moved.append(item)
                continue
            if backend.exists(target):
                raise FileExistsError(f"{name} already exists there")

            builder.will_rename(source, target)
            backend.rename(source, target)
            moved.append(item)
        except Exception as exc:
            builder.revert_to(mark)
            failed.append({"name": item, "error": str(exc)})

    commit_undo(builder)
    if moved:
        backend.refresh_library()
    return {"moved": moved, "failed": failed}


class CopyRequest(BaseModel):
    kind: str
    items: list[str]
    dest: str = ""
    source_kind: str | None = None


@app.post("/api/copy")
async def copy_items(body: CopyRequest):
    """Duplicate files or folders into a destination folder.

    `source_kind` defaults to `kind`. Factory items may be pasted into Samples.
    Samples and Recordings may be pasted into each other.
    """
    source_kind = body.source_kind or body.kind
    require_writable(body.kind)
    try:
        copied, failed = library.copy_items(
            get_backend(), source_kind, body.kind, body.items, body.dest
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if copied:
        backend = get_backend()
        builder = undo.Builder(
            backend,
            f"Copy {posixpath.basename(copied[0]['src'])}"
            if len(copied) == 1
            else f"Copy {len(copied)} items",
        )
        for item in copied:
            builder.created(paths.resolve(body.kind, item["path"]))
        commit_undo(builder)
        backend.refresh_library()
    return {"copied": copied, "failed": failed}


class CopyToSamplesRequest(BaseModel):
    kind: str = "factory"
    items: list[str]
    dest: str = "Factory"


@app.post("/api/copy-to-samples")
async def copy_to_samples(body: CopyToSamplesRequest):
    """Copy factory items into Samples/Factory without touching CoreLibrary."""
    try:
        copied, failed = library.copy_into_samples(
            get_backend(), body.kind, body.items, body.dest
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dest = (body.dest or "Factory").strip("/")
    if copied:
        backend = get_backend()
        builder = undo.Builder(
            backend,
            f"Copy to Samples"
            if len(copied) != 1
            else f"Copy {posixpath.basename(copied[0])}",
        )
        for item in copied:
            builder.created(paths.resolve("samples", posixpath.join(dest, item)))
        commit_undo(builder)
        backend.refresh_library()
    return {"copied": copied, "failed": failed, "dest": dest}


class MoveToSamplesRequest(BaseModel):
    kind: str = "recordings"
    items: list[str]
    dest: str = "Recordings"


@app.post("/api/move-to-samples")
async def move_to_samples(body: MoveToSamplesRequest):
    """Move Recordings into Samples so they can be sliced and used in kits."""
    try:
        moved, failed = library.move_into_samples(
            get_backend(), body.kind, body.items, body.dest
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dest = (body.dest or "Recordings").strip("/")
    if moved:
        backend = get_backend()
        builder = undo.Builder(
            backend,
            "Move to Samples"
            if len(moved) != 1
            else f"Move {posixpath.basename(moved[0])}",
        )
        for item in moved:
            source = paths.resolve("recordings", item)
            target = paths.resolve("samples", posixpath.join(dest, item))
            builder.will_rename(source, target)
        commit_undo(builder)
        backend.refresh_library()
    return {"moved": moved, "failed": failed, "dest": dest}


@app.get("/api/download")
async def download(kind: str, path: str):
    backend = get_backend()
    absolute = paths.resolve(kind, path)
    name = posixpath.basename(absolute) or kind

    if backend.is_dir(absolute):
        return Response(
            _zip_bytes(backend, [(absolute, "")]),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
        )
    if not backend.exists(absolute):
        raise HTTPException(status_code=404, detail=f"not found: {path}")

    return Response(
        backend.read_file(absolute),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


class DownloadManyRequest(BaseModel):
    kind: str
    items: list[str]
    folder: str = ""


@app.post("/api/download-zip")
async def download_many(body: DownloadManyRequest):
    backend = get_backend()
    if not body.items:
        raise HTTPException(status_code=400, detail="nothing selected")

    targets = []
    for item in body.items:
        absolute = paths.resolve(body.kind, item)
        arcname = posixpath.basename(absolute)
        if not arcname:
            raise HTTPException(status_code=400, detail="cannot zip a library root")
        targets.append((absolute, arcname))

    label = posixpath.basename(paths.resolve(body.kind, body.folder)) or body.kind
    return Response(
        _zip_bytes(backend, targets),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{_safe_filename(label)}.zip"'
        },
    )


def _zip_bytes(backend: MoveBackend, items: list[tuple[str, str]]) -> bytes:
    """Zip (absolute path, name inside the archive) pairs, walking any folders.

    An empty archive name puts a folder's contents at the top level, which is
    what a single-folder download wants; a name nests them under it instead.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for absolute, arcname in items:
            if not backend.is_dir(absolute):
                archive.writestr(arcname or posixpath.basename(absolute),
                                 backend.read_file(absolute))
                continue
            if arcname and not backend.list_dir(absolute):
                archive.writestr(f"{arcname}/", b"")
            stack = [absolute]
            while stack:
                current = stack.pop()
                for entry in backend.list_dir(current):
                    if entry.is_dir:
                        stack.append(entry.path)
                    else:
                        archive.writestr(
                            posixpath.join(
                                arcname, posixpath.relpath(entry.path, absolute)
                            ),
                            backend.read_file(entry.path),
                        )
    return buffer.getvalue()


_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


@app.get("/api/preview")
async def preview(request: Request, kind: str, path: str):
    """Stream an audio file to a browser <audio>, honouring Range requests."""
    backend = get_backend()
    absolute = paths.resolve(kind, path)
    media_type = paths.AUDIO_MEDIA_TYPES.get(posixpath.splitext(absolute)[1].lower())
    if media_type is None:
        raise HTTPException(status_code=400, detail=f"not previewable audio: {path}")
    if backend.is_dir(absolute) or not backend.exists(absolute):
        raise HTTPException(status_code=404, detail=f"not found: {path}")

    size = backend.file_size(absolute)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    match = _RANGE.fullmatch((request.headers.get("range") or "").strip())
    if match is None:
        # No Range, or something we don't parse (multipart ranges): serve it whole,
        # which the spec allows and every browser copes with.
        return Response(backend.read_file(absolute), media_type=media_type, headers=headers)

    first, last = match.group(1), match.group(2)
    if first:
        start = int(first)
        end = int(last) if last else size - 1
    else:
        start = max(0, size - int(last or 0))
        end = size - 1
    end = min(end, size - 1)

    if start > end or start >= size:
        return Response(
            status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"}
        )

    return Response(
        backend.read_range(absolute, start, end - start + 1),
        status_code=206,
        media_type=media_type,
        headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"},
    )


def _kit_section(section: str) -> str:
    if section not in kits.SECTION_NAMES:
        raise HTTPException(
            status_code=400, detail="kits can only draw from samples or recordings"
        )
    return section


class KitPadPlanRequest(BaseModel):
    folder: str = ""
    section: str = "samples"


@app.post("/api/kit/plan-pads")
async def kit_plan_pads(body: KitPadPlanRequest):
    backend = get_backend()
    section = _kit_section(body.section)
    absolute = paths.resolve(section, body.folder)
    audio = sorted(
        (
            entry.name
            for entry in backend.list_dir(absolute)
            if not entry.is_dir
            and posixpath.splitext(entry.name)[1].lower() in paths.AUDIO_SUFFIXES
        ),
        key=str.lower,
    )
    slots, unplaced = kits.assign_smart(audio)
    return {
        "folder": body.folder.strip("/"),
        "section": section,
        "available": audio,
        "pads": [
            {
                "index": index,
                "note": kits.BASE_NOTE + index,
                "role": kits.PAD_ROLES[index],
                "sample": slots[index],
            }
            for index in range(kits.PAD_COUNT)
        ],
        "unplaced": unplaced,
    }


class KitSlicePlanRequest(BaseModel):
    sample: str
    count: int = 16
    section: str = "samples"


@app.post("/api/kit/plan-slices")
async def kit_plan_slices(body: KitSlicePlanRequest):
    backend = get_backend()
    data = backend.read_file(paths.resolve(_kit_section(body.section), body.sample))
    try:
        duration = kits.duration_seconds(data)
    except kits.AudioError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "sample": body.sample,
        "duration": duration,
        "peaks": kits.waveform_peaks(data),
        "slices": kits.equal_slices(body.count, duration),
    }


class KitSliceRegion(BaseModel):
    start: float
    length: float


class KitPadSpec(BaseModel):
    sample: str | None = None
    start: float | None = None
    length: float | None = None


class KitBuildRequest(BaseModel):
    name: str
    kit_type: str = "drum"
    mode: str = "pads"
    folder: str = ""
    pads: list[str | KitPadSpec | None] = []
    sample: str | None = None
    count: int = 16
    output: str = "device"
    section: str = "samples"
    return_effect: str | None = None
    insert_effect: str | None = None
    slices: list[KitSliceRegion] = []


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name).strip(" .")
    if not cleaned:
        raise HTTPException(status_code=400, detail="preset name is empty")
    return cleaned


def _kit_pad_source(entry, folder: str) -> tuple[str, float | None, float | None]:
    """Turn one client pad into (relative path, playback start, length)."""
    if not entry:
        return "", None, None
    if isinstance(entry, str):
        sample, start, length = entry, None, None
    else:
        sample, start, length = entry.sample, entry.start, entry.length
    if not sample:
        return "", None, None
    relative = sample if "/" in sample else posixpath.join(folder, sample)
    relative = relative.strip("/")
    if start is None and length is None:
        return relative, None, None
    start_n = 0.0 if start is None else max(0.0, min(1.0, float(start)))
    length_n = (
        1.0 - start_n if length is None else max(0.0, min(1.0 - start_n, float(length)))
    )
    if start_n <= 1e-6 and length_n >= 1.0 - 1e-6:
        return relative, None, None
    return relative, start_n, length_n


def _pad_sources(body: KitBuildRequest) -> list[tuple[str, float | None, float | None]]:
    """Resolve the request into (sample path, playback start, length) per pad."""
    section = _kit_section(body.section)
    if body.mode == "slices":
        if not body.sample:
            raise HTTPException(status_code=400, detail="no sample to slice")
        backend = get_backend()
        data = backend.read_file(paths.resolve(section, body.sample))
        try:
            duration = kits.duration_seconds(data)
        except kits.AudioError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        planned = (
            kits.slices_from_normalised(
                [{"start": s.start, "length": s.length} for s in body.slices],
                duration,
            )
            if body.slices
            else kits.equal_slices(body.count, duration)
        )
        return [(body.sample, s["start"], s["length"]) for s in planned]

    sources: list[tuple[str, float | None, float | None]] = []
    for entry in body.pads[: kits.PAD_COUNT]:
        sources.append(_kit_pad_source(entry, body.folder))
    while len(sources) < kits.PAD_COUNT:
        sources.append(("", None, None))
    return sources


def _kit_fx_device(backend, spec, default: str) -> dict | None:
    """Resolve a kit/preset FX dropdown value to a device, loading presets as needed."""
    if isinstance(spec, dict):
        device = spec.get("device") if spec.get("source") == "upload" else spec
        try:
            return kits.slot_device(device, default)
        except kits.EffectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    text = "" if spec is None else str(spec).strip()
    if text.startswith("factory:"):
        relative = text[len("factory:") :].strip().replace("\\", "/").lstrip("/")
        try:
            return effects.read_device(backend, "factory", relative)
        except effects.EffectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if text.startswith(kits.PRESET_PREFIX):
        try:
            relative = kits._normalise_effect(text, default)[len(kits.PRESET_PREFIX) :]
        except kits.EffectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            return effects.read_device(backend, "effects", relative)
        except effects.EffectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return kits.slot_device(spec, default)
    except kits.EffectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _kit_preset(name: str, pads: list[kits.Pad], body: KitBuildRequest, backend) -> dict:
    try:
        return kits.build_preset(
            name,
            pads,
            body.kit_type,
            _kit_fx_device(backend, body.return_effect, kits.DEFAULT_RETURN_EFFECT),
            _kit_fx_device(backend, body.insert_effect, kits.DEFAULT_INSERT_EFFECT),
        )
    except kits.EffectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/kit/build")
async def kit_build(body: KitBuildRequest):
    backend = get_backend()
    name = _safe_filename(body.name)
    section = _kit_section(body.section)
    sources = _pad_sources(body)

    if body.output == "bundle":
        pads = [
            kits.Pad(kits.bundle_uri(path), start, length, posixpath.basename(path))
            if path
            else kits.Pad()
            for path, start, length in sources
        ]
        preset = _kit_preset(name, pads, body, backend)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("Preset.ablpreset", json.dumps(preset, indent=2))
            for path in {p for p, _, _ in sources if p}:
                archive.writestr(
                    f"Samples/{posixpath.basename(path)}",
                    backend.read_file(paths.resolve(section, path)),
                )
        return Response(
            buffer.getvalue(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{name}.ablpresetbundle"'
            },
        )

    missing = [
        p for p, _, _ in sources if p and not backend.exists(paths.resolve(section, p))
    ]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"samples not found on device: {', '.join(missing[:3])}"
        )

    pads = [
        kits.Pad(kits.library_uri(path, section), start, length, posixpath.basename(path))
        if path
        else kits.Pad()
        for path, start, length in sources
    ]
    preset = _kit_preset(name, pads, body, backend)

    target = paths.resolve("presets", f"{name}.ablpreset")
    builder = undo.Builder(backend, f"Save kit {name}")
    builder.will_overwrite(target)
    backend.write_file(target, json.dumps(preset, indent=2).encode("utf-8"))
    commit_undo(builder)
    refresh_result = backend.refresh_library()

    return {
        "ok": True,
        "path": target,
        "filled_pads": sum(1 for p, _, _ in sources if p),
        "refreshed": refresh_result.ok,
        "refresh_error": None if refresh_result.ok else refresh_result.stderr.strip(),
    }


@app.get("/api/effects/catalog")
async def effect_catalog():
    return {"effects": effects.catalog()}


@app.get("/api/effects/presets")
async def effect_presets():
    return {"presets": effects.list_presets(get_backend())}


class EffectParseRequest(BaseModel):
    preset: dict


@app.post("/api/effects/parse")
async def effect_parse(body: EffectParseRequest):
    if not body.preset:
        raise HTTPException(status_code=400, detail="upload an effect file")
    try:
        devices = effects.devices_from_upload(body.preset)
    except effects.EffectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    name = (body.preset.get("name") or "").strip()
    return {
        "name": name,
        "devices": [
            {"kind": device.get("kind") or "", "name": device.get("name") or "", "device": device}
            for device in devices
        ],
    }


class TrackInstrumentRef(BaseModel):
    source: str = "presets"
    path: str = ""
    kind: str = ""
    preset: dict | None = None
    sample: str = ""
    variant: str = ""


class TrackPresetBuildRequest(BaseModel):
    name: str
    folder: str = ""
    replace: str = ""
    output: str = "device"
    instrument: TrackInstrumentRef
    slot1: str | dict = ""
    slot2: str | dict = ""


def _loaded_preset(loaded: dict) -> dict:
    return {
        "name": loaded["name"],
        "kind": loaded["kind"],
        "source": loaded["source"],
        "path": loaded["path"],
        "instrument": loaded["device"],
        "sample": presets.sample_spec_from_uri(loaded.get("sample") or ""),
        "slot1": loaded.get("slot1") or "",
        "slot2": loaded.get("slot2") or "",
        "folder": posixpath.dirname(loaded["path"]) if loaded["source"] == "presets" else "",
    }


@app.get("/api/presets/instruments")
async def preset_instruments():
    return {"instruments": presets.list_instruments(get_backend())}


@app.get("/api/presets/samples")
async def preset_samples():
    return {"samples": presets.list_samples(get_backend())}


@app.get("/api/presets/load")
async def preset_load(source: str, path: str):
    try:
        loaded = presets.load_instrument(get_backend(), source, path)
    except (presets.PresetError, UnsafePath) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _loaded_preset(loaded)


@app.post("/api/presets/parse")
async def preset_parse(body: TrackInstrumentRef):
    if not body.preset:
        raise HTTPException(status_code=400, detail="upload a preset file")
    try:
        loaded = presets.load_inline(body.preset)
    except presets.PresetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    parsed = _loaded_preset(loaded)
    parsed["folder"] = ""
    return parsed


@app.post("/api/presets/build")
async def preset_build(body: TrackPresetBuildRequest):
    name = _safe_filename(body.name)
    backend = get_backend()
    try:
        if body.instrument.preset:
            loaded = presets.load_inline(body.instrument.preset)
        elif body.instrument.source == "default":
            loaded = presets.load_default(body.instrument.kind, body.instrument.variant)
        else:
            loaded = presets.load_instrument(backend, body.instrument.source, body.instrument.path)
        if body.instrument.sample:
            presets.apply_sample(loaded["device"], body.instrument.sample)
        preset = presets.build_track_preset(
            name,
            loaded["device"],
            _kit_fx_device(backend, body.slot1, ""),
            _kit_fx_device(backend, body.slot2, ""),
        )
    except (presets.PresetError, UnsafePath, kits.EffectError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = json.dumps(preset, indent=2).encode("utf-8")
    filename = f"{name}.ablpreset"
    if body.output == "file":
        return Response(
            content=payload,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    folder = (body.folder or "").replace("\\", "/").strip("/")
    replace = (body.replace or "").replace("\\", "/").strip("/")
    if replace and not folder:
        folder = posixpath.dirname(replace)
    target = paths.resolve("presets", presets.dest_path(folder, name))
    replacing = paths.resolve("presets", replace) if replace else None
    if backend.exists(target) and target != replacing:
        raise HTTPException(status_code=409, detail=f"{filename} already exists")
    builder = undo.Builder(backend, f"Save preset {name}")
    builder.will_overwrite(target)
    if replacing and replacing != target:
        builder.will_remove(replacing)
    backend.write_file(target, payload)
    if replacing and replacing != target and backend.exists(replacing):
        backend.remove(replacing)
    commit_undo(builder)
    refresh_result = backend.refresh_library()
    return {
        "ok": True,
        "path": paths.relative_to("presets", target),
        "name": filename,
        "devices": len(preset["chains"][0]["devices"]),
        "refreshed": refresh_result.ok,
        "refresh_error": None if refresh_result.ok else refresh_result.stderr.strip(),
    }


@app.get("/api/undo")
async def undo_status():
    return session.undo.peek()


@app.post("/api/undo")
async def undo_last():
    try:
        label = undo.apply(get_backend(), session.undo)
    except undo.UndoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "label": label}


@app.post("/api/refresh")
async def refresh():
    result = get_backend().refresh_library()
    return {
        "ok": result.ok,
        "exit_code": result.exit_code,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }
