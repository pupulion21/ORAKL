#!/usr/bin/env python3
"""Allowlisted offline P0.3 verification, using the existing exact-output recorder. No signing/RPC/broadcast."""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True

path = Path(__file__).resolve().with_name("verify-orakl-p0-2.py")
spec = importlib.util.spec_from_file_location("orakl_verification_recorder", path)
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)
recorder.__doc__ = __doc__
recorder.EVIDENCE = recorder.ROOT / "docs/testing/p0-3"
recorder.STEPS = {name: (cwd, [arg.replace("p0-2/", "p0-3/") for arg in argv], overrides)
                  for name, (cwd, argv, overrides) in recorder.STEPS.items()}
recorder.STEPS.update({
    "baseline-build": ("contracts", ["forge", "build", "--force"], {}),
    "baseline-artifacts": (".", ["node", "scripts/check-orakl-artifacts.mjs",
                                  "docs/testing/p0-3/baseline-artifact-check.json"], {}),
    "baseline-pocs": ("contracts", ["forge", "test", "--match-path", "test/economics/P0_2Economics.t.sol",
                                   "--match-test", "test(FirstChallengerCapturesSlot|ArbitratorMayResolveImmediately|RestoredRoleViews)",
                                   "-vvvv"], {}),
    "regressions-before": ("contracts", ["forge", "test", "--match-path", "test/security/P0_3Regression.t.sol", "-vvv"], {}),
    "security": ("contracts", ["forge", "test", "--match-path", "test/security/*", "-vvv"], {}),
    "economics": ("contracts", ["forge", "test", "--match-path", "test/economics/*", "-vvv"], {}),
    "remediation": ("contracts", ["forge", "test", "--match-path", "test/remediation/*", "-vvv"], {}),
    "invariant": ("contracts", ["forge", "test", "--match-path", "test/invariant/*", "-vvv"], {}),
    "build": ("contracts", ["forge", "build", "--force"], {}),
    "sizes": ("contracts", ["forge", "build", "--sizes", "--skip", "test", "--skip", "script"], {}),
    "interface-export": (".", ["node", "scripts/export-orakl-candidate-interface.mjs", "--write"], {}),
    "preservation": (".", ["python3", "scripts/check-orakl-p0-3-preservation.py"], {}),
    "economic-model": (".", ["python3", "scripts/model-orakl-p0-3-economics.py", "--output",
                             "docs/testing/p0-3/economic-model.json"], {}),
})

if __name__ == "__main__":
    recorder.main()
