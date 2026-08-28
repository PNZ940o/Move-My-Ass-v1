"""Checks set listing shows display names, pad numbers and colours — mock only."""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

BASE = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8000")
SETS = Path("mock-move/data/UserData/UserLibrary/Sets")
GREEN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


def get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as response:
        return json.loads(response.read())


def post(path: str, payload: dict):
    request = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(payload).encode(), method="POST"
    )
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def post_files(path: str, fields: list[tuple[str, str]], files: list[tuple[str, str, bytes]]):
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    for name, value in fields:
        body.write(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )
    for name, filename, content in files:
        body.write(
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; "
                f"filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            ).encode()
        )
        body.write(content + b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(f"{BASE}{path}", data=body.getvalue(), method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

listing = get("/api/list?kind=sets")
by_path = {item["path"]: item for item in listing["items"]}

check("lists three mock sets", len(listing["items"]) == 3, [i["name"] for i in listing["items"]])
check("sets listing has no pad-collision warnings", listing.get("warnings") == [], listing.get("warnings"))
check("shows the inner folder name, not the UUID",
      by_path[GREEN]["name"] == "Green Loop", by_path.get(GREEN))
check("UUID is still the path so rename/delete hit the right folder",
      GREEN in by_path, list(by_path))
check("pad 0 displays as Pad 1", by_path[GREEN]["pad"] == 1, by_path[GREEN])
check("green pad colour is Move colour 9",
      by_path[GREEN]["color"] == "#87ff6d" and by_path[GREEN]["color_id"] == 9,
      by_path[GREEN])
check("sets are sorted by pad number",
      [i["pad"] for i in listing["items"]] == [1, 12, 32],
      [i["pad"] for i in listing["items"]])
check("category is set, not a generic folder",
      all(i["category"] == "set" for i in listing["items"]), listing["items"])
check("sidecar xattr file is hidden from the listing",
      all(not i["name"].startswith(".") for i in listing["items"]), listing["items"])

renamed = post("/api/rename", {
    "kind": "sets", "path": GREEN, "new_name": "Forest Jam",
})
check("rename returns the display name", renamed["name"] == "Forest Jam", renamed)
check("UUID folder is unchanged", (SETS / GREEN).is_dir(), "")
check("inner folder took the new name", (SETS / GREEN / "Forest Jam").is_dir(),
      list((SETS / GREEN).iterdir()))
check("old inner folder is gone", not (SETS / GREEN / "Green Loop").exists(), "")

song = (SETS / GREEN / "Forest Jam" / "Song.abl").read_text(encoding="utf-8")
check("Song.abl sample URI uses the new encoded name",
      "Forest%20Jam" in song and "Green%20Loop" not in song, song)

listing = get("/api/list?kind=sets")
names = [i["name"] for i in listing["items"]]
check("listing now shows the renamed set", "Forest Jam" in names, names)

# restore for a clean mock
post("/api/rename", {"kind": "sets", "path": GREEN, "new_name": "Green Loop"})

copied = post("/api/copy-set", {"path": GREEN, "pad": 2})
check("copy returns a new UUID", copied["path"] != GREEN and len(copied["path"]) == 36, copied)
check("copy lands on pad 2", copied["pad"] == 2, copied)
check("copy keeps the display name", copied["name"] == "Green Loop", copied)
check("copy keeps the pad colour", copied["color_id"] == 9, copied)
pad_sidecar = json.loads((SETS / copied["path"] / ".xattrs.json").read_text(encoding="utf-8"))
check("pad copy sidecar has index 1 (pad 2)", pad_sidecar.get("user.song-index") == "1", pad_sidecar)

listing = get("/api/list?kind=sets")
by_path = {item["path"]: item for item in listing["items"]}
check("original set is still on pad 1", by_path[GREEN]["pad"] == 1, by_path[GREEN])
check("copied set is listed on pad 2", by_path[copied["path"]]["pad"] == 2, by_path.get(copied["path"]))
check("four sets after copy", len(listing["items"]) == 4, [i["name"] for i in listing["items"]])

song = (SETS / copied["path"] / "Green Loop" / "Song.abl").read_text(encoding="utf-8")
check("copied Song.abl points at the new UUID",
      copied["path"] in song and GREEN not in song, song)

try:
    post("/api/copy-set", {"path": GREEN, "pad": 12})
    check("occupied pad is rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("occupied pad is rejected", exc.code == 409, exc.code)

off = post("/api/copy-set", {"path": GREEN})
check("off-grid copy returns a new UUID", off["path"] != GREEN and len(off["path"]) == 36, off)
check("off-grid copy has no pad", off.get("pad") is None, off)
check("off-grid copy is named as an archive", off["name"] == "Green Loop (copy)", off)

listing = get("/api/list?kind=sets")
by_path = {item["path"]: item for item in listing["items"]}
check("original is still on pad 1 after off-grid copy", by_path[GREEN]["pad"] == 1, by_path[GREEN])
check("off-grid set is listed without a pad", by_path[off["path"]]["pad"] is None, by_path.get(off["path"]))
check("pad 2 copy is still on the grid", by_path[copied["path"]]["pad"] == 2, by_path.get(copied["path"]))

sidecar = json.loads((SETS / off["path"] / ".xattrs.json").read_text(encoding="utf-8"))
check("off-grid sidecar has no pad index", "user.song-index" not in sidecar, sidecar)

off2 = post("/api/copy-set", {"path": GREEN})
check("second off-grid copy gets a numbered name", off2["name"] == "Green Loop (copy 2)", off2)

try:
    post("/api/mkdir", {"kind": "sets", "path": "Junk Folder"})
    check("mkdir at sets root is rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("mkdir at sets root is rejected", exc.code == 400, exc.code)

# Two folders claiming pad 1 must be reported, not silently shown as one pad.
collision = "dddddddd-4444-4444-8444-dddddddddddd"
(SETS / collision / "Clone").mkdir(parents=True)
(SETS / collision / ".xattrs.json").write_text(
    json.dumps({"user.song-index": "0", "user.song-color": "1"}),
    encoding="utf-8",
)
listing = get("/api/list?kind=sets")
warnings = listing.get("warnings") or []
check("duplicate pad index is warned about", any("Pad 1" in w for w in warnings), warnings)
shutil.rmtree(SETS / collision)

post("/api/delete", {"kind": "sets", "items": [copied["path"], off["path"], off2["path"]]})
listing = get("/api/list?kind=sets")
check("copies can be deleted to restore the mock",
      len(listing["items"]) == 3 and copied["path"] not in {i["path"] for i in listing["items"]},
      [i["path"] for i in listing["items"]])

song = {
    "$schema": "http://tech.ableton.com/schema/song/1.5.1/song.json",
    "tempo": 99.0,
    "tracks": [],
    "sample": f"ableton:/user-library/Sets/{GREEN}/Green%20Loop/Samples/hit.wav",
}
bundle = io.BytesIO()
with zipfile.ZipFile(bundle, "w") as archive:
    archive.writestr("Song.abl", json.dumps(song))
    archive.writestr("BundleInfo.json", "{}")
    archive.writestr("Samples/hit.wav", b"RIFF")
imported = post_files("/api/import-set", [], [("files", "Groove.ablbundle", bundle.getvalue())])
item = imported["imported"][0]
check("imported bundle lands on the first empty pad", item.get("pad") == 2, item)
check("imported bundle uses the file name", item["name"] == "Groove", item)
check("imported bundle is a new UUID", item["path"] != GREEN and len(item["path"]) == 36, item)
song_text = (SETS / item["path"] / "Groove" / "Song.abl").read_text(encoding="utf-8")
check("imported Song.abl points at the new UUID",
      item["path"] in song_text and GREEN not in song_text and "Groove" in song_text, song_text)
check("imported sample came along", (SETS / item["path"] / "Groove" / "Samples" / "hit.wav").is_file())
check("bundle metadata stayed off the device",
      not (SETS / item["path"] / "Groove" / "BundleInfo.json").exists())

folder = post_files(
    "/api/import-set",
    [
        ("off_grid", "true"),
        ("relpaths", "Night Jam/Song.abl"),
        ("relpaths", "Night Jam/Samples/clap.wav"),
    ],
    [
        ("files", "Song.abl", json.dumps(song).encode()),
        ("files", "clap.wav", b"RIFF"),
    ],
)
off_item = folder["imported"][0]
check("folder import can sit off the grid", off_item.get("pad") is None, off_item)
check("folder import keeps the folder name", off_item["name"] == "Night Jam", off_item)

try:
    post_files("/api/import-set", [("pad", "12")], [("files", "Nope.ablbundle", bundle.getvalue())])
    check("import onto an occupied pad is rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("import onto an occupied pad is rejected", exc.code == 409, exc.code)

try:
    post_files("/api/import-set", [], [("files", "hit.wav", b"RIFF")])
    check("random files are not imported as sets", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("random files are not imported as sets", exc.code == 400, exc.code)

multi = post_files(
    "/api/import-set",
    [
        ("relpaths", "Pack/Alpha/Song.abl"),
        ("relpaths", "Pack/Beta/Song.abl"),
    ],
    [
        ("files", "Song.abl", json.dumps(song).encode()),
        ("files", "Song.abl", json.dumps(song).encode()),
    ],
)
check("folder of two sets imports both", len(multi["imported"]) == 2, multi)
names = {row["name"]: row for row in multi["imported"]}
check("folder sets keep folder names", set(names) == {"Alpha", "Beta"}, names)
pads = sorted(row["pad"] for row in multi["imported"])
check("folder sets fill the next empty pads", pads == [3, 4], pads)

nested = post_files(
    "/api/import-set",
    [
        ("relpaths", "Backup/One.ablbundle"),
        ("relpaths", "Backup/Two.ablbundle"),
    ],
    [
        ("files", "One.ablbundle", bundle.getvalue()),
        ("files", "Two.ablbundle", bundle.getvalue()),
    ],
)
check("nested bundles import as two sets", len(nested["imported"]) == 2, nested)
check(
    "nested bundles fill later empty pads",
    sorted(row["pad"] for row in nested["imported"]) == [5, 6],
    nested["imported"],
)

listing = get("/api/list?kind=sets")
used = {row["pad"] for row in listing["items"] if row.get("pad")}
start = next(p for p in range(1, 32) if p not in used and (p + 1) not in used)
from_pad = post_files(
    "/api/import-set",
    [
        ("pad", str(start)),
        ("relpaths", "FromPad/One/Song.abl"),
        ("relpaths", "FromPad/Two/Song.abl"),
    ],
    [
        ("files", "Song.abl", json.dumps(song).encode()),
        ("files", "Song.abl", json.dumps(song).encode()),
    ],
)
check(
    "folder import starts on the chosen pad and fills the next",
    [row["pad"] for row in from_pad["imported"]] == [start, start + 1],
    from_pad["imported"],
)

listing = get("/api/list?kind=sets")
used = {row["pad"] for row in listing["items"] if row.get("pad")}
dummies = []
for pad in range(1, 33):
    if pad in used:
        continue
    uid = str(uuid.uuid4())
    (SETS / uid / "Dummy").mkdir(parents=True)
    (SETS / uid / ".xattrs.json").write_text(
        json.dumps({"user.song-index": str(pad - 1), "user.song-color": "1"}),
        encoding="utf-8",
    )
    dummies.append(uid)
overflow = post_files(
    "/api/import-set",
    [("relpaths", "Overflow/Song.abl")],
    [("files", "Song.abl", json.dumps(song).encode())],
)
over = overflow["imported"][0]
check("full grid parks a folder set off the pad grid", over.get("pad") is None, over)
for uid in dummies:
    shutil.rmtree(SETS / uid)

to_delete = [item["path"], off_item["path"], over["path"]]
to_delete.extend(row["path"] for row in multi["imported"])
to_delete.extend(row["path"] for row in nested["imported"])
to_delete.extend(row["path"] for row in from_pad["imported"])
post("/api/delete", {"kind": "sets", "items": to_delete})
listing = get("/api/list?kind=sets")
check("imported sets can be deleted to restore the mock",
      len(listing["items"]) == 3, [i["name"] for i in listing["items"]])

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
