"""Checks set listing shows display names, pad numbers and colours — mock only."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
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

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
