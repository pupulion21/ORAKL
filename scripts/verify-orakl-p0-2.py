#!/usr/bin/env python3
"""Run an allowlisted OFFLINE P0.2 verification step; preserve stdout/stderr bytes and exit status."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "docs/testing/p0-2"
SOLC_ARGS = "--evm-version paris --metadata-hash none"
STEPS = {
    "build": ("contracts", ["forge", "build"], {}),
    "focused": ("contracts", ["forge", "test", "--match-path", "test/economics/*", "-vvv"], {}),
    "forge-test": ("contracts", ["forge", "test", "-vvv"], {}),
    "invariant-intensive": ("contracts", ["forge", "test", "--match-path", "test/invariant/*", "-vvv"],
                            {"FOUNDRY_INVARIANT_RUNS": "256", "FOUNDRY_INVARIANT_DEPTH": "128",
                             "FOUNDRY_FUZZ_SEED": "0x4f52414b4c503032"}),
    "coverage": ("contracts", ["forge", "coverage"], {}),
    "fmt": ("contracts", ["forge", "fmt", "--check"], {}),
    "slither": ("contracts", ["slither", ".", "--filter-paths", "test/|lib/|script/", "--json",
                              "../docs/testing/p0-2/slither.json"], {}),
    "slither-factory": ("contracts", ["slither", "src/MarketFactory.sol", "--compile-force-framework", "solc",
                                      "--solc-remaps", "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
                                      "--filter-paths", "lib/", "--solc-args", SOLC_ARGS + " --optimize --optimize-runs 50",
                                      "--json", "../docs/testing/p0-2/slither-factory.json"], {}),
    "slither-config": ("contracts", ["slither", "src/ProtocolConfig.sol", "--compile-force-framework", "solc",
                                     "--solc-remaps", "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
                                     "--filter-paths", "lib/", "--solc-args", SOLC_ARGS + " --optimize --optimize-runs 50",
                                     "--json", "../docs/testing/p0-2/slither-config.json"], {}),
    "slither-legacy": ("contracts", ["slither", "src/QiePredictionMarket.sol", "--compile-force-framework", "solc",
                                     "--solc-remaps", "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
                                     "--filter-paths", "lib/", "--solc-args", SOLC_ARGS,
                                     "--json", "../docs/testing/p0-2/slither-legacy.json"], {}),
    "build-final": ("contracts", ["forge", "build", "--force"], {}),
    "artifact-check": (".", ["node", "scripts/check-orakl-artifacts.mjs", "docs/testing/p0-2/artifact-check.json"], {}),
    "interface-check": (".", ["node", "scripts/export-orakl-candidate-interface.mjs", "--check"], {}),
    "interface-tests": (".", ["node", "--test", "scripts/test/orakl-candidate-interface.test.mjs"], {}),
    "economic-model": (".", ["python3", "scripts/model-orakl-p0-2-economics.py", "--output",
                             "docs/testing/p0-2/economic-model.json"], {}),
    "preservation": (".", ["python3", "scripts/check-orakl-p0-2-preservation.py"], {}),
    "frontend-test": (".", ["npm", "test"], {}),
    "frontend-typecheck": (".", ["npm", "run", "typecheck"], {}),
    "frontend-build": (".", ["npm", "run", "build"], {}),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=STEPS)
    parser.add_argument("--record-file", default="commands.json", help="Separate JSON basename for independent concurrent steps")
    args = parser.parse_args()
    cwd, argv, overrides = STEPS[args.step]
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    if Path(args.record_file).name != args.record_file or not args.record_file.endswith(".json"):
        raise SystemExit("record-file must be a JSON basename inside the evidence directory")
    records_path = EVIDENCE / args.record_file
    records = json.loads(records_path.read_text()) if records_path.exists() else []
    attempt = 1 + sum(r["step"] == args.step for r in records)
    # Never overwrite an earlier failure or analyzer JSON on repeated execution.
    if args.step.startswith("slither"):
        raw_json = EVIDENCE / (args.step + ".json")
        if raw_json.exists():
            raise SystemExit(f"Refusing to overwrite {raw_json}; retain and rename prior evidence explicitly")
    log = EVIDENCE / f"{args.step}-{attempt}.txt"
    if log.exists():
        raise SystemExit(f"Refusing to overwrite unregistered output {log}")
    start_utc = datetime.now(timezone.utc).isoformat()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    start = time.monotonic()
    print(f"Running {args.step}; exact combined output: {log.relative_to(ROOT)}", flush=True)
    env = dict(os.environ, **overrides, NO_COLOR="1")
    with log.open("wb") as output:
        result = subprocess.run(argv, cwd=ROOT / cwd, env=env, stdout=output, stderr=subprocess.STDOUT, check=False)
    record = {"step": args.step, "attempt": attempt, "argv": argv, "cwd": cwd, "explicit_env": overrides,
              "start_utc": start_utc, "elapsed_seconds": round(time.monotonic() - start, 3), "head_at_execution": head,
              "working_tree_may_include_reviewed_uncommitted_changes": True,
              "exit_code": result.returncode, "output": str(log.relative_to(ROOT)),
              "output_sha256": hashlib.sha256(log.read_bytes()).hexdigest()}
    records.append(record)
    records_path.write_text(json.dumps(records, indent=2) + "\n")
    print(json.dumps(record, indent=2), flush=True)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
