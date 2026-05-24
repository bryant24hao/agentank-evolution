"""Self-evolution main loop.

Usage:
  TANK_KEY=agtk_xxx python harness.py [--dry-run] [--interval=3600]

What it does each cycle:
1. Pull last 30 matches
2. Classify losses → top pattern
3. If pattern in known-failed → skip
4. Look up candidate fix; if no candidate → skip
5. Smoke sim 15 games → fail = log + skip
6. Publish candidate
7. Real 5-game cautious → fail = rollback
8. Real 30-game stress → fail = rollback
9. Persist new base + update knowledge.json
"""
import argparse
import json
import os
import sys
import time

from api import get_tank, get_matches, publish_with_retry
from classifier import aggregate_patterns
from fix_database import FIX_DATABASE, KNOWN_FAILED, candidates_for, is_failed_pattern
from validator import gate1_sim, gate2_real_cautious, gate3_stress


KNOWLEDGE_PATH = os.path.join(os.path.dirname(__file__), "knowledge.json")
FREEZE_PATH = os.path.join(os.path.dirname(__file__), "FREEZE")
VERSIONS_PATH = os.path.join(os.path.dirname(__file__), "..", "versions")


def load_knowledge():
    if os.path.exists(KNOWLEDGE_PATH):
        return json.load(open(KNOWLEDGE_PATH))
    return {"successful": [], "failed": [], "structural": []}


def save_knowledge(k):
    json.dump(k, open(KNOWLEDGE_PATH, "w"), indent=2, ensure_ascii=False)


def freeze_check():
    return os.path.exists(FREEZE_PATH)


def load_code(version):
    path = os.path.join(VERSIONS_PATH, f"agt-{version}.js")
    return open(path).read()


def cycle(key, dry_run=False):
    if freeze_check():
        print("FREEZE file present — skip cycle")
        return

    pre = get_tank(key)["tank"]
    print(f"\n=== Cycle start at score={pre['rankScore']} v{pre['codeVersion']} ===")
    my_id = pre["id"]

    # 1. Observe
    matches = get_matches(key, limit=30)["matches"]
    patterns = aggregate_patterns(matches, my_id)
    if not patterns:
        print("No losses → nothing to fix")
        return
    print(f"Loss patterns: {dict(patterns)}")

    # 2. Pick top non-failed pattern with candidates
    top_pattern = None
    cands = []
    for p, _ in patterns.most_common():
        if is_failed_pattern(p):
            print(f"  skip {p} (all fixes known-failed)")
            continue
        c = candidates_for(p)
        if c:
            top_pattern = p
            cands = c
            break
    if not top_pattern:
        print("No actionable pattern. Cycle ends.")
        return

    print(f"Top pattern: {top_pattern}, candidates: {[c['name'] for c in cands]}")

    knowledge = load_knowledge()
    if any(s["pattern"] == top_pattern for s in knowledge["successful"]):
        print(f"  pattern already addressed by previous successful fix — skip")
        return

    # 3. Try first candidate
    cand = cands[0]
    version_id = cand["name"].split("-")[0]  # e.g. "v5-bullet-horizon" -> "v5"
    try:
        code = load_code(version_id)
    except Exception as e:
        print(f"  cannot load {version_id}: {e}")
        return

    if dry_run:
        print(f"  DRY-RUN: would test candidate {cand['name']}")
        return

    # 4. Gate 1 - Sim
    print(f"  Gate 1 (sim 15)...")
    sw, st, sok = gate1_sim(key, code)
    print(f"    {sw}/{st} = {sw/max(1,st):.0%}, pass={sok}")
    if not sok:
        knowledge["failed"].append({
            "pattern": top_pattern, "candidate": cand["name"],
            "gate": 1, "result": f"{sw}/{st}"
        })
        save_knowledge(knowledge)
        return

    # 5. Publish + Gate 2 - Real cautious
    pre_ver = pre["codeVersion"]
    base_code = load_code(f"v{pre_ver}")  # for rollback later — may not exist

    print(f"  Publishing candidate...")
    publish_with_retry(key, code, f"self-evolve: {cand['name']} for {top_pattern}")
    time.sleep(2)

    print(f"  Gate 2 (real 5)...")
    cw, ct, cok = gate2_real_cautious(key, n=5)
    print(f"    {cw}/{ct}, pass={cok}")
    if not cok:
        # Rollback
        if base_code:
            print(f"  ROLLBACK to v{pre_ver}")
            publish_with_retry(key, base_code, f"rollback after {cand['name']} fail")
        knowledge["failed"].append({
            "pattern": top_pattern, "candidate": cand["name"],
            "gate": 2, "result": f"{cw}/{ct}"
        })
        save_knowledge(knowledge)
        return

    # 6. Gate 3 - Stress
    print(f"  Gate 3 (real 30)...")
    sw3, st3, sok3 = gate3_stress(key, n=30)
    print(f"    {sw3}/{st3} = {sw3/max(1,st3):.0%}, pass={sok3}")
    if not sok3:
        if base_code:
            print(f"  ROLLBACK to v{pre_ver}")
            publish_with_retry(key, base_code, f"rollback after {cand['name']} stress fail")
        knowledge["failed"].append({
            "pattern": top_pattern, "candidate": cand["name"],
            "gate": 3, "result": f"{sw3}/{st3}"
        })
        save_knowledge(knowledge)
        return

    # 7. Promote
    knowledge["successful"].append({
        "pattern": top_pattern, "candidate": cand["name"],
        "gate2": f"{cw}/{ct}", "gate3": f"{sw3}/{st3}"
    })
    save_knowledge(knowledge)
    print(f"  ✅ PROMOTED {cand['name']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--interval", type=int, default=0, help="Loop interval seconds (0 = run once)")
    args = ap.parse_args()

    key = os.environ.get("TANK_KEY")
    if not key:
        sys.exit("Set TANK_KEY env var")

    if args.interval == 0:
        cycle(key, dry_run=args.dry_run)
    else:
        while True:
            try:
                cycle(key, dry_run=args.dry_run)
            except KeyboardInterrupt:
                print("Interrupted")
                break
            except Exception as e:
                print(f"Cycle error: {e}")
            print(f"Sleep {args.interval}s ...")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
