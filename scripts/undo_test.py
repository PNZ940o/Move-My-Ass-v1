"""Undo stack — mock only."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.move.backend import LocalBackend  # noqa: E402
from app.move import undo  # noqa: E402

BASE = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8000")
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


def post_expect_error(path: str):
    try:
        post(path, {})
        return None
    except urllib.error.HTTPError as exc:
        return json.loads(exc.read().decode())


root = Path(tempfile.mkdtemp(prefix="mma-undo-unit-"))
backend = LocalBackend(root)
sample = "/file.wav"
backend.write_file(sample, b"RIFF")
cache = Path(tempfile.mkdtemp(prefix="mma-cache-"))
undo.dump_tree(backend, sample, cache / "0")
backend.remove(sample)
check("unit dump captured bytes", (cache / "0").read_bytes() == b"RIFF")
undo.restore_tree(backend, cache / "0", sample)
check("unit restore put the file back", backend.read_file(sample) == b"RIFF")

folder = "/kit"
backend.makedirs(folder)
backend.write_file(f"{folder}/a.wav", b"A")
dest = cache / "dir"
undo.dump_tree(backend, folder, dest)
backend.remove(folder)
undo.restore_tree(backend, dest, folder)
check("unit restore folder file", backend.read_file(f"{folder}/a.wav") == b"A")

status = get("/api/status")
if status["mode"] != "mock":
    sys.exit(f"refusing to run against a real device (mode={status['mode']})")

# Earlier suites leave entries behind, and some of them edit the mock directly
# rather than through the API, which undo can never replay. Dropping the backend
# clears the stack outright and gives this suite a known starting point.
post("/api/disconnect", {})

empty = post_expect_error("/api/undo")
check("empty stack is nothing to undo", empty is not None and "nothing to undo" in str(empty).lower(), empty)

post("/api/mkdir", {"kind": "samples", "path": "Undo Test Folder"})
listed = get("/api/list?kind=samples&path=")
names = [item["name"] for item in listed["items"]]
check("mkdir created the folder", "Undo Test Folder" in names, names)

undone = post("/api/undo", {})
check("undo mkdir label", "folder" in undone["label"].lower(), undone)
listed = get("/api/list?kind=samples&path=")
names = [item["name"] for item in listed["items"]]
check("undo mkdir removed the folder", "Undo Test Folder" not in names, names)

post("/api/mkdir", {"kind": "samples", "path": "Undo Test Folder"})
post("/api/mkdir", {"kind": "samples", "path": "Undo Test Folder/Inner"})
post("/api/rename", {"kind": "samples", "path": "Undo Test Folder/Inner", "new_name": "Outer"})
listed = get("/api/list?kind=samples&path=" + quote("Undo Test Folder"))
names = [item["name"] for item in listed["items"]]
check("rename landed", "Outer" in names and "Inner" not in names, names)

post("/api/undo", {})
listed = get("/api/list?kind=samples&path=" + quote("Undo Test Folder"))
names = [item["name"] for item in listed["items"]]
check("undo rename restored Inner", "Inner" in names, names)

post("/api/delete", {"kind": "samples", "items": ["Undo Test Folder"]})
listed = get("/api/list?kind=samples&path=")
names = [item["name"] for item in listed["items"]]
check("delete removed the folder", "Undo Test Folder" not in names, names)

post("/api/undo", {})
listed = get("/api/list?kind=samples&path=")
names = [item["name"] for item in listed["items"]]
check("undo delete restored the folder", "Undo Test Folder" in names, names)
inner = get("/api/list?kind=samples&path=" + quote("Undo Test Folder"))
check("undo delete restored nested folder", any(item["name"] == "Inner" for item in inner["items"]), inner["items"])

post("/api/delete", {"kind": "samples", "items": ["Undo Test Folder"]})
post("/api/undo", {})  # restore
post("/api/delete", {"kind": "samples", "items": ["Undo Test Folder"]})  # final cleanup

if failures:
    sys.exit(f"{len(failures)} checks failed")
print("\nall checks passed")
