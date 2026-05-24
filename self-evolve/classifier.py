"""Classify match losses into pattern labels.

Patterns we learned to recognize this session:
- "crashed-by-bullet": opponent's bullet hit us
- "crashed-mutual-runTime": both died same frame, runtime tiebreaker we lost
- "lost-star-race": opponent reached more stars
- "cloak-ambush": opponent used cloak then killed
- "teleport-star-steal": opponent teleported to grab star
- "snipe-from-camp": opponent stationary 3+ frames, killed us on alignment
"""
from collections import Counter


def classify_match(match, my_id):
    """Returns pattern label or None if won/drew."""
    winner = match.get("winnerTankId")
    if winner == my_id or winner is None:
        return None

    reason = match.get("resultReason", "?")
    if reason == "runTime":
        return "crashed-mutual-runTime"
    if reason == "star":
        return "lost-star-race"
    if reason == "crashed":
        return "crashed-by-bullet"
    return f"unknown-{reason}"


def classify_with_replay(match_url_id, my_id, get_replay_fn):
    """Deeper classification using event stream — detect cloak/teleport patterns."""
    try:
        d = get_replay_fn(match_url_id, view="events")
    except Exception:
        return "unknown-replay-error"

    events = d.get("events", [])
    my_name = next(
        (n for n in d["summary"]["tanks"] if d["participants"]["challenger"]["tankId"] == my_id
         or d["participants"]["defender"]["tankId"] == my_id),
        None,
    )

    opp_skills = [
        e["skill"]
        for e in events
        if e.get("event") == "skill_cast" and e.get("tank") != my_name
    ]

    if "cloak" in opp_skills:
        return "cloak-ambush"
    if "teleport" in opp_skills:
        return "teleport-star-steal"
    if "freeze" in opp_skills:
        return "freeze-then-shot"
    if "poison" in opp_skills:
        return "poison-attrition"

    return classify_match(d.get("match", {}), my_id) or "crashed-by-bullet"


def aggregate_patterns(matches, my_id):
    """Count patterns from a list of match summaries."""
    patterns = []
    for m in matches:
        p = classify_match(m, my_id)
        if p:
            patterns.append(p)
    return Counter(patterns)


if __name__ == "__main__":
    import os
    from api import get_tank, get_matches

    key = os.environ.get("TANK_KEY")
    if not key:
        raise SystemExit("Set TANK_KEY env var")
    my_id = get_tank(key)["tank"]["id"]
    ms = get_matches(key, limit=30)["matches"]
    counts = aggregate_patterns(ms, my_id)
    for p, c in counts.most_common():
        print(f"  {p}: {c}")
