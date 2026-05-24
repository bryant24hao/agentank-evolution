"""AgenTank Agent API client."""
import json
import os
import time
import urllib.request


BASE = "https://agentank.ai"


def _req(method, path, key, body=None, timeout=30):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "AgenTank-SelfEvolve/1.0 (Python; curl-compat)",
            "Accept": "application/json, */*",
        },
        data=data,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def get_tank(key):
    return _req("GET", "/api/agent/tank", key)


def get_matches(key, limit=30, offset=0):
    return _req("GET", f"/api/agent/tank/matches?limit={limit}&offset={offset}", key)


def get_match_replay(url_id, key=None, view="summary"):
    suffix = "" if view == "summary" else f"?view={view}"
    req = urllib.request.Request(
        f"{BASE}/api/matches/{url_id}/agent.json{suffix}",
        headers={"Authorization": f"Bearer {key}"} if key else {},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def simulate(key, code, opponent_id, map_id):
    return _req(
        "POST",
        "/api/agent/tank/simulate",
        key,
        {"code": code, "opponentId": opponent_id, "mapId": map_id},
    )


def publish_code(key, code, notes, submitted_by="Claude"):
    return _req(
        "POST",
        "/api/agent/tank/code",
        key,
        {"code": code, "notes": notes, "submittedBy": submitted_by},
    )


def challenge(key, map_id="random", opponent_tank_id=None):
    body = {"mapId": map_id}
    if opponent_tank_id:
        body["opponentTankId"] = opponent_tank_id
    else:
        body["randomOpponent"] = True
    return _req("POST", "/api/agent/tank/challenge", key, body)


def publish_with_retry(key, code, notes, max_attempts=5):
    """Publish handling Cloudflare 521 errors by checking version increment."""
    pre = get_tank(key)["tank"]["codeVersion"]
    for attempt in range(max_attempts):
        try:
            return publish_code(key, code, notes)
        except Exception:
            pass
        time.sleep(3)
        try:
            post = get_tank(key)["tank"]["codeVersion"]
            if post > pre:
                return {"ok": True, "version": post}
        except Exception:
            pass
    raise RuntimeError("publish failed after retries")


if __name__ == "__main__":
    key = os.environ.get("TANK_KEY")
    if not key:
        raise SystemExit("Set TANK_KEY env var")
    t = get_tank(key)["tank"]
    print(f"v{t['codeVersion']} {t['rankTier']}-{t['rankDivision']} score={t['rankScore']}")
