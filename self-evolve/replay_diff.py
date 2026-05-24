"""Zero-cost test: run candidate code against past loss replays.

Loads replay frame data, reconstructs (me, enemy, game) state per frame,
runs candidate's onIdle via Node.js subprocess, and compares actions
to the historic version's actions at the same frame.

If candidate diverges at the death frame in a way that avoids the death,
we have evidence the candidate fixes that specific loss pattern.

Limits:
- Cannot simulate opponent reaction to our change.
- Validates only "would we make different decision at frame F".
"""
import json
import os
import subprocess
import sys
import tempfile

import urllib.request


def fetch_raw_replay(match_url_id, tank_key):
    """Pull frame-by-frame raw replay (heavy)."""
    req = urllib.request.Request(
        f"https://agentank.ai/api/matches/{match_url_id}/agent.json?view=raw",
        headers={
            "Authorization": f"Bearer {tank_key}",
            "User-Agent": "AgenTank-ReplayDiff/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def reconstruct_state_at_frame(replay, frame_n, my_id):
    """Build (me, enemy, game) approximately as engine would pass to onIdle.
    Returns dict suitable for JSON dump to Node.
    """
    rep = replay["replayData"]["replay"]
    meta = rep["meta"]
    records = rep["records"]
    map_data = replay["replayData"]["map"]["map"]

    # Identify players
    players = meta["players"]
    # I'm player whose ID matches; opponent is the other
    me_player = next((p for p in players if p["tank"]["id"] in (str(my_id), my_id) or True), players[0])  # heuristic
    # Actually compare by ownerUserId via participants:
    parts = replay.get("participants", {})
    is_challenger = parts.get("challenger", {}).get("tankId") == my_id
    me_idx = 0 if is_challenger else 1
    op_idx = 1 - me_idx

    me_init = players[me_idx]["tank"]
    op_init = players[op_idx]["tank"]

    # Replay actions to derive positions at frame_n
    me_pos = me_init["position"][:]
    me_dir = me_init["direction"]
    op_pos = op_init["position"][:]
    op_dir = op_init["direction"]
    me_obj_id = me_init["id"]
    op_obj_id = op_init["id"]

    DELTA = {"up": [0, -1], "right": [1, 0], "down": [0, 1], "left": [-1, 0]}
    TURN_CW = {"up": "right", "right": "down", "down": "left", "left": "up"}
    TURN_CCW = {"up": "left", "left": "down", "down": "right", "right": "up"}

    for i in range(min(frame_n, len(records))):
        for e in records[i]:
            if e.get("type") != "tank":
                continue
            obj = e.get("objectId")
            act = e.get("action")
            if obj == me_obj_id:
                if act == "go":
                    pos = e.get("position")
                    if pos:
                        me_pos = pos[:]
                elif act == "turn":
                    d = e.get("direction")
                    if d == "right":
                        me_dir = TURN_CW[me_dir]
                    elif d == "left":
                        me_dir = TURN_CCW[me_dir]
            elif obj == op_obj_id:
                if act == "go":
                    pos = e.get("position")
                    if pos:
                        op_pos = pos[:]
                elif act == "turn":
                    d = e.get("direction")
                    if d == "right":
                        op_dir = TURN_CW[op_dir]
                    elif d == "left":
                        op_dir = TURN_CCW[op_dir]

    return {
        "me": {
            "tank": {"id": me_obj_id, "position": me_pos, "direction": me_dir, "crashed": False},
            "stars": 0, "bullet": None,
            "skill": {"type": "overload", "remainingCooldownFrames": 0, "activeRemainingFrames": 0},
            "status": {"fireLocked": False, "overloaded": False},
        },
        "enemy": {
            "tank": {"id": op_obj_id, "position": op_pos, "direction": op_dir},
            "bullet": None,
            "skill": {"type": "overload", "remainingCooldownFrames": 0},
            "status": {},
        },
        "game": {"map": map_data, "star": None, "frames": frame_n},
    }


NODE_TEMPLATE = """
{code}

var actions = [];
var me = {state}.me;
var enemy = {state}.enemy;
var game = {state}.game;

me.tank.position = me.tank.position;  // ensure array
me.go = function(n) {{ actions.push(['go', n||1]); }};
me.turn = function(d) {{ actions.push(['turn', d]); }};
me.fire = function() {{ actions.push(['fire']); }};
me.overload = function() {{ actions.push(['overload']); }};

onIdle(me, enemy, game);
console.log(JSON.stringify(actions));
"""


def run_candidate_onidle(code, state):
    """Run candidate's onIdle against state via Node, return action list."""
    script = NODE_TEMPLATE.format(code=code, state=json.dumps(state))
    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False) as f:
        f.write(script)
        tmp = f.name
    try:
        r = subprocess.run(["node", tmp], capture_output=True, text=True, timeout=5)
        if r.returncode != 0:
            return {"error": r.stderr[:500]}
        try:
            return json.loads(r.stdout.strip().split("\n")[-1])
        except Exception as e:
            return {"error": f"parse {e}: {r.stdout[:200]}"}
    finally:
        os.unlink(tmp)


def get_my_action_at_frame(replay, frame_n, my_obj_id):
    """What did the live version do at frame_n?"""
    rep = replay["replayData"]["replay"]
    records = rep["records"]
    if frame_n >= len(records):
        return None
    for e in records[frame_n]:
        if e.get("type") == "tank" and e.get("objectId") == my_obj_id:
            act = e.get("action")
            if act == "go":
                return ["go", 1]
            elif act == "turn":
                return ["turn", e.get("direction")]
    return None


def compare_at_death(match_url_id, my_id, candidate_code, tank_key, window=3):
    """For a loss, compare candidate vs actual decisions in last N frames."""
    replay = fetch_raw_replay(match_url_id, tank_key)
    rep = replay["replayData"]["replay"]
    records = rep["records"]
    parts = replay["participants"]
    is_challenger = parts["challenger"]["tankId"] == my_id
    me_obj_id = rep["meta"]["players"][0 if is_challenger else 1]["tank"]["id"]

    total = len(records)
    print(f"Match {match_url_id}: {total} frames")
    print(f"My ID {me_obj_id}, isChallenger={is_challenger}")

    for f_off in range(window, 0, -1):
        f = total - f_off
        state = reconstruct_state_at_frame(replay, f, my_id)
        actual = get_my_action_at_frame(replay, f, me_obj_id)
        cand = run_candidate_onidle(candidate_code, state)
        same = actual == cand[0] if isinstance(cand, list) and cand else False
        print(f"  frame {f}: me@{state['me']['tank']['position']} dir={state['me']['tank']['direction']} | actual={actual} | candidate={cand} | {'SAME' if same else 'DIFF'}")


if __name__ == "__main__":
    import os
    key = os.environ.get("TANK_KEY")
    if not key:
        sys.exit("Set TANK_KEY")
    if len(sys.argv) < 3:
        sys.exit("usage: replay_diff.py <match_url_id> <code_path>")
    match_url = sys.argv[1]
    code = open(sys.argv[2]).read()
    # my tank id 2184
    compare_at_death(match_url, 2184, code, key)
