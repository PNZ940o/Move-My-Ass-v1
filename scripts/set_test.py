"""Checks set listing shows display names, pad numbers and colours — mock only."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
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


status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

listing = get("/api/list?kind=sets")
by_path = {item["path"]: item for item in listing["items"]}

check("lists three mock sets", len(listing["items"]) == 3, [i["name"] for i in listing["items"]])
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
check("off-grid copy keeps the display name", off["name"] == "Green Loop", off)

listing = get("/api/list?kind=sets")
by_path = {item["path"]: item for item in listing["items"]}
check("original is still on pad 1 after off-grid copy", by_path[GREEN]["pad"] == 1, by_path[GREEN])
check("off-grid set is listed without a pad", by_path[off["path"]]["pad"] is None, by_path.get(off["path"]))
check("pad 2 copy is still on the grid", by_path[copied["path"]]["pad"] == 2, by_path.get(copied["path"]))

sidecar = json.loads((SETS / off["path"] / ".xattrs.json").read_text(encoding="utf-8"))
check("off-grid sidecar has no pad index", "user.song-index" not in sidecar, sidecar)

post("/api/delete", {"kind": "sets", "items": [copied["path"], off["path"]]})
listing = get("/api/list?kind=sets")
check("copies can be deleted to restore the mock",
      len(listing["items"]) == 3 and copied["path"] not in {i["path"] for i in listing["items"]},
      [i["path"] for i in listing["items"]])

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
