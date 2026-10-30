#!/usr/bin/env python3
"""Counterfactual integer economic checks; no network, production policy, or chain write."""
from fractions import Fraction
import json

OUTCOMES = ("YES", "NO", "INVALID")


def allocation(proposed, final, p, c):
    if final == "INVALID":
        return p, c
    if final == proposed:
        return p + c, 0
    return 0, p + c


def proportional_claims(p, stakes):
    total = sum(stakes)
    return [s + p * s // total for s in stakes] if total else []


def main():
    rows = []
    for proposal in OUTCOMES:
        for decision in OUTCOMES:
            for p in (0, 1, 101):
                for c in (0, 1, 103):
                    proposer, challenger = allocation(proposal, decision, p, c)
                    assert proposer + challenger == p + c
                    rows.append({"proposal": proposal, "decision": decision, "P": p, "C": c,
                                 "proposer": proposer, "challenger": challenger})
    split_cases = []
    for p in (0, 1, 7, 100):
        for honest in (1, 7):
            for coalition in (1, 9, 100):
                single = proportional_claims(p, [honest, coalition])
                split = proportional_claims(p, [honest] + [1] * coalition)
                assert sum(single) <= p + honest + coalition
                assert sum(split) <= p + honest + coalition
                # Fixed coalition principal cannot gain from splitting when all terms are floored.
                assert sum(split[1:]) <= single[1]
                split_cases.append({"P": p, "honest_stake": honest, "coalition_stake": coalition,
                                    "unsplit_reward": single[1] - coalition,
                                    "split_reward": sum(split[1:]) - coalition})
    # Expected challenger gross reward q*P minus false-decision exposure (1-q)*C;
    # q is the probability of a successful binary reversal, a scenario assumption.
    scenarios = []
    for q in (Fraction(0), Fraction(1, 100), Fraction(1, 2), Fraction(1)):
        for p, c in ((5, 5), (20, 10), (20, 20)):
            ev = q * p - (1 - q) * c
            scenarios.append({"q_assumed": str(q), "P": p, "C": c,
                              "gross_expected_return_excluding_gas_and_cost": str(ev)})
    result = {
        "status": "COUNTERFACTUAL_UNAPPROVED_NOT_ECONOMIC_SECURITY_PROOF",
        "unit": "hypothetical indivisible native units; no Mainnet denomination claim",
        "matrix_checks": len(rows), "matrix": rows,
        "proportional_split_checks": len(split_cases), "proportional_splitting": split_cases,
        "challenger_ev_assumptions": "Binary reward P on reversal; loss C on upheld decision. INVALID, timeout, external incentives, time value, opportunity cost and gas excluded.",
        "challenger_ev_scenarios": scenarios,
        "limitation": "A coalition can increase total stake to dilute an honest challenger; arbitrary external incentives and biased arbitration are unbounded by this model.",
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
