"""Map of the Ableton Move filesystem.

Paths confirmed against the extending-move wiki and firmware 1.3+ layout.
"""

from __future__ import annotations

import posixpath

USER_LIBRARY = "/data/UserData/UserLibrary"
CORE_LIBRARY = "/data/CoreLibrary"

SAMPLES = f"{USER_LIBRARY}/Samples"
RECORDINGS = f"{USER_LIBRARY}/Recordings"
TRACK_PRESETS = f"{USER_LIBRARY}/Track Presets"
SETS = f"{USER_LIBRARY}/Sets"
AUDIO_EFFECTS = f"{USER_LIBRARY}/Audio Effects"

# Pad copies are assembled here, then `mv`'d into Sets/. Same filesystem as
# Sets/, so the rename is atomic. Move's Set Overview notices a finished
# folder arriving; it often ignores a folder that appears as a duplicate of
# an occupied pad and then has its index rewritten.
INCOMING_SETS = "/data/UserData/.mma-incoming"

LIBRARY_ROOTS: dict[str, str] = {
    "samples": SAMPLES,
    "recordings": RECORDINGS,
    "presets": TRACK_PRESETS,
    "sets": SETS,
    "effects": AUDIO_EFFECTS,
    "factory": CORE_LIBRARY,
}

# Tab labels. Kinds stay as LIBRARY_ROOTS keys so APIs do not change.
SECTION_LABELS: dict[str, str] = {
    "factory": "Core Library",
}

# Factory/CoreLibrary is stock firmware content. The app may read it and copy
# out of it, but never write back.
READONLY_KINDS = {"factory"}


def writable(kind: str) -> bool:
    return kind not in READONLY_KINDS

# Move caches its browser library. Files written over SFTP stay invisible to the
# device until this fires, which is the alternative to rebooting after uploads.
REFRESH_CACHE_CMD = (
    "dbus-send --system --type=method_call --dest=com.ableton.move "
    "--print-reply /com/ableton/move/browser "
    "com.ableton.move.Browser.refreshCache"
)

AUDIO_SUFFIXES = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a"}

# What to hand a browser <audio> element for each of the above.
AUDIO_MEDIA_TYPES: dict[str, str] = {
    ".wav": "audio/wav",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
}

PRESET_SUFFIXES = {".ablpreset", ".ablpresetbundle", ".json"}
SET_SUFFIXES = {".abl", ".ablbundle"}


class UnsafePath(ValueError):
    """Raised when a client-supplied path tries to escape its library root."""


def resolve(kind: str, relative: str = "") -> str:
    """Turn a library kind plus a relative path into an absolute Move path."""
    try:
        root = LIBRARY_ROOTS[kind]
    except KeyError:
        raise UnsafePath(f"unknown library section: {kind!r}") from None

    relative = (relative or "").replace("\\", "/").strip("/")
    if not relative:
        return root

    absolute = posixpath.normpath(posixpath.join(root, relative))
    if absolute != root and not absolute.startswith(root + "/"):
        raise UnsafePath(f"path escapes {kind}: {relative!r}")
    return absolute


def relative_to(kind: str, absolute: str) -> str:
    """Inverse of `resolve`, for handing paths back to the browser."""
    root = LIBRARY_ROOTS[kind]
    if absolute == root:
        return ""
    return absolute[len(root) + 1 :] if absolute.startswith(root + "/") else absolute
