# Move My Ass

A replacement for Ableton's Move Manager, focused on the things the official one
handles badly: bulk sample uploads, building drum kits, browsing what's actually
on the device, preset management, and backups.

It runs as a small web app **on your PC** and talks to the Move over SFTP. Nothing
is installed on the device and no firmware is modified — we only read and write
files in your own user library.

## Status

Working now:

- Browse Samples, Recordings, Track Presets, Sets and Audio Effects
- Bulk upload: multiple files, whole folders, drag-and-drop of nested folder trees
- Uploads are batched so a 500-sample drop doesn't become one giant request
- Automatic device library refresh after upload, so Move sees new files without a reboot
- Create folders, rename, delete
- **Audio preview** — play any sample or recording straight from the listing,
  streamed off the device; one plays at a time
- Download a single file as-is, or any mix of files and folders as one zip
- **Drum kit builder** — point it at a folder of samples or recordings and it
  guesses roles from filenames to fill the 16 pads, which you can then adjust
- **Break slicing** — chop any WAV across the pads without cutting any audio
- Kits save straight to the device, or download as an `.ablpresetbundle`
- A mock backend, so all of the above can be developed with no Move attached

Not built yet: preset editing and set backup/restore.

## Tests

The suites create, rename and delete files, so **run them against the mock
backend only** — switch the Connection dialog to mock mode, or start the server
with `.\run.ps1 -Mock`, before running these:

```powershell
.\.venv\Scripts\python.exe scripts\smoke_test.py   # file manager
.\.venv\Scripts\python.exe scripts\kit_test.py     # kit builder
```

## HTTP API

Everything the browser does goes through these. Paths are always relative to a
section root and run through `paths.resolve()`, which refuses anything that
climbs out of its section.

| Endpoint | What it does |
| --- | --- |
| `GET /api/status`, `POST /api/connect`, `POST /api/disconnect` | Connection state |
| `GET /api/list?kind=&path=` | Directory listing with categories and sizes |
| `POST /api/upload` | Multipart upload, `relpaths` preserves folder structure |
| `POST /api/mkdir` | `{kind, path}` — rejects a path that resolves to the section root |
| `POST /api/rename` | `{kind, path, new_name}` — `new_name` may not contain `/` |
| `POST /api/delete` | `{kind, items}`, recursive |
| `GET /api/download?kind=&path=` | One file as-is, or one folder zipped |
| `POST /api/download-zip` | `{kind, items, folder}` — any mix of files and folders as one zip |
| `GET /api/preview?kind=&path=` | Streams audio for `<audio>`, supports Range |
| `POST /api/kit/plan-pads`, `/api/kit/plan-slices`, `/api/kit/build` | Kit builder |
| `POST /api/refresh` | Device library cache refresh |

### Audio preview

`GET /api/preview` sets `Content-Type` from the extension (`audio/wav`,
`audio/aiff`, `audio/mpeg`, `audio/flac`, `audio/ogg`, `audio/mp4`) and refuses
anything that isn't audio. It always sends `Accept-Ranges: bytes`, and answers a
`Range` request with `206` plus `Content-Range`; an unsatisfiable range gets
`416`. Ranges it can't parse — multipart ranges, for instance — fall back to the
whole file, which the spec allows.

Browsers ask for ranges constantly while seeking, so `SftpBackend.read_range()`
seeks on the remote handle instead of pulling the whole sample down again. Note
that `prefetch()` queues reads from the current position, so the seek has to come
first or it fetches the head of the file for nothing.

### Zipped downloads

`POST /api/download-zip` takes a list of paths. Files land at the top level of
the archive; a selected folder keeps its own name as a prefix, so its structure
survives. `folder` only names the zip. Selecting a single file still uses
`GET /api/download`, which returns it untouched.

## Why "New folder" used to fail

It was never the path handling. `resolve()` strips the leading slash the frontend
sent, every `LIBRARY_ROOTS` entry exists both on a fresh mock and on real
hardware, and `makedirs` was verified against all five sections over SFTP.

The button asked for the name with `window.prompt()`. Browsers are allowed to
suppress native dialogs — Chromium offers "prevent this page from creating
additional dialogs" from the second one onwards — and a suppressed `prompt()`
returns `null`, which the handler could not tell apart from the user pressing
Cancel. So it worked once and then silently did nothing, with no request, no
error and nothing in the server log. It now uses an in-page dialog, which cannot
be suppressed; Rename uses the same one.

Two smaller things fell out of that: `mkdir` used to answer `200` for a name that
resolved back to the section root, so it claimed success while creating nothing,
and downloading an **empty** folder used to fail because emptiness was read as
"this is a file".

## How the kit builder works

A kit is an `instrumentRack` containing a `drumRack` with 16 chains. Each chain
holds a `drumCell` whose `deviceData.sampleUri` points at a sample, and a
`drumZoneSettings.receivingNote` from 36 to 51.

Pads are laid out by role across the 4x4 grid — beat backbone on the first row,
hats on the second, toms on the third, cymbals and colour on the fourth:

| | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Row 1 | kick | snare | clap | rim |
| Row 2 | pedal hat | open hat | closed hat | shaker |
| Row 3 | low tom | mid tom | high tom | cowbell |
| Row 4 | crash | ride | perc | fx |

Filenames are matched against keyword lists per role. Keywords of three
characters or fewer (`bd`, `sd`, `hh`) only match whole words, so they don't fire
on unrelated filenames. Anything unmatched fills the remaining pads
alphabetically, and samples that don't fit are reported rather than dropped.

