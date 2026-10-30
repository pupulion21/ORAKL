#!/usr/bin/env python3
"""Verify immutable baseline refs, legacy identity, A-N assertions and unmodified financial/release policies offline."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = "8d850ae42ebc77acaf2323cd50f63f08e57f1b66"
EXPECTED_REFS = {"main": "b555a87e82d40560e50c8ce102239b10eb3bd365",
                 "refactor/orakl-protocol-v1": "7b8ac4e3f009c46631d88f5094e632972885aaaa",
                 "remediation/orakl-p0-1": "d46452479b9ce08dea77dd45730276c26fa50894",
                 "feature/orakl-p0-2": BASE}
ALLOWED_SOLIDITY = {"contracts/src/MarketResolver.sol", "contracts/src/ProtocolConfig.sol",
                    "contracts/src/interfaces/IProtocolConfig.sol"}
PROTECTED = ["contracts/src/PredictionPool.sol", "contracts/src/ProtocolStorage.sol", "contracts/src/MarketFactory.sol",
             "contracts/src/QiePredictionMarket.sol", "contracts/src/libraries", "contracts/src/interfaces/IMultisig.sol",
             "contracts/lib", "contracts/script", "contracts/foundry.toml", "frontend", "package.json", "package-lock.json",
             "results/deployment", "docs/archive", "docs/product/ORAKL-PRD-v1.0.md", "docs/testing/p0-1", "docs/testing/p0-2",
             "docs/testing/P0_2_VERIFICATION_REPORT.md", "docs/deployment/qie-mainnet.readiness.json",
             "contracts/abi/QiePredictionMarket.abi.json", "contracts/abi/QiePredictionMarket.artifact.json",
             "contracts/abi/QiePredictionMarket.methods.json", "contracts/test/QiePredictionMarket.t.sol",
             "contracts/test/QiePredictionMarketInvariant.t.sol", "contracts/test/helpers/TestBase.sol",
             "contracts/test/helpers/Vm.sol", "contracts/test/doubles/NativeReentrancy.sol"]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def body(source, name):
    start = source.index("function " + name + "(")
    left = source.index("{", start)
    level, i = 1, left + 1
    while level:
        level += (source[i] == "{") - (source[i] == "}")
        i += 1
    return re.sub(r"\s+", "", source[start:i])


def main():
    assert git("branch", "--show-current") == "security/orakl-p0-3"
    refs = {r: git("rev-parse", r) for r in EXPECTED_REFS}
    assert refs == EXPECTED_REFS, "Protected ref changed"
    assert not git("diff", "--name-only", BASE, "--", *PROTECTED), "Protected financial/legacy/source/history content changed"
    assert not git("ls-files", "--others", "--exclude-standard", "--", *PROTECTED)
    changed = set(git("diff", "--name-only", BASE, "--", "contracts/src").splitlines())
    assert changed == ALLOWED_SOLIDITY, changed
    invariant = "contracts/test/invariant/OraklInvariant.t.sol"
    old = git("show", f"{BASE}:{invariant}")
    new = (ROOT / invariant).read_text()
    invariants = re.findall(r"function (invariant_[A-N]_[A-Za-z0-9_]+)\(", old)
    assert len(invariants) == 14
    for name in invariants:
        assert body(old, name) == body(new, name), f"A-N assertion weakened/changed: {name}"
    config_path = "contracts/src/ProtocolConfig.sol"
    old_config = git("show", f"{BASE}:{config_path}")
    config = (ROOT / config_path).read_text()
    controls = ["approveRelease", "activateFinance", "unpause", "pause", "deactivateFinance", "_requireApproved",
                "_interrupt", "setParameters", "_validateParameters", "requireUncontestedSettlement",
                "requireGovernanceAuthority", "requireArbitrator", "reportRoleDrift", "currentRoleState", "_walletState",
                "_boundedWalletRead", "roleFingerprint", "_disjoint", "bindFactory", "releaseDigest"]
    for name in controls:
        assert body(old_config, name) == body(config, name), f"Protected release/control policy changed: {name}"
    files = git("ls-files", "--", *PROTECTED).splitlines()
    hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files}
    cfg = json.loads(subprocess.check_output(["forge", "config", "--json"], cwd=ROOT / "contracts", text=True))
    safe_cfg = {k: cfg[k] for k in ["solc", "evm_version", "optimizer", "optimizer_runs", "via_ir", "bytecode_hash",
                                  "additional_compiler_profiles", "compilation_restrictions"] if k in cfg}
    safe_cfg["fuzz"] = {k: cfg["fuzz"][k] for k in ["runs", "seed"]}
    safe_cfg["invariant"] = {k: cfg["invariant"][k] for k in ["runs", "depth", "fail_on_revert"]}
    versions = {t: subprocess.check_output([t, "--version"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip()
                for t in ["forge", "solc", "slither", "node", "npm"]}
    artifacts = json.loads((ROOT / "docs/testing/p0-3/artifact-check.json").read_text())
    baseline = json.loads((ROOT / "docs/testing/p0-3/baseline-artifact-check.json").read_text())
    old_legacy = next(x for x in baseline["contracts"] if x["name"] == "QiePredictionMarket")
    legacy = next(x for x in artifacts["contracts"] if x["name"] == "QiePredictionMarket")
    assert legacy["runtimeTemplateKeccak256"] == old_legacy["runtimeTemplateKeccak256"]
    package = json.loads((ROOT / "contracts/abi/orakl-v1-candidate/interface-manifest.json").read_text())
    assert package["status"] == "CANDIDATE_NOT_FROZEN" and package["protocolRevision"] == "P0.3"
    assert package["financialActivationAuthorized"] is False and package["productionAddresses"] is None
    report = {"status": "PASS", "baseline": BASE, "protected_refs": refs, "protected_file_count": len(files),
              "source_sha256": hashes, "modified_production_files": sorted(changed),
              "unchanged_A_N_assertions": invariants, "unchanged_release_control_functions": controls,
              "compiler_and_default_test_configuration": safe_cfg, "tool_versions": versions,
              "legacy_runtime_identity": "PASS", "candidate_status": package["status"],
              "scope": "offline; no private key/seed/environment secret reads, RPC, signing or financial activation"}
    output = ROOT / "docs/testing/p0-3/preservation.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"PASS:{len(files)} protected files,4 refs,14 unchanged A-N assertions,20 unchanged release/control policies; legacy runtime exact")


if __name__ == "__main__":
    main()
