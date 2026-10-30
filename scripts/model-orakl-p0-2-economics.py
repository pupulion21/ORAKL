#!/usr/bin/env python3
"""Offline deterministic stress model. Candidate bond rules are NOT executable protocol policy."""
import argparse
from fractions import Fraction
import json
from pathlib import Path

UNIT = 10**18  # Scenario scale only; NOT verification of QIE Mainnet currency decimals.
OUTCOMES = ("YES", "NO", "INVALID")


def receipt(yes, no, own_yes, own_no, outcome, fee_bps=200):
    assert 0 <= own_yes <= yes and 0 <= own_no <= no
    winning = yes if outcome == "YES" else no
    if outcome == "INVALID" or winning == 0:
        return own_yes + own_no
    total = yes + no
    distributable = total - total * fee_bps // 10_000
    own = own_yes if outcome == "YES" else own_no
    return own * distributable // winning


def candidate_bonds(proposed, final, p, c, *, cancelled=False):
    """Completed neutral-final-INVALID option B, for evaluation only. Output original-owner receipts."""
    assert proposed in OUTCOMES and final in OUTCOMES and p >= 0 and c >= 0
    if cancelled or final == "INVALID":
        return p, c
    return (p + c, 0) if final == proposed else (0, p + c)


def rational(x):
    value = Fraction(x)
    return {"exact": str(value), "decimal": f"{float(value):.9f}"}


def model():
    p, c = 100 * UNIT, 50 * UNIT
    matrix = []
    for proposed in OUTCOMES:
        for final in OUTCOMES:
            pp, cc = candidate_bonds(proposed, final, p, c)
            assert pp + cc == p + c
            assert pp >= 0 and cc >= 0
            matrix.append({"proposed": proposed, "final": final,
                           "proposer_receipt_wei": str(pp), "challenger_receipt_wei": str(cc),
                           "coalition_principal_gain_wei": str(pp + cc - p - c)})
    for p0 in (0, 1, p):
        for c0 in (0, 1, c):
            for proposed in OUTCOMES:
                for final in OUTCOMES:
                    pp, cc = candidate_bonds(proposed, final, p0, c0)
                    assert pp + cc == p0 + c0
                    assert candidate_bonds(proposed, final, p0, c0, cancelled=True) == (p0, c0)
    # Independent, hand-computed oracles for rule ambiguities and tiny distributions.
    assert candidate_bonds("INVALID", "YES", 7, 3) == (0, 10)
    assert candidate_bonds("YES", "INVALID", 7, 3) == (7, 3)
    assert receipt(3, 4, 1, 0, "YES") == 2  # Smallest units: fee rounds to zero.
    assert receipt(0, 9, 0, 9, "YES") == 9
    assert receipt(1000 * UNIT, 0, 1000 * UNIT, 0, "YES") == 980 * UNIT
    scenarios = []
    for name, y, n, ay, an, truthful, attack in [
        ("tiny_false_winner", 999, 1, 0, 1, "YES", "NO"),
        ("large_losing_position_to_refund", 600, 400, 0, 400, "YES", "INVALID"),
        ("one_sided_fee_escape", 1000, 0, 1000, 0, "YES", "INVALID"),
        ("both_sides_hedged", 600, 400, 100, 200, "YES", "NO"),
        ("empty_winning_side", 0, 1000, 0, 1000, "YES", "INVALID"),
    ]:
        true_receipt = receipt(y * UNIT, n * UNIT, ay * UNIT, an * UNIT, truthful)
        attack_receipt = receipt(y * UNIT, n * UNIT, ay * UNIT, an * UNIT, attack)
        scenarios.append({"name": name, "yes": y, "no": n, "coalition_yes": ay, "coalition_no": an,
                          "truthful": truthful, "attack": attack, "truthful_receipt_wei": str(true_receipt),
                          "attack_receipt_wei": str(attack_receipt),
                          "incremental_gain_units": rational(Fraction(attack_receipt - true_receipt, UNIT))})
    assert scenarios[0]["incremental_gain_units"]["exact"] == "980"
    assert scenarios[1]["incremental_gain_units"]["exact"] == "400"
    assert scenarios[2]["incremental_gain_units"]["exact"] == "20"
    sensitivity = []
    for d in (Fraction(0), Fraction(1, 2), Fraction(9, 10), Fraction(19, 20), Fraction(99, 100)):
        required = None if d == 0 else rational(Fraction(98, 100) * (1 - d) / d)
        sensitivity.append({"assumed_detection": rational(d), "required_proposal_over_cap": required})
    return {
        "status": "UNAPPROVED_COUNTERFACTUAL_MODEL_NOT_ONCHAIN_POLICY",
        "assumptions": ["All values are synthetic native units; 1e18 is scenario scale, not network evidence.",
                        "Single coalition account per side; actual multiwallet floors can reduce receipts.",
                        "Detection probabilities are stress inputs, not measured or predicted performance.",
                        "Deterrence formula assumes independent challenger, truthful arbitration, no external hedges.",
                        "Gas, funding cost, bribery and external positions are excluded; they must be assessed separately.",
                        "Candidate rewards transfer bond principal only; coalition self-challenge gains no principal.",
                        "No size ratio secures dishonest arbitration or censorship of all independent monitors."],
        "candidate_matrix": matrix, "position_scenarios": scenarios, "detection_sensitivity": sensitivity,
        "challenge_binary_break_even_q": [{"challenge_over_proposal": rational(r), "q": rational(r / (1 + r))}
                                          for r in (Fraction(1, 2), Fraction(1))],
        "self_checks": "PASS: exact matrix conservation, all zero/nonzero principal pairs, cancellation neutrality, hand-computed cases",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = json.dumps(model(), indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
        print(f"Offline economic model self-checks PASS; {args.output}")
    else:
        print(result, end="")
