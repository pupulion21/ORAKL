#!/usr/bin/env python3
"""Verify two bounded ASCII profile fixtures, not a complete JCS parser."""
import json
import subprocess


def keccak(data: bytes) -> str:
    return subprocess.check_output(["cast", "keccak", "0x" + data.hex()], text=True).strip()


vectors = [
    (b"", "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "0x1cf74347bbb24a8fd18eaeb719bfed04ae063217566f6911f64282d8cf7ff0b8"),
    (b"YES", "0x5950ebe73a617667a66f67d525282c827c82ef4d89ae8dcd8336d013773b6b7f", "0x25e6b620f9b58bbd4877655d0543cf8ef3c0e64b15df63239da099ac4967c74a"),
]
for raw, expected_content, expected_commitment in vectors:
    content = keccak(raw)
    if content != expected_content:
        raise SystemExit("raw content hash mismatch")
    manifest = {
        "chainId": "0", "claim": "YES", "contentHash": content,
        "contentMediaType": "text/plain", "contract": "0x0000000000000000000000000000000000000001",
        "kind": "objection", "marketId": "7", "media": [], "proposedOutcome": "NO",
        "publishedAt": "0", "publisher": "0x0000000000000000000000000000000000000002",
        "schema": "orakl-evidence-v1", "sources": ["https://example.invalid/source"],
    }
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    commitment = keccak(encoded)
    if commitment != expected_commitment:
        raise SystemExit("manifest commitment mismatch")
    print(f"PASS content={raw!r} contentHash={content} commitment={commitment}")
