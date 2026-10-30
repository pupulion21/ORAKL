#!/usr/bin/env python3
"""Offline counterfactual policy/exposure model only. No approved economics, keys, RPC or transactions."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("p02_model", Path(__file__).with_name("model-orakl-p0-2-economics.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
U = base.UNIT  # Synthetic scale only; not verification of Mainnet currency properties.


def allocations(p, contributions, equal=False):
    total = sum(contributions)
    if not total:
        return list(contributions)
    # Candidate alternatives only. Each depositor separately claims own principal and floor share of P.
    result = [c + (p // len(contributions) if equal else p * c // total) for c in contributions]
    assert sum(result) <= p + total
    return result


def model():
    cases = []
    checked = 0
    for proposed in base.OUTCOMES:
        for final in base.OUTCOMES:
            p, c, k = 2 * U, 3 * U, 5 * U
            pp, cc = base.candidate_bonds(proposed, final, p, c)
            cases.append({"proposed": proposed, "final": final, "creation_owner_wei": str(k),
                          "current_proposer_wei": str(p), "current_challenger_wei": str(c),
                          "candidate_proposer_wei": str(pp), "candidate_challenger_wei": str(cc),
                          "candidate_coalition_net_principal_gain_wei": str(pp + cc - p - c)})
            for p, c in [(0, 0), (0, 3 * U), (2 * U, 0), (2 * U, 3 * U)]:
                for yes, no in [(600 * U, 400 * U), (1000 * U, 0), (0, 1000 * U), (0, 0)]:
                    pp, cc = base.candidate_bonds(proposed, final, p, c)
                    assert k + pp + cc == k + p + c and min(pp, cc) >= 0
                    assert pp + cc - p - c == 0  # Coalition owns proposer and first challenger.
                    winning = yes if final == "YES" else no
                    refundable = final == "INVALID" or winning == 0
                    fee = 0 if refundable else (yes + no) * 200 // 10_000
                    assert not refundable or fee == 0
                    receipts = base.receipt(yes, no, yes, no, final)
                    assert receipts == yes + no - fee
                    assert base.candidate_bonds(proposed, final, p, c, cancelled=True) == (p, c)
                    checked += 1
    p = 100 * U
    proportional = allocations(p, [10 * U, 90 * U])
    equal = allocations(p, [10 * U] * 10, equal=True)
    assert proportional[0] - 10 * U == 10 * U
    assert equal[0] - 10 * U == 10 * U
    # Zero/very small reward pools, arbitrary counts and claim rounding never mint subsidy.
    for reward in [0, 1, 2, p]:
        for n in range(1, 33):
            for equal_mode in [False, True]:
                result = allocations(reward, [1] * n, equal=equal_mode)
                assert sum(result) <= reward + n
    exposure = []
    unresolved = participant = fees = 0
    bonds = 20 * U
    def record(action):
        exposure.append({"action": action, "unresolved_prediction_exposure_wei": str(unresolved),
                         "participant_liability_wei": str(participant), "fee_liability_wei": str(fees),
                         "bond_liability_wei": str(bonds), "note": "proposed aggregate ledger is NOT implemented"})
    unresolved += 10 * U; participant += 10 * U; record("predict A:10")
    unresolved += 20 * U; participant += 20 * U; record("predict B:20")
    unresolved -= 10 * U; participant -= U // 5; fees += U // 5; record("A valid terminal settlement, fee0.2; no participant claim yet")
    assert unresolved == 20 * U and participant == 298 * U // 10
    participant -= 98 * U // 10; record("A winner claims9.8; exposure unchanged")
    record("B timeout reached but cancellation tx not executed; conservative exposure retained")
    unresolved -= 20 * U; record("B emergency/timeout cancellation executed; full refund allocated, not yet claimed")
    assert unresolved == 0 and participant == 20 * U
    participant -= 20 * U; record("B participant claims20; exposure stays0")
    assert unresolved == 0 and participant == 0 and fees == U // 5 and bonds == 20 * U
    return {
        "status": "UNAPPROVED_COUNTERFACTUAL_ONLY_FULL_RETURN_SOLIDITY_PRESERVED",
        "matrix": cases, "exhaustive_outcome_bond_pool_cases_checked": checked,
        "cases_include": ["all9 proposed/final outcomes", "zero/positive P/C", "both/one/no funded sides",
                          "binary zero-winner refund", "INVALID", "timeout/emergency full returns", "coalition conservation"],
        "multiple_challenger_designs": {
            "proportional_stake": {"P": str(p), "honest_C": str(10 * U), "coalition_C": str(90 * U),
                                   "honest_reward": str(proportional[0] - 10 * U), "claim_accounting": "O(1)"},
            "fixed_equal_tranches": {"P": str(p), "tranche_C": str(10 * U), "tranches": 10,
                                     "coalition_tranches": 9, "honest_reward": str(equal[0] - 10 * U), "claim_accounting": "O(1)"},
            "limit": "both permit Sybil dilution/collusion; no original researcher priority or economic security proof",
        },
        "proposed_exposure_schedule": exposure,
        "external_incentive_stress": {"pool": "1000 synthetic units", "external_payoff": "10000 synthetic units",
                                      "limit": "on-chain caps/bonds do not bound off-chain hedges, bribes or political/reputational gain"},
        "inherited_position_sensitivity_model": base.model(),
        "self_checks": "PASS; these simulations do not prove truthful arbitration or economic security",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model(), indent=2) + "\n")
    print(f"Counterfactual model PASS:144 outcome/bond/pool cases, candidate allocations, exposure/liability separation; {args.output}")
