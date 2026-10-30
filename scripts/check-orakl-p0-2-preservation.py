#!/usr/bin/env python3
"""Offline branch/source preservation evidence; never read keys, wallets, environment files or live RPC."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = "d46452479b9ce08dea77dd45730276c26fa50894"
EXPECTED_REFS = {"main": "b555a87e82d40560e50c8ce102239b10eb3bd365",
                 "refactor/orakl-protocol-v1": "7b8ac4e3f009c46631d88f5094e632972885aaaa",
                 "remediation/orakl-p0-1": BASE}
PROTECTED = ["contracts/src", "contracts/lib", "contracts/script", "contracts/foundry.toml", "frontend",
             "results/deployment", "docs/archive",
             "package.json", "package-lock.json", "docs/deployment/qie-mainnet.readiness.json",
             "contracts/abi/QiePredictionMarket.abi.json", "contracts/abi/QiePredictionMarket.artifact.json",
             "contracts/abi/QiePredictionMarket.methods.json", "contracts/test/QiePredictionMarket.t.sol",
             "contracts/test/QiePredictionMarketInvariant.t.sol", "contracts/test/helpers/TestBase.sol",
             "contracts/test/helpers/Vm.sol", "contracts/test/doubles/NativeReentrancy.sol"]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main():
    assert git("branch", "--show-current") == "feature/orakl-p0-2", "Unexpected working branch"
    actual_refs = {ref: git("rev-parse", ref) for ref in EXPECTED_REFS}
    assert actual_refs == EXPECTED_REFS, "A protected branch reference changed"
    assert not git("diff", "--name-only", BASE, "--", *PROTECTED), "Protected tracked content changed"
    assert not git("ls-files", "--others", "--exclude-standard", "--", *PROTECTED), "Untracked protected source added"
    protected_files = git("ls-files", "--", *PROTECTED).splitlines()
    preserved = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in protected_files}
    # Publish only the explicit test/compiler configuration allowlist, not RPC/API credentials or the environment.
    cfg = json.loads(subprocess.check_output(["forge", "config", "--json"], cwd=ROOT / "contracts", text=True))
    config = {k: cfg[k] for k in ["solc", "evm_version", "optimizer", "optimizer_runs", "via_ir", "bytecode_hash",
                                 "additional_compiler_profiles", "compilation_restrictions"] if k in cfg}
    config["fuzz"] = {k: cfg["fuzz"][k] for k in ["runs", "seed"]}
    config["invariant"] = {k: cfg["invariant"][k] for k in ["runs", "depth", "fail_on_revert"]}
    versions = {tool: subprocess.check_output([tool, "--version"], cwd=ROOT, text=True,
                                              stderr=subprocess.STDOUT).strip()
                for tool in ["forge", "solc", "slither", "node", "npm"]}
    report = {"status": "PASS", "baseline": BASE, "branch": git("branch", "--show-current"),
              "protected_refs": actual_refs, "protected_file_count": len(preserved), "source_sha256": preserved,
              "compiler_and_default_test_configuration": config, "tool_versions": versions,
              "scope": "Exact tracked baseline source/frontend/legacy/compiler references; no secret file reads or network writes"}
    output = ROOT / "docs/testing/p0-2/preservation.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"PASS: {len(preserved)} protected files and three branch references unchanged; default test/compiler settings captured")


if __name__ == "__main__":
    main()
