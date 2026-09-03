"""Checks the storage meter against the mock sandbox."""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.move.backend import LocalBackend  # noqa: E402
from app.move.storage import MOCK_TOTAL, parse_counts, parse_df, parse_du, usage  # noqa: E402

failures: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


df_text = """Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/mmcblk0p12   52428800  10485760  41943040      20% /data
"""
total, used, free = parse_df(df_text)
check("df total is 50 GiB", total == 52428800 * 1024, total)
check("df used matches", used == 10485760 * 1024, used)
check("df free matches", free == 41943040 * 1024, free)

du_text = """
18432\t/data/UserData/UserLibrary/Samples
2048\t/data/UserData/UserLibrary/Track Presets
4096\t/data/UserData/UserLibrary/Sets
1024\t/data/UserData/UserLibrary/Recordings
"""
trees = parse_du(du_text)
check("du samples", trees["samples"] == 18432 * 1024, trees)
check("du presets", trees["presets"] == 2048 * 1024, trees)
check("du sets", trees["sets"] == 4096 * 1024, trees)
check("du recordings", trees["recordings"] == 1024 * 1024, trees)

counts = parse_counts("samples 12\nrecordings 3\nsets 9\npresets 4\n")
check("count samples", counts["samples"] == 12, counts)
check("count recordings", counts["recordings"] == 3, counts)
check("count sets", counts["sets"] == 9, counts)
check("count presets", counts["presets"] == 4, counts)

data = usage(LocalBackend(settings.mock_root))
by_id = {item["id"]: item for item in data["categories"]}
check("mock total is the advertised 50 GB", data["total"] == MOCK_TOTAL, data["total"])
check("mock used fits on the disk", data["used"] + data["free"] == data["total"], data)
check("samples take some space", by_id["samples"]["bytes"] > 0, by_id["samples"])
check("sets take some space", by_id["sets"]["bytes"] > 0, by_id["sets"])
check("categories add up to used", sum(item["bytes"] for item in data["categories"]) == data["used"], data)
by_lib = {item["id"]: item for item in data["libraries"]}
check("libraries lists samples", "samples" in by_lib and "count" in by_lib["samples"], by_lib)
check("libraries lists recordings", "recordings" in by_lib, by_lib)
check("libraries lists sets", "sets" in by_lib, by_lib)
check("libraries lists presets", "presets" in by_lib, by_lib)
check("libraries lists effects", "effects" in by_lib, by_lib)
check("libraries lists core library", "factory" in by_lib and by_lib["factory"]["label"] == "Core Library", by_lib)

base = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8000")
try:
    with urllib.request.urlopen(f"{base}/api/status", timeout=5) as response:
        status = json.loads(response.read())
except Exception as exc:
    print(f"skip HTTP  ({exc})")
    status = None

if status:
    check("HTTP status is mock", status.get("mode") == "mock", status)
    with urllib.request.urlopen(f"{base}/api/storage", timeout=30) as response:
        remote = json.loads(response.read())
    check("HTTP storage has a total", remote["total"] == MOCK_TOTAL, remote["total"])
    check("HTTP storage has samples", any(item["id"] == "samples" and item["bytes"] > 0 for item in remote["categories"]), remote)

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
