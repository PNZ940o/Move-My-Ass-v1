#!/usr/bin/env python3
"""Start Move My Ass on Windows, macOS or Linux.

    python run.py --mock     # local fake device, no hardware needed
    python run.py            # a real Move over SFTP

All this does is set the MOVE_* environment variables the app reads on import and
then hand over to uvicorn, so exporting those yourself works just as well and the
flags become optional.

The server is bound to 127.0.0.1 and that is not configurable here on purpose:
there is no authentication on any endpoint, so the loopback binding is the only
thing standing between the internet and full read/write access to your Move.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser

MIN_PYTHON = (3, 11)
INSTALL_HINT = """
Dependencies are missing. From this folder:

  Windows:      py -m venv .venv
                .venv\\Scripts\\python.exe -m pip install -r requirements.txt
                .venv\\Scripts\\python.exe run.py --mock

  macOS/Linux:  python3 -m venv .venv
                .venv/bin/python -m pip install -r requirements.txt
                .venv/bin/python run.py --mock
""".strip()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Move My Ass server and open it in a browser.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Device settings fall back to $MOVE_HOST, $MOVE_USER and $MOVE_KEY.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--mock",
        action="store_true",
        help="use the local mock-move folder instead of a device",
    )
    mode.add_argument(
        "--device",
        action="store_true",
        help="connect to a real Move over SFTP (the default)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("MOVE_APP_PORT", "8000")),
        help="port to serve on (default 8000)",
    )
    parser.add_argument("--move-host", help="device hostname, default move.local")
    parser.add_argument("--user", help="SSH user on the device, default ableton")
    parser.add_argument("--key", help="path to the SSH private key")
    parser.add_argument(
        "--no-browser", action="store_true", help="do not open a browser window"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if sys.version_info < MIN_PYTHON:
        running = ".".join(str(part) for part in sys.version_info[:3])
        wanted = ".".join(str(part) for part in MIN_PYTHON)
        print(f"Python {wanted} or newer is required; this is {running}.", file=sys.stderr)
        return 1

    if args.mock:
        os.environ["MOVE_BACKEND"] = "mock"
    elif args.device:
        os.environ["MOVE_BACKEND"] = "sftp"
    else:
        os.environ.setdefault("MOVE_BACKEND", "sftp")

    # Only override what was actually asked for, so app/config.py stays the one
    # place that decides the defaults.
    for value, name in ((args.move_host, "MOVE_HOST"), (args.user, "MOVE_USER"), (args.key, "MOVE_KEY")):
        if value:
            os.environ[name] = value

    try:
        import uvicorn
    except ModuleNotFoundError:
        print(INSTALL_HINT, file=sys.stderr)
        return 1

    from app.config import settings

    url = f"http://127.0.0.1:{args.port}"
    where = settings.mock_root if settings.backend == "mock" else f"{settings.user}@{settings.host}"
    print(f"Move My Ass v1 — {settings.backend} ({where})")
    print(f"Open {url}   (Ctrl+C to stop)")

    if not args.no_browser:
        # uvicorn.run blocks, so the browser has to be opened from a timer. The
        # delay is just long enough that the first request is not refused.
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()

    try:
        uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="info")
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
