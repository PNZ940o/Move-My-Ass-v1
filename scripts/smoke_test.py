"""End-to-end check against a running server on the mock backend."""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from urllib.parse import quote

BASE = os.environ.get("MOVE_TEST_BASE", "http://127.0.0.1:8000")
failures: list[str] = []


def call(method: str, path: str, payload=None, raw=None, content_type=None, headers=None):
    url = f"{BASE}{path}"
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    request = urllib.request.Request(url, data=data, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if content_type:
        request.add_header("Content-Type", content_type)
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read()


def call_full(method: str, path: str, headers=None):
    """Like `call`, but hands back the response object for header checks."""
    request = urllib.request.Request(f"{BASE}{path}", method=method)
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    with urllib.request.urlopen(request, timeout=30) as response:
        # response.headers looks up case-insensitively; a plain dict would not.
        return response.status, response.headers, response.read()


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{'' if condition else f'  <- {detail}'}")
    if not condition:
        failures.append(label)


def multipart(fields: list[tuple[str, str]], files: list[tuple[str, str, bytes]]):
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    for name, value in fields:
        body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    for name, filename, content in files:
        body.write(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
        )
        body.write(content + b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


# status
status_code, raw = call("GET", "/api/status")
status = json.loads(raw)
check("status reports mock mode", status["mode"] == "mock", status)

# listing
_, raw = call("GET", "/api/list?kind=samples")
listing = json.loads(raw)
names = [i["name"] for i in listing["items"]]
check("samples root lists mock folders", "Drums" in names and "Melodic" in names, names)
check("folders sort before files", listing["items"][0]["is_dir"], names)

_, raw = call("GET", "/api/list?kind=samples&path=Drums")
drums = json.loads(raw)
check("drum samples classified as audio",
      all(i["category"] == "audio" for i in drums["items"]), drums["items"][:2])
check("sizes are populated", all(i["size"] > 0 for i in drums["items"]), drums["items"][:2])

# path traversal must be refused
try:
    call("GET", "/api/list?kind=samples&path=../../../etc")
    check("path traversal rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("path traversal rejected", exc.code == 400, exc.code)

# unknown section
try:
    call("GET", "/api/list?kind=bogus")
    check("unknown section rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("unknown section rejected", exc.code == 400, exc.code)

# upload preserving nested relative paths
body, ctype = multipart(
    [("kind", "samples"), ("dest", "SmokeTest"),
     ("relpaths", "one.wav"), ("relpaths", "nested/two.wav")],
    [("files", "one.wav", b"RIFFfake-one"), ("files", "two.wav", b"RIFFfake-two")],
)
code, raw = call("POST", "/api/upload", raw=body, content_type=ctype)
result = json.loads(raw)
check("upload accepted both files", result["count"] == 2, result)
check("upload reported no failures", result["failed"] == [], result["failed"])

_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
uploaded = json.loads(raw)
uploaded_names = sorted(i["name"] for i in uploaded["items"])
check("flat upload landed", "one.wav" in uploaded_names, uploaded_names)
check("nested folder was created", "nested" in uploaded_names, uploaded_names)

_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest/nested")
check("nested file landed", [i["name"] for i in json.loads(raw)["items"]] == ["two.wav"], raw)

# download a file
_, raw = call("GET", "/api/download?kind=samples&path=SmokeTest/one.wav")
check("file download returns bytes", raw == b"RIFFfake-one", raw[:20])

# download a folder as zip
_, raw = call("GET", "/api/download?kind=samples&path=SmokeTest")
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    members = sorted(n.replace("\\", "/") for n in archive.namelist())
check("folder download is a zip with both files",
      members == ["nested/two.wav", "one.wav"], members)

# mkdir
call("POST", "/api/mkdir", {"kind": "samples", "path": "SmokeTest/made"})
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
check("mkdir created folder", "made" in [i["name"] for i in json.loads(raw)["items"]], raw)

# "New folder" has to work in every section, not just the one that happens to be
# open first, and at a section root the browser sends a leading slash.
# Sets root is UUID folders only — a loose folder there is not a pad set.
SECTIONS = ["samples", "recordings", "presets", "sets", "effects"]
for section in SECTIONS:
    folder = f"SmokeNew-{section}"
    if section == "sets":
        try:
            call("POST", "/api/mkdir", {"kind": "sets", "path": f"/{folder}"})
            check("mkdir at sets root is rejected", False, "request succeeded")
        except urllib.error.HTTPError as exc:
            check("mkdir at sets root is rejected", exc.code == 400, str(exc.code))
        continue
    code, _ = call("POST", "/api/mkdir", {"kind": section, "path": f"/{folder}"})
    _, raw = call("GET", f"/api/list?kind={section}")
    listed = [i["name"] for i in json.loads(raw)["items"]]
    check(f"new folder at {section} root", code == 200 and folder in listed, listed)

    code, _ = call("POST", "/api/mkdir", {"kind": section, "path": f"{folder}/nested"})
    _, raw = call("GET", f"/api/list?kind={section}&path={folder}")
    listed = [i["name"] for i in json.loads(raw)["items"]]
    check(f"new folder inside a {section} folder", code == 200 and "nested" in listed, listed)

# a name that collapses to nothing must not silently "succeed" against the root
for bad in ["/", "."]:
    try:
        call("POST", "/api/mkdir", {"kind": "samples", "path": bad})
        check(f"mkdir rejects {bad!r}", False, "request succeeded")
    except urllib.error.HTTPError as exc:
        check(f"mkdir rejects {bad!r}", exc.code == 400, exc.code)

for section in SECTIONS:
    call("POST", "/api/delete", {"kind": section, "items": [f"SmokeNew-{section}"]})

# rename
call("POST", "/api/rename", {"kind": "samples", "path": "SmokeTest/one.wav", "new_name": "renamed.wav"})
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
after = [i["name"] for i in json.loads(raw)["items"]]
check("rename applied", "renamed.wav" in after and "one.wav" not in after, after)

# move into a folder, then back so later downloads still see the file
call("POST", "/api/move", {"kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest/made"})
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest/made")
check("moved file into folder", "renamed.wav" in [i["name"] for i in json.loads(raw)["items"]], raw)
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
check("file left the old folder", "renamed.wav" not in [i["name"] for i in json.loads(raw)["items"]], raw)
call("POST", "/api/move", {"kind": "samples", "items": ["SmokeTest/made/renamed.wav"], "dest": "SmokeTest"})
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
check("moved file back", "renamed.wav" in [i["name"] for i in json.loads(raw)["items"]], raw)

result = json.loads(call("POST", "/api/move", {"kind": "samples", "items": ["SmokeTest/made"], "dest": "SmokeTest/made"})[1])
check("moving a folder into itself is refused",
      result["moved"] == [] and result["failed"], result)

result = json.loads(call("POST", "/api/move", {
    "kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest/renamed.wav",
})[1])
check("move dest that is a file uses its folder",
      result["moved"] == ["SmokeTest/renamed.wav"] and result["failed"] == [], result)

# copy / paste duplicates
result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest",
})[1])
check("copy in the same folder gets a (copy) name",
      result["copied"] and result["copied"][0]["path"] == "SmokeTest/renamed (copy).wav", result)
_, raw = call("GET", "/api/list?kind=samples&path=SmokeTest")
copied_names = [i["name"] for i in json.loads(raw)["items"]]
check("copy left the original in place", "renamed.wav" in copied_names, copied_names)
check("copy created the duplicate", "renamed (copy).wav" in copied_names, copied_names)

result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest",
})[1])
check("second copy is numbered",
      result["copied"] and result["copied"][0]["path"] == "SmokeTest/renamed (copy 2).wav", result)

