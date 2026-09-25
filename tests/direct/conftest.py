"""Shared helpers for direct mode tests."""

import os


_original_unlink = os.unlink


def _unlink(path):
    try:
        _original_unlink(path)
    except PermissionError:
        if os.name != "nt":
            raise


os.unlink = _unlink


def to_hex(addr_bytes):
    """Convert an address fixture to a checksummed hexadecimal string."""
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    try:
        from genlayer.types import Address
    except ImportError:
        from genlayer.py.types import Address

    return Address(addr_bytes).as_hex
