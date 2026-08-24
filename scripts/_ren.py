import json, urllib.request, urllib.error
BASE = "http://127.0.0.1:8000"
def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def names(kind, path=""):
    c, b = call("GET", f"/api/list?kind={kind}&path={path}")
    return [i["name"] for i in json.loads(b)["items"]] if c == 200 else b

for kind in ["samples", "recordings", "presets", "sets", "effects"]:
    call("POST", "/api/mkdir", {"kind": kind, "path": "/RenSrc"})
    c1, b1 = call("POST", "/api/rename", {"kind": kind, "path": "RenSrc", "new_name": "RenDst"})
    after = names(kind)
    print(f"{kind:11} folder  {c1} {b1[:70]:14} renamed={'RenDst' in after and 'RenSrc' not in after}")
    call("POST", "/api/delete", {"kind": kind, "items": ["RenDst", "RenSrc"]})

# file rename, nested, and name that already exists
call("POST", "/api/mkdir", {"kind": "samples", "path": "/RenTest"})
import io, uuid
b = json.dumps({}).encode()
print()
print("nested folder rename:", call("POST", "/api/rename", {"kind": "samples", "path": "RenTest", "new_name": "RenTest2"}))
print("existing-name clash :", call("POST", "/api/mkdir", {"kind": "samples", "path": "/Clash"}),
      call("POST", "/api/rename", {"kind": "samples", "path": "RenTest2", "new_name": "Clash"}))
print("rename to same name :", call("POST", "/api/rename", {"kind": "samples", "path": "Clash", "new_name": "Clash"}))
print("rename with sep     :", call("POST", "/api/rename", {"kind": "samples", "path": "Clash", "new_name": "../x"}))
print("rename missing item :", call("POST", "/api/rename", {"kind": "samples", "path": "NoSuchThing", "new_name": "y"}))
print()
print("samples root now:", names("samples"))
for junk in ["RenTest", "RenTest2", "Clash"]:
    call("POST", "/api/delete", {"kind": "samples", "items": [junk]})
