#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS = {
    # The launcher icon moved to the 1024 master the stores expect; 512 was the
    # placeholder's size, not a requirement.
    REPO_ROOT / "apps/mobile-tv/assets/icon.png": (1024, 1024),
    REPO_ROOT / "apps/mobile-tv/assets/tv-banner.png": (320, 180),
}


def verify_png(path: Path, expected_size: tuple[int, int]) -> None:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise SystemExit(f"{path}: invalid PNG signature")

    offset = len(PNG_SIGNATURE)
    size: tuple[int, int] | None = None
    saw_iend = False

    while offset < len(data):
        if offset + 12 > len(data):
            raise SystemExit(f"{path}: truncated PNG chunk header")

        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        crc_end = data_end + 4
        if crc_end > len(data):
            raise SystemExit(f"{path}: truncated {chunk_type!r} chunk")

        chunk_data = data[data_start:data_end]
        expected_crc = struct.unpack(">I", data[data_end:crc_end])[0]
        actual_crc = zlib.crc32(chunk_type)
        actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise SystemExit(
                f"{path}: CRC mismatch in {chunk_type.decode('ascii', 'replace')} chunk"
            )

        if chunk_type == b"IHDR":
            if length != 13 or size is not None:
                raise SystemExit(f"{path}: invalid IHDR chunk")
            width, height = struct.unpack(">II", chunk_data[:8])
            size = (width, height)
        elif chunk_type == b"IEND":
            if length != 0:
                raise SystemExit(f"{path}: invalid IEND chunk")
            saw_iend = True
            offset = crc_end
            break

        offset = crc_end

    if size is None:
        raise SystemExit(f"{path}: missing IHDR chunk")
    if not saw_iend:
        raise SystemExit(f"{path}: missing IEND chunk")
    if offset != len(data):
        raise SystemExit(f"{path}: unexpected trailing bytes after IEND")
    if size != expected_size:
        raise SystemExit(
            f"{path}: expected {expected_size[0]}x{expected_size[1]}, got {size[0]}x{size[1]}"
        )


def main() -> None:
    for path, expected_size in ASSETS.items():
        verify_png(path, expected_size)
        display_path = path.relative_to(REPO_ROOT)
        print(
            f"PASS {display_path} is a valid "
            f"{expected_size[0]}x{expected_size[1]} PNG"
        )


if __name__ == "__main__":
    main()