result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest/made",
})[1])
check("copy into another folder keeps the original name",
      result["copied"] and result["copied"][0]["path"] == "SmokeTest/made/renamed.wav", result)
call("POST", "/api/delete", {"kind": "samples", "items": ["SmokeTest/made/renamed.wav"]})

result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "items": ["SmokeTest/nested"], "dest": "SmokeTest",
})[1])
check("copying a folder uses (copy)",
      result["copied"] and result["copied"][0]["path"] == "SmokeTest/nested (copy)", result)
_, raw = call("GET", "/api/list?kind=samples&path=" + quote("SmokeTest/nested (copy)"))
check("copied folder keeps its contents",
      [i["name"] for i in json.loads(raw)["items"]] == ["two.wav"], raw)

result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest/renamed.wav",
})[1])
check("copy dest that is a file pastes in its folder",
      result["copied"] and result["copied"][0]["path"].startswith("SmokeTest/renamed (copy"), result)

try:
    call("POST", "/api/copy", {"kind": "samples", "items": ["SmokeTest/renamed.wav"], "dest": "SmokeTest/no-such-folder"})
    check("copy into a missing folder is refused", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("copy into a missing folder is refused", exc.code == 400, exc.code)

try:
    call("POST", "/api/copy", {"kind": "factory", "items": ["x"], "dest": ""})
    check("copy into factory is refused", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("copy into factory is refused", exc.code == 403, exc.code)

result = json.loads(call("POST", "/api/copy", {
    "kind": "recordings", "source_kind": "samples",
    "items": ["SmokeTest/renamed.wav"], "dest": "",
})[1])
check("copy from samples into recordings",
      result["copied"] and result["copied"][0]["path"] == "renamed.wav", result)
call("POST", "/api/delete", {"kind": "recordings", "items": ["renamed.wav"]})

result = json.loads(call("POST", "/api/copy", {
    "kind": "samples", "source_kind": "recordings",
    "items": ["Set 1 Rec 1.wav"], "dest": "SmokeTest",
})[1])
check("copy from recordings into samples",
      result["copied"] and result["copied"][0]["path"] == "SmokeTest/Set 1 Rec 1.wav", result)
call("POST", "/api/delete", {"kind": "samples", "items": ["SmokeTest/Set 1 Rec 1.wav"]})

try:
    call("POST", "/api/copy", {
        "kind": "presets", "source_kind": "samples",
        "items": ["SmokeTest/renamed.wav"], "dest": "",
    })
    check("copy from samples into presets is refused", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("copy from samples into presets is refused", exc.code == 400, exc.code)

# rename must refuse a path
try:
    call("POST", "/api/rename",
         {"kind": "samples", "path": "SmokeTest/renamed.wav", "new_name": "../escape.wav"})
    check("rename rejects path separators", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("rename rejects path separators", exc.code == 400, exc.code)

# multi-file download
_, raw = call("POST", "/api/download-zip",
              {"kind": "samples", "items": ["SmokeTest/renamed.wav", "SmokeTest/nested"],
               "folder": "SmokeTest"})
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    members = sorted(n.replace("\\", "/") for n in archive.namelist())
    payload = archive.read("nested/two.wav")
check("zip holds a loose file and a whole folder",
      members == ["nested/two.wav", "renamed.wav"], members)
check("zipped folder keeps its contents", payload == b"RIFFfake-two", payload)

_, headers, raw = call_full("GET", "/api/download?kind=samples&path=SmokeTest/made")
check("empty folder downloads as a zip rather than erroring",
      headers.get("Content-Type") == "application/zip", headers.get("Content-Type"))

_, raw = call("POST", "/api/download-zip", {"kind": "samples", "items": ["SmokeTest/made"]})
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    members = archive.namelist()
check("empty selected folder survives zipping", members == ["made/"], members)

try:
    call("POST", "/api/download-zip", {"kind": "samples", "items": []})
    check("empty zip selection rejected", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("empty zip selection rejected", exc.code == 400, exc.code)

# audio preview
status_code, headers, body = call_full("GET", "/api/preview?kind=samples&path=Drums/Kick.wav")
check("preview serves wav with the right type",
      headers.get("Content-Type") == "audio/wav", headers.get("Content-Type"))
check("preview advertises range support",
      headers.get("Accept-Ranges") == "bytes", headers.get("Accept-Ranges"))
check("preview returns the whole file", body[:4] == b"RIFF" and len(body) > 1000, len(body))

total = len(body)
status_code, headers, chunk = call_full(
    "GET", "/api/preview?kind=samples&path=Drums/Kick.wav", {"Range": "bytes=100-199"}
)
check("range request returns 206", status_code == 206, status_code)
check("range reports its slice",
      headers.get("Content-Range") == f"bytes 100-199/{total}", headers.get("Content-Range"))
check("range returns exactly those bytes", chunk == body[100:200], len(chunk))

_, headers, tail = call_full(
    "GET", "/api/preview?kind=samples&path=Drums/Kick.wav", {"Range": "bytes=-50"}
)
check("suffix range returns the tail", tail == body[-50:], len(tail))

_, _, open_ended = call_full(
    "GET", "/api/preview?kind=samples&path=Drums/Kick.wav", {"Range": f"bytes={total - 10}-"}
)
check("open-ended range runs to the end", open_ended == body[-10:], len(open_ended))

try:
    call("GET", "/api/preview?kind=presets&path=Mock%20Kit.ablpreset")
    check("preview refuses non-audio", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("preview refuses non-audio", exc.code == 400, exc.code)

try:
    call("GET", "/api/preview?kind=samples&path=../../../etc/passwd")
    check("preview refuses traversal", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("preview refuses traversal", exc.code == 400, exc.code)

try:
    call("GET", "/api/preview?kind=samples&path=Drums/Nope.wav")
    check("preview 404s on a missing file", False, "request succeeded")
except urllib.error.HTTPError as exc:
    check("preview 404s on a missing file", exc.code == 404, exc.code)

# refresh is a no-op on mock, but must not error
_, raw = call("POST", "/api/refresh", {})
check("refresh succeeds on mock", json.loads(raw)["ok"] is True, raw)

# delete recursively
_, raw = call("POST", "/api/delete", {"kind": "samples", "items": ["SmokeTest"]})
check("delete removed the tree", json.loads(raw)["removed"] == ["SmokeTest"], raw)
_, raw = call("GET", "/api/list?kind=samples")
check("cleanup left samples root tidy",
      "SmokeTest" not in [i["name"] for i in json.loads(raw)["items"]], raw)

print()
if failures:
    print(f"{len(failures)} failed: {failures}")
    sys.exit(1)
print("all checks passed")
