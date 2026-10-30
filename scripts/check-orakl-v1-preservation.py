#!/usr/bin/env python3
"""Read-only check of release baseline hashes, protected refs and Solidity configuration."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = "9e256c1451d666889f9f248edee3e2e2d61f6d48"
REFS = {
    "main": "b555a87e82d40560e50c8ce102239b10eb3bd365",
    "refactor/orakl-protocol-v1": "7b8ac4e3f009c46631d88f5094e632972885aaaa",
    "remediation/orakl-p0-1": "d46452479b9ce08dea77dd45730276c26fa50894",
    "feature/orakl-p0-2": "8d850ae42ebc77acaf2323cd50f63f08e57f1b66",
    "security/orakl-p0-3": BASE,
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


snapshot = json.loads((ROOT / "docs/testing/orakl-v1-candidate/preservation-hashes.json").read_text())
assert snapshot["baseline"] == BASE
assert snapshot["protectedFileCount"] == len(snapshot["files"]) == 312
assert len({entry["path"] for entry in snapshot["files"]}) == len(snapshot["files"])
for entry in snapshot["files"]:
    path = entry["path"]
    baseline = git("show", f"{BASE}:{path}")
    current = (ROOT / path).read_bytes()
    assert hashlib.sha256(baseline).hexdigest() == entry["sha256"], path
    assert hashlib.sha256(current).hexdigest() == entry["sha256"], path
for ref, expected in REFS.items():
    assert git("rev-parse", ref).decode().strip() == expected, ref
changed = git("diff", "--name-only", BASE, "--", "contracts/src", "contracts/test",
              "contracts/foundry.toml", "contracts/lib", "frontend").decode().strip()
assert not changed, changed
artifact = json.loads((ROOT / "docs/testing/orakl-v1-candidate/artifact-check.json").read_text())
legacy = next(item for item in artifact["contracts"] if item["name"] == "QiePredictionMarket")
assert legacy["runtimeTemplateKeccak256"] == "0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b"
print("PASS: 312 protected files match baseline, five protected refs unchanged, Solidity/tests/config/frontend unchanged, legacy runtime identity matches")
