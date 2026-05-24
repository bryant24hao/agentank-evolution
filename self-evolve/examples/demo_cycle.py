"""Demo: a single self-evolution cycle in dry-run mode.

Usage:
  TANK_KEY=agtk_xxx python examples/demo_cycle.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import get_tank, get_matches
from classifier import aggregate_patterns
from fix_database import candidates_for, is_failed_pattern, FIX_DATABASE


def main():
    key = os.environ.get("TANK_KEY")
    if not key:
        sys.exit("Set TANK_KEY env var")

    pre = get_tank(key)["tank"]
    my_id = pre["id"]
    print(f"Current state:")
    print(f"  v{pre['codeVersion']} {pre['rankTier']}-{pre['rankDivision']} score={pre['rankScore']}")
    print()

    print("Pulling last 30 matches...")
    matches = get_matches(key, limit=30)["matches"]
    patterns = aggregate_patterns(matches, my_id)
    if not patterns:
        print("No losses recently → no diagnosis needed")
        return

    print(f"\nLoss patterns (last 30):")
    for p, c in patterns.most_common():
        marker = "  ⛔ all fixes failed" if is_failed_pattern(p) else ""
        cands = candidates_for(p)
        names = [f["name"] for f in cands]
        print(f"  {p}: {c}{marker}")
        if names:
            print(f"    candidate fixes: {names}")

    print()
    top_pattern = None
    for p, _ in patterns.most_common():
        if not is_failed_pattern(p):
            top_pattern = p
            break

    if top_pattern:
        cands = candidates_for(top_pattern)
        print(f"Top actionable pattern: {top_pattern}")
        for c in cands:
            print(f"  → {c['name']}: {c['desc']}")
    else:
        print("No actionable pattern. Either all addressed or structural.")


if __name__ == "__main__":
    main()
