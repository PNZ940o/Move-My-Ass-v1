"""Storage backends for talking to a Move.

`SftpBackend` drives a real device over SSH/SFTP. `LocalBackend` mirrors the same
interface against a folder on this machine, so every feature can be built and
tested without the hardware attached.
"""

from __future__ import annotations

import posixpath
import shlex
import shutil
import stat
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import paramiko

from . import paths

# OpenSSH's sftp-server keeps roughly 64 requests in flight. Prefetching a large
# sample with no cap queues every chunk at once, which has been seen to stall the
# channel outright, so keep the queue comfortably under that.
MAX_PREFETCH_REQUESTS = 32

# Raised when the Move sleeps, reboots, or leaves the network mid-operation. These
# mean "the connection died", not "the request was wrong", so they earn a 503 and a
# fresh dial rather than a 500.
TRANSPORT_ERRORS: tuple[type[BaseException], ...] = (
    paramiko.SSHException,
    EOFError,
    ConnectionError,
    TimeoutError,
)


def _known_hosts_path() -> Path:
    return Path.home() / ".ssh" / "known_hosts"


def _known_host_names(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return []
    return stripped.split()[0].split(",")


def _replace_known_host(hostname: str, key) -> None:
    """Swap the stored SSH host key after a Move firmware update."""
    path = _known_hosts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    kept = [line for line in lines if hostname not in _known_host_names(line)]
    kept.append(f"{hostname} {key.get_name()} {key.get_base64()}")
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")


def _remember_host_key(client: paramiko.SSHClient, hostname: str, key) -> None:
    keys = client.get_host_keys()
    for name in list(keys.keys()):
        if hostname == name or hostname in str(name).split(","):
            del keys[name]
    keys.add(hostname, key.get_name(), key)


@dataclass(frozen=True)
class Entry:
    name: str
    path: str
    is_dir: bool
    size: int
    mtime: float


@dataclass(frozen=True)
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


class MoveBackend(ABC):
    label: str = "unknown"

    @abstractmethod
    def list_dir(self, path: str) -> list[Entry]: ...

    @abstractmethod
    def read_file(self, path: str) -> bytes: ...

    @abstractmethod
    def write_file(self, path: str, data: bytes) -> None: ...

    @abstractmethod
    def makedirs(self, path: str) -> None: ...

    @abstractmethod
    def remove(self, path: str) -> None: ...

    @abstractmethod
    def rename(self, src: str, dst: str) -> None: ...

    @abstractmethod
    def copy_tree(self, src: str, dst: str) -> None: ...

    @abstractmethod
    def exists(self, path: str) -> bool: ...

    @abstractmethod
    def is_dir(self, path: str) -> bool: ...

    @abstractmethod
    def file_size(self, path: str) -> int: ...

    @abstractmethod
    def read_range(self, path: str, offset: int, length: int) -> bytes: ...

    @abstractmethod
    def run(self, command: str, timeout: float = 20.0) -> CommandResult: ...

    def refresh_library(self) -> CommandResult:
        return self.run(paths.REFRESH_CACHE_CMD)

    def close(self) -> None:
        return None


class LocalBackend(MoveBackend):
    """Mirrors Move's absolute paths inside a local sandbox directory."""

    label = "mock"

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _local(self, path: str) -> Path:
        return self.root / path.lstrip("/")

    def list_dir(self, path: str) -> list[Entry]:
        target = self._local(path)
        if not target.is_dir():
            return []
        entries = []
        for child in target.iterdir():
            info = child.stat()
            entries.append(
                Entry(
                    name=child.name,
                    path=posixpath.join(path, child.name),
                    is_dir=child.is_dir(),
                    size=0 if child.is_dir() else info.st_size,
                    mtime=info.st_mtime,
                )
            )
        return entries

    def read_file(self, path: str) -> bytes:
        return self._local(path).read_bytes()

    def write_file(self, path: str, data: bytes) -> None:
        target = self._local(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def makedirs(self, path: str) -> None:
        self._local(path).mkdir(parents=True, exist_ok=True)

    def remove(self, path: str) -> None:
        target = self._local(path)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)

    def rename(self, src: str, dst: str) -> None:
        target = self._local(dst)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._local(src).rename(target)

    def copy_tree(self, src: str, dst: str) -> None:
        target = self._local(dst)
        if target.exists():
            raise FileExistsError(dst)
        shutil.copytree(self._local(src), target)

    def exists(self, path: str) -> bool:
        return self._local(path).exists()

    def is_dir(self, path: str) -> bool:
        return self._local(path).is_dir()

    def file_size(self, path: str) -> int:
        return self._local(path).stat().st_size

    def read_range(self, path: str, offset: int, length: int) -> bytes:
        with self._local(path).open("rb") as handle:
            handle.seek(offset)
            return handle.read(length)

    def run(self, command: str, timeout: float = 20.0) -> CommandResult:
        return CommandResult(0, "", "mock backend: command skipped")

    def refresh_library(self) -> CommandResult:
        return CommandResult(0, "mock backend: nothing to refresh", "")


class SftpBackend(MoveBackend):
    label = "sftp"

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        key_path: Path | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.host = host
        self.user = user
        self._client = paramiko.SSHClient()
        self._client.load_system_host_keys()
        # A Move on the local network gets its host key trusted on first sight;
        # we are not authenticating a server we share secrets with.
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        def _open():
            self._client.connect(
                hostname=host,
                port=port,
                username=user,
                key_filename=str(key_path) if key_path else None,
                look_for_keys=True,
                allow_agent=True,
                timeout=timeout,
            )

        try:
            _open()
        except paramiko.BadHostKeyException as exc:
            got = getattr(exc, "key", None)
            if got is None:
                raise
            hostname = getattr(exc, "hostname", None) or host
            _replace_known_host(hostname, got)
            _remember_host_key(self._client, hostname, got)
            _open()
        self._sftp = self._client.open_sftp()

    def list_dir(self, path: str) -> list[Entry]:
        try:
            attrs = self._sftp.listdir_attr(path)
        except FileNotFoundError:
            return []
        except OSError as exc:
            message = str(exc).lower()
            if "permission" in message or "denied" in message:
                raise PermissionError(f"can't read {path}") from exc
            raise
        entries = []
        for attr in attrs:
            is_dir = stat.S_ISDIR(attr.st_mode or 0)
            entries.append(
                Entry(
                    name=attr.filename,
                    path=posixpath.join(path, attr.filename),
                    is_dir=is_dir,
                    size=0 if is_dir else (attr.st_size or 0),
                    mtime=float(attr.st_mtime or 0),
                )
            )
        return entries

    def read_file(self, path: str) -> bytes:
        with self._sftp.open(path, "rb") as handle:
            handle.prefetch(max_concurrent_requests=MAX_PREFETCH_REQUESTS)
            return handle.read()

    def write_file(self, path: str, data: bytes) -> None:
        self.makedirs(posixpath.dirname(path))
        with self._sftp.open(path, "wb") as handle:
            handle.set_pipelined(True)
            handle.write(data)

    def makedirs(self, path: str) -> None:
        parts = [p for p in path.strip("/").split("/") if p]
        current = ""
        for part in parts:
            current = f"{current}/{part}"
            try:
                self._sftp.stat(current)
            except FileNotFoundError:
                self._sftp.mkdir(current)

    def remove(self, path: str) -> None:
        info = self._sftp.stat(path)
        if stat.S_ISDIR(info.st_mode or 0):
            for entry in self.list_dir(path):
                self.remove(entry.path)
            self._sftp.rmdir(path)
        else:
            self._sftp.remove(path)

    def rename(self, src: str, dst: str) -> None:
        self.makedirs(posixpath.dirname(dst))
        self._sftp.posix_rename(src, dst)

    def copy_tree(self, src: str, dst: str) -> None:
        if self.exists(dst):
            raise FileExistsError(dst)
        result = self.run(f"cp -a {shlex.quote(src)} {shlex.quote(dst)}", timeout=180)
        if not result.ok:
            detail = (result.stderr or result.stdout or "copy failed").strip()
            raise RuntimeError(detail)

    def exists(self, path: str) -> bool:
        try:
            self._sftp.stat(path)
        except FileNotFoundError:
            return False
        return True

    def is_dir(self, path: str) -> bool:
        try:
            info = self._sftp.stat(path)
        except FileNotFoundError:
            return False
        return stat.S_ISDIR(info.st_mode or 0)

    def file_size(self, path: str) -> int:
        return self._sftp.stat(path).st_size or 0

    def read_range(self, path: str, offset: int, length: int) -> bytes:
        # Seeking beats read_file() here: a preview seek would otherwise pull the
        # whole sample down the SFTP channel again.
        with self._sftp.open(path, "rb") as handle:
            handle.seek(offset)
            # prefetch() queues reads from the current position, so seek first or
            # it pulls the head of the file down for nothing.
            handle.prefetch(offset + length, max_concurrent_requests=MAX_PREFETCH_REQUESTS)
            return handle.read(length)

    def run(self, command: str, timeout: float = 20.0) -> CommandResult:
        _, stdout, stderr = self._client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        return CommandResult(stdout.channel.recv_exit_status(), out, err)

    def close(self) -> None:
        try:
            self._sftp.close()
        finally:
            self._client.close()