Kit types set the envelope behaviour: `drum` is one-shot, `choke` makes pads cut
each other off, `gate` sustains while a pad is held.

### Slicing cuts no audio

All 16 pads reference the same file and set `Voice_PlaybackStart` and
`Voice_PlaybackLength`, both normalised to 0..1. So slicing needs nothing but the
sample's duration, which comes from the WAV header via the standard library — no
`librosa`, `soundfile` or ffmpeg required. The cost is that slicing is WAV-only,
since Python removed the `aifc` module in 3.13.

### Sample URIs

Audio on the device is referenced as
`ableton:/user-library/<Section>/<percent-encoded path>`, where the section is
`Samples` or `Recordings`. Inside a bundle the URI is relative instead:
`Samples/<percent-encoded filename>`.

Verified against a kit written by Move itself, which referenced
`ableton:/user-library/Recordings/Set%2039%20Rec%2014.wav`. Kits can therefore
draw from Recordings as well as Samples, which is useful because Move dumps every
resample and audio recording there.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\make_mock.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Then open http://127.0.0.1:8000. It starts against the mock folder, so it works
before you have SSH set up.

## Connecting to a real Move

The Move needs to accept your SSH key first. This is a facility Ableton exposes
itself, but it comes with an explicit warning that you become responsible for the
device and its data — take that seriously, and read the risk notes below.

1. Generate a key if you don't have one: `ssh-keygen -t ed25519`
2. Connect Move by USB-C or put it on the same Wi-Fi network
3. Open <http://move.local/development/ssh> and paste the contents of your
   public key (for example `%USERPROFILE%\.ssh\id_ed25519.pub`)
4. Reboot Move, then check it works: `ssh ableton@move.local`

SFTP has been enabled by default since firmware 1.3.0.

Once that works, click **Connection** in the app, switch the mode to
"Real Move over SFTP", and connect. Or skip the dialog entirely:

```powershell
.\run.ps1              # real device
.\run.ps1 -Mock        # local fake device
```

### If ssh can't find move.local

Windows' OpenSSH client doesn't use the resolver that handles mDNS `.local`
names, so `ssh ableton@move.local` can fail with "Could not resolve hostname"
while the same name works fine in a browser. This is a quirk of the ssh client
only — Python resolves it correctly, so **the app itself can use `move.local`**
and doesn't need a hardcoded IP.

To use ssh on the command line directly, find the address and use that:

```powershell
Resolve-DnsName move.local -Type A
ssh -i ~/.ssh/id_ed25519_move ableton@<that address>
```

Because it's DHCP, the IP can change, so prefer the hostname wherever it works.

## Verified on hardware

Checked against a real Move on firmware 1.x, connected over Wi-Fi as `ableton`:

- The user library lives exactly where documented, with `Samples`, `Recordings`,
  `Sets`, `Track Presets` and `Audio Effects`
- All five of those exist already and are owned by `ableton` (uid 1000, mode
  755), so folder creation works in every section without any setup
- **The library refresh dbus call works as the `ableton` user** — root is not
  required, contrary to what the wiki implies
- Sets are stored as **UUID-named folders**, not human-readable names, so a
  useful set browser has to read the name out of each set rather than trusting
  the folder name
- Sample URIs are section-prefixed and percent-encoded (see below)

## Configuration

Settings come from the environment, and can be overridden live in the UI.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOVE_BACKEND` | `mock` | `mock` or `sftp` |
| `MOVE_HOST` | `move.local` | Device hostname |
| `MOVE_PORT` | `22` | SSH port |
| `MOVE_USER` | `ableton` | `ableton` owns the user library; `root` can also refresh the library cache |
| `MOVE_KEY` | *(unset)* | Path to a private key; blank uses your SSH agent and default keys |
| `MOVE_MOCK_ROOT` | `./mock-move` | Where the fake device lives |

### A note on which user to connect as

Use `ableton`. It owns `/data/UserData`, so uploads get the right ownership, and
testing showed it can also make the library-refresh call — so there's no reason
to connect as root.

## How Move stores things

| What | Where |
| --- | --- |
| Samples | `/data/UserData/UserLibrary/Samples` |
| Recordings | `/data/UserData/UserLibrary/Recordings` |
| Track presets | `/data/UserData/UserLibrary/Track Presets` |
| Sets | `/data/UserData/UserLibrary/Sets` |
| Built-in content | `/data/CoreLibrary` |

`.ablpreset` files are plain JSON. `.ablpresetbundle` and `.ablbundle` are zip
archives containing a preset or set plus its samples.

Move caches its browser library, so files written over SFTP are invisible to the
device until the cache is refreshed. The app does this for you after an upload.

## Risks

This is unofficial. Adding an SSH key puts the device into a state Ableton did
not design it for, and Ableton cannot support you if something breaks. Back up
anything you care about before you start, and find the DFU restore procedure
(available on Center Code) *before* you need it.

This app confines itself to file operations inside your user library, which is
the lowest-risk category of change, but the risk isn't zero.

## Credits

The Move filesystem layout, the SSH access procedure, the preset format and the
library-refresh call are all documented by
[charlesvestal/extending-move](https://github.com/charlesvestal/extending-move)
and its wiki. That project is a companion webserver that runs *on* the device;
this one deliberately runs on the PC instead.
