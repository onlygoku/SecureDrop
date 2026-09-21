"""Versioned SecureDrop package encoding and decoding."""
from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"SDROP001"
TAG_SIZE = 16
CHUNK_SIZE = 1024 * 1024
KDF = {"memory_kib": 65536, "iterations": 3, "parallelism": 2, "hash_len": 32}


class SecureDropError(Exception):
    pass


class AuthenticationError(SecureDropError):
    pass


def _derive_key(password: str, salt: bytes, params: dict) -> bytes:
    return hash_secret_raw(password.encode("utf-8"), salt, params["iterations"],
                           params["memory_kib"], params["parallelism"],
                           params["hash_len"], Type.ID)


def _header(salt: bytes, nonce: bytes) -> tuple[dict, bytes]:
    value = {"version": 1, "cipher": "AES-256-GCM", "payload": "zip",
             "argon2id": {**KDF, "salt": base64.b64encode(salt).decode("ascii")},
             "nonce": base64.b64encode(nonce).decode("ascii")}
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return value, MAGIC + struct.pack("<I", len(raw)) + raw


def _safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and not any(part.endswith(":") for part in path.parts)


def _archive_paths(paths: Iterable[Path], archive: Path) -> None:
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for path in paths:
            if path.is_file():
                zf.write(path, path.name)
            elif path.is_dir():
                for child in path.rglob("*"):
                    if child.is_file():
                        zf.write(child, str(Path(path.name) / child.relative_to(path)))


def _temp_zip(output: Path) -> Path:
    fd, raw = tempfile.mkstemp(prefix="securedrop-", suffix=".zip", dir=output.parent)
    os.close(fd)
    return Path(raw)


def encrypt(paths: Iterable[str | Path], output: str | Path, password: str,
            progress: Callable[[int, int], None] | None = None) -> Path:
    """Create an authenticated .sdrop package. Raises SecureDropError on expected failures."""
    source = [Path(p) for p in paths]
    output = Path(output)
    if not source:
        raise SecureDropError("No files were selected.")
    if not password:
        raise SecureDropError("A password is required.")
    if any(not p.exists() for p in source):
        raise SecureDropError("One or more selected files no longer exist.")
    if output.suffix.lower() != ".sdrop":
        output = output.with_suffix(".sdrop")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = _temp_zip(output)
    pending = output.with_suffix(output.suffix + ".partial")
    try:
        _archive_paths(source, temp)
        total = temp.stat().st_size
        salt, nonce = os.urandom(16), os.urandom(12)
        _, aad = _header(salt, nonce)
        encryptor = Cipher(algorithms.AES(_derive_key(password, salt, KDF)), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(aad)
        with temp.open("rb") as incoming, pending.open("wb") as outgoing:
            outgoing.write(aad)
            done = 0
            while block := incoming.read(CHUNK_SIZE):
                outgoing.write(encryptor.update(block))
                done += len(block)
                if progress: progress(done, total)
            outgoing.write(encryptor.finalize())
            outgoing.write(encryptor.tag)
        os.replace(pending, output)
        return output
    except OSError as exc:
        raise SecureDropError(f"The output file could not be written: {exc}") from exc
    finally:
        temp.unlink(missing_ok=True)
        pending.unlink(missing_ok=True)


def decrypt(package: str | Path, destination: str | Path, password: str,
            progress: Callable[[int, int], None] | None = None) -> Path:
    package, destination = Path(package), Path(destination)
    if not password: raise SecureDropError("A password is required.")
    try:
        destination.mkdir(parents=True, exist_ok=True)
        with package.open("rb") as fh:
            prefix = fh.read(12)
            if len(prefix) != 12 or prefix[:8] != MAGIC: raise SecureDropError("This is not a SecureDrop version 1 package.")
            length = struct.unpack("<I", prefix[8:])[0]
            raw = fh.read(length)
            try: header = json.loads(raw)
            except json.JSONDecodeError as exc: raise SecureDropError("The package header is invalid.") from exc
            if header.get("version") != 1 or header.get("cipher") != "AES-256-GCM": raise SecureDropError("This package version is not supported.")
            salt = base64.b64decode(header["argon2id"]["salt"])
            nonce = base64.b64decode(header["nonce"])
            params = header["argon2id"]
            aad = prefix + raw
            total = package.stat().st_size - len(aad) - TAG_SIZE
            if total < 0: raise SecureDropError("The package is incomplete.")
            tag_offset = package.stat().st_size - TAG_SIZE
            fh.seek(tag_offset); tag = fh.read(TAG_SIZE); fh.seek(len(aad))
            decryptor = Cipher(algorithms.AES(_derive_key(password, salt, params)), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(aad)
            temp = _temp_zip(destination / "payload.sdrop")
            try:
                with temp.open("wb") as out:
                    done = 0
                    while done < total:
                        block = fh.read(min(CHUNK_SIZE, total - done))
                        out.write(decryptor.update(block)); done += len(block)
                        if progress: progress(done, total)
                    out.write(decryptor.finalize())
                with zipfile.ZipFile(temp) as zf:
                    if any(not _safe_member(info.filename) for info in zf.infolist()): raise SecureDropError("The package contains an unsafe file path.")
                    zf.extractall(destination)
            finally: temp.unlink(missing_ok=True)
        return destination
    except InvalidTag as exc:
        raise AuthenticationError("The password is incorrect or the package has been altered.") from exc
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
        raise SecureDropError(f"The package could not be decrypted: {exc}") from exc
