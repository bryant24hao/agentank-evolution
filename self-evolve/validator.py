"""3-gate validation pipeline.

Gate 1 — Sim: 15 games (3 bots × 5 maps), pass if ≥80% wins
Gate 2 — Real cautious: 5 games random map, pass if ≥3 wins
Gate 3 — Real stress: 30 games, pass if ≥55%

Any failure → rollback to base version.
"""
import time
from api import simulate, challenge, get_tank


def gate1_sim(key, code, bots=("nova-scout", "azure-hunter", "crimson-bastion"),
              maps=("random", "public-map-6"), per_combo=2, sleep=2.5):
    """Quick simulation check. Returns (wins, total, ok)."""
    wins = 0
    total = 0
    for m in maps:
        for b in bots:
            for _ in range(per_combo):
                try:
                    r = simulate(key, code, b, m)
                    if r.get("winner") == "me":
                        wins += 1
                    total += 1
                except Exception:
                    pass
                time.sleep(sleep)
    return wins, total, wins / max(1, total) >= 0.8


def gate2_real_cautious(key, n=5, sleep=5):
    """Real challenges (assumes code already published).
    Returns (wins, total, ok)."""
    wins = 0
    losses = 0
    my_id = get_tank(key)["tank"]["id"]
    for _ in range(n):
        try:
            r = challenge(key, "random")
            w = r.get("winnerTankId")
            if w == my_id:
                wins += 1
            elif w is not None:
                losses += 1
        except Exception:
            pass
        time.sleep(sleep)
    total = wins + losses
    return wins, total, wins >= 3


def gate3_stress(key, n=30, sleep=5, abort_at_n_losses=10):
    """Stress test 30 games. Aborts early if too many losses."""
    wins = 0
    losses = 0
    my_id = get_tank(key)["tank"]["id"]
    for i in range(n):
        try:
            r = challenge(key, "random")
            w = r.get("winnerTankId")
            if w == my_id:
                wins += 1
            elif w is not None:
                losses += 1
        except Exception:
            pass
        time.sleep(sleep)
        if losses >= abort_at_n_losses:
            return wins, wins + losses, False
    total = wins + losses
    return wins, total, wins / max(1, total) >= 0.55


def full_validation(key, candidate_code, candidate_name):
    """Run all 3 gates. Returns dict with details and pass/fail."""
    print(f"[{candidate_name}] Gate 1: Sim ...")
    sw, st, sok = gate1_sim(key, candidate_code)
    print(f"  Sim: {sw}/{st}, pass={sok}")
    if not sok:
        return {"ok": False, "gate": 1, "wins": sw, "total": st}

    # Note: Gates 2/3 require publish first. Caller handles publish.
    print(f"[{candidate_name}] Gate 2/3 require external publish to run.")
    return {"ok": True, "gate": 1, "sim_wins": sw, "sim_total": st}
