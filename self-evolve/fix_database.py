"""Pattern → fix mapping.

Encodes 8 successful + 15 failed iterations from session.
"""


# pattern_name → list of candidate fixes (each: name, description, status)
FIX_DATABASE = {
    "crashed-by-bullet": [
        {
            "name": "v5-bullet-horizon",
            "desc": "Expand bulletThreatensSoon horizon to 6 steps (bullets travel 2/frame).",
            "status": "success",
            "trigger": "Default fix when crashed losses dominate."
        },
        {
            "name": "v6-aimed-close-sidestep",
            "desc": "Detect enemyAimedAtMeClose and sidestep instead of turning to fire.",
            "status": "success",
            "trigger": "Loss replay shows opponent already aimed when we attempted fire."
        },
        {
            "name": "v7-180-double-turn",
            "desc": "Queue two right-turns for 180° rotation, rank perp dirs by turn cost.",
            "status": "success",
            "trigger": "Sidestep selected opposite direction but went the wrong way."
        },
    ],
    "crashed-mutual-runTime": [
        {
            "name": "v24-bfs-budget-map-aware",
            "desc": "Lower BFS maxNodes on small maps (≤200 tiles → 150 nodes).",
            "status": "success",
            "trigger": "Many crashed-mutual-runTime losses; reduces our runtime."
        },
        {
            "name": "v26-hybrid-bfs",
            "desc": "Combine v24 small-map handling with mapSize/1.5 for medium/large maps.",
            "status": "success",
            "trigger": "When v24 in place, generalizes the gain to bigger maps."
        },
    ],
    "lost-star-race": [
        {
            "name": "v9-bfs-avoid-aimed-los",
            "desc": "Skip first step into a tile in enemy's aimed LOS.",
            "status": "success",
            "trigger": "Star losses with crashes show we walked through enemy gun line."
        },
        {
            "name": "structural-skill-mismatch",
            "desc": "Overload can't out-race teleport/boost users.",
            "status": "structural",
            "trigger": "Lost-star-race against teleport/boost; need skill change."
        },
    ],
    "cloak-ambush": [
        {
            "name": "v13-cloak-sidestep",
            "desc": "When enemy goes visible→invisible, force perpendicular step.",
            "status": "failed",
            "reason": "Trigger too narrow, cloak users still won (3W/4L stress)."
        },
        {
            "name": "v16-lane-memory",
            "desc": "Track enemy last position, avoid lane for 6 frames after cloak.",
            "status": "failed",
            "reason": "5W/4L sample then 0W/7L stress (variance disaster)."
        },
    ],
    "teleport-star-steal": [
        {
            "name": "structural-skill-disadvantage",
            "desc": "Teleport tanks reach stars in 1 frame; Overload cannot.",
            "status": "structural",
            "trigger": "Always loses. Only fixable by switching to teleport skill."
        },
    ],
    "freeze-then-shot": [
        {
            "name": "v14-standalone-defense",
            "desc": "Sidestep when enemy is aimed even when we can't fire.",
            "status": "failed",
            "reason": "Over-defensive in pursuit phase (1W/2L)."
        },
    ],
    "off-axis-fire-opportunity": [
        {
            "name": "v10-overload-offset-shot",
            "desc": "When enemy 1 tile off perpendicular and ≥3 distance, overload+fire.",
            "status": "success",
            "trigger": "After firing logic in place; mimics top-tier overload patterns."
        },
    ],
    "fire-trade-bullet-waste": [
        {
            "name": "v8-skip-overload-aligned",
            "desc": "Skip overload when aligned + enemy can fire back; just fire.",
            "status": "success",
            "trigger": "Mutual aligned fire situations where overload primed lost the frame race."
        },
    ],
}


# Known failed approaches (don't reattempt)
KNOWN_FAILED = {
    "v3": "Full rewrite — 2W/8L disaster, too many changes at once",
    "v11": "Random path juke — hurts star race speed",
    "v12": "Grass-preferring sidestep — longer detour paths",
    "v17": "Linear predictive firing — prediction error too high",
    "v18": "Pure defensive (no fire) — no pressure, enemies aim leisurely",
    "v19": "Anti-camp detection — triggers too rarely",
    "v20": "findFirePosition — heavy LOS scan, 30% runtime increase",
    "v21": "Mound-breaking shot — wastes bullet slot for 1-frame cooldown",
    "v25": "Blanket mapSize/1.5 — too aggressive on small maps",
    "v27": "Chain turn+fire same onIdle — sim 9/9 but real 0/4, sim mislead",
}


def candidates_for(pattern):
    """Return non-failed candidates for a pattern."""
    return [f for f in FIX_DATABASE.get(pattern, []) if f["status"] == "success"]


def is_failed_pattern(pattern_name):
    """Skip patterns whose all known fixes have failed."""
    fixes = FIX_DATABASE.get(pattern_name, [])
    if not fixes:
        return False
    return all(f["status"] in ("failed", "structural") for f in fixes)
