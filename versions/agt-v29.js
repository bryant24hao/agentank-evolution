function onIdle(me, enemy, game) {
  var myPos = me.tank.position;
  var myDir = me.tank.direction;
  var enemyTank = enemy.tank;
  var enemyBullet = enemy.bullet;
  var map = game.map;

  if (enemyBullet && bulletThreatensSoon(enemyBullet, myPos, map, 6)) {
    if (sidestep(me, myDir, myPos, enemyBullet.direction, map)) return;
  }

  if (enemyTank && canFireNow(me) && canShoot(myPos, enemyTank.position, map)) {
    var aimDir = directionTo(myPos, enemyTank.position);
    if (myDir === aimDir) {
      tryOverload(me, enemy);
      me.fire();
      return;
    }
    // v6: if enemy is already aimed at us at close range, turning is a death trap — sidestep first
    if (enemyAimedAtMeClose(myPos, enemyTank, map)) {
      var dodgeBulletDir = directionTo(enemyTank.position, myPos);
      if (sidestep(me, myDir, myPos, dodgeBulletDir, map)) return;
    }
    me.turn(turnDirection(myDir, aimDir));
    return;
  }

  // v10: Overload off-by-1 shot — top overload tanks fire when enemy is 1 row/col off
  //      using Overload's parallel bullet to catch them on the offset axis
  if (enemyTank && canFireNow(me) && me.skill && me.skill.type === "overload"
      && me.skill.remainingCooldownFrames === 0
      && !(me.status && me.status.overloaded)) {
    var off = offsetShotDir(myPos, myDir, enemyTank.position, map);
    if (off) {
      me.overload();
      me.fire();
      return;
    }
  }

  var target = game.star || (enemyTank && enemyTank.position);
  var pursueStar = !!game.star;
  // v29: skip avoidLOS BFS when no useful enemy threat (saves ~30% runtime)
  //   - enemy invisible (cloak/grass): no aimed-LOS to avoid
  //   - enemy far away (>5 tiles): unlikely to threaten next step
  var useAvoidLOS = enemyTank && enemyTank.position
    && (Math.abs(enemyTank.position[0] - myPos[0]) + Math.abs(enemyTank.position[1] - myPos[1]) <= 5);
  // v9: try BFS avoiding enemy aimed-LOS tiles first (when useful)
  var next = target && nextStep(myPos, target, map, enemyTank, enemy, useAvoidLOS);
  // v28b: star pursuit → allow risky fallback (reward worth it)
  if (!next && target && pursueStar) {
    next = nextStep(myPos, target, map, enemyTank, enemy, false);
  }
  if (next) {
    moveToward(me, myDir, myPos, next);
    return;
  }
  // v28b: enemy chase + no safe path → sidestep perpendicular instead of patrol.
  // Keeps us moving and breaks alignment without suicide-walking into LOS.
  if (enemyTank && enemyTank.position && !pursueStar) {
    var dodgeDir = directionTo(enemyTank.position, myPos);
    if (sidestep(me, myDir, myPos, dodgeDir, map)) return;
  }

  patrol(me, myDir, myPos, map);
}

function offsetShotDir(myPos, myDir, enemyPos, map) {
  // Overload's parallel bullet appears on the tank's RIGHT side (CW 90° from facing).
  // For each facing direction, the offset axis and required sign is:
  //   up    → offset on +x (dx must be +1, dy must be on firing path)
  //   right → offset on +y (dy must be +1, dx on firing path)
  //   down  → offset on -x (dx must be -1)
  //   left  → offset on -y (dy must be -1)
  // Conditions: facing the correct firing direction, far enough on aim axis (≥3, ≤12),
  // and the bullet path along enemy's offset axis is clear.
  var dx = enemyPos[0] - myPos[0];
  var dy = enemyPos[1] - myPos[1];
  if (myDir === "up" && dx === 1 && dy <= -3 && dy >= -12) {
    return clearAlongY(enemyPos[0], myPos[1] - 1, enemyPos[1], -1, map);
  }
  if (myDir === "down" && dx === -1 && dy >= 3 && dy <= 12) {
    return clearAlongY(enemyPos[0], myPos[1] + 1, enemyPos[1], 1, map);
  }
  if (myDir === "right" && dy === 1 && dx >= 3 && dx <= 12) {
    return clearAlongX(enemyPos[1], myPos[0] + 1, enemyPos[0], 1, map);
  }
  if (myDir === "left" && dy === -1 && dx <= -3 && dx >= -12) {
    return clearAlongX(enemyPos[1], myPos[0] - 1, enemyPos[0], -1, map);
  }
  return false;
}

function clearAlongY(x, fromY, toY, step, map) {
  var y = fromY;
  while (y !== toY) {
    var t = map[x] && map[x][y];
    if (t === "x" || t === "m" || t === undefined) return false;
    y += step;
  }
  return true;
}

function clearAlongX(y, fromX, toX, step, map) {
  var x = fromX;
  while (x !== toX) {
    var t = map[x] && map[x][y];
    if (t === "x" || t === "m" || t === undefined) return false;
    x += step;
  }
  return true;
}

function enemyAimedAtMeClose(myPos, enemyTank, map) {
  if (!enemyTank || !enemyTank.position || !enemyTank.direction) return false;
  if (myPos[0] !== enemyTank.position[0] && myPos[1] !== enemyTank.position[1]) return false;
  var aimAtMe = directionTo(enemyTank.position, myPos);
  if (enemyTank.direction !== aimAtMe) return false;
  // distance check: close enough that bullet arrives in ≤2 frames (bullets are 2 tiles/frame)
  var dx = Math.abs(myPos[0] - enemyTank.position[0]);
  var dy = Math.abs(myPos[1] - enemyTank.position[1]);
  if (dx + dy > 5) return false;
  // clear shot from them to us
  var step = delta(aimAtMe);
  var pos = [enemyTank.position[0] + step[0], enemyTank.position[1] + step[1]];
  while (pos[0] !== myPos[0] || pos[1] !== myPos[1]) {
    if (!map[pos[0]] || map[pos[0]][pos[1]] === "x" || map[pos[0]][pos[1]] === "m") return false;
    pos = [pos[0] + step[0], pos[1] + step[1]];
  }
  return true;
}

function canFireNow(me) {
  if (me.bullet) return false;
  if (me.status && me.status.fireLocked) return false;
  return true;
}

function tryOverload(me, enemy) {
  if (!me.skill || me.skill.remainingCooldownFrames !== 0) return;
  if (me.status && me.status.overloaded) return;
  // v8: skip overload when enemy is aligned and can fire back this frame.
  // priming overload eats one frame and loses the race to the enemy's bullet.
  if (enemy && enemy.tank && enemy.tank.position && !enemy.bullet) {
    var ep = enemy.tank.position;
    var mp = me.tank.position;
    if (ep[0] === mp[0] || ep[1] === mp[1]) return;
  }
  if (typeof me.overload === "function") me.overload();
}

function bulletThreatensSoon(bullet, myPos, map, withinFrames) {
  if (!bullet || !bullet.position || !bullet.direction) return false;
  var step = delta(bullet.direction);
  var pos = bullet.position;
  for (var i = 0; i < withinFrames; i++) {
    pos = add(pos, step);
    if (samePos(pos, myPos)) return true;
    if (!isOpen(pos, map)) return false;
  }
  return false;
}

function sidestep(me, myDir, myPos, bulletDir, map) {
  var perps = (bulletDir === "up" || bulletDir === "down") ? ["left", "right"] : ["up", "down"];
  // v7: prefer lower-turn-cost escape (0° > 90° > 180°)
  function turnCost(d) {
    if (d === myDir) return 0;
    if (d === oppositeDir(myDir)) return 2;
    return 1;
  }
  perps.sort(function (a, b) { return turnCost(a) - turnCost(b); });
  for (var i = 0; i < perps.length; i++) {
    var d = perps[i];
    if (isOpen(add(myPos, delta(d)), map)) {
      if (myDir === d) { me.go(); }
      else if (myDir === oppositeDir(d)) {
        // 180° needs two turns; otherwise the queued go() heads the wrong way
        me.turn("right");
        me.turn("right");
        me.go();
      }
      else { me.turn(turnDirection(myDir, d)); me.go(); }
      return true;
    }
  }
  return false;
}

function oppositeDir(d) {
  if (d === "up") return "down";
  if (d === "down") return "up";
  if (d === "left") return "right";
  return "left";
}

function faceOrFire(me, currentDir, targetDir) {
  if (currentDir === targetDir) {
    me.fire();
  } else {
    me.turn(turnDirection(currentDir, targetDir));
  }
}

function moveToward(me, currentDir, from, to) {
  var dir = directionTo(from, to);
  if (currentDir === dir) {
    me.go();
  } else {
    me.turn(turnDirection(currentDir, dir));
  }
}

function patrol(me, currentDir, position, map) {
  var forward = add(position, delta(currentDir));
  if (isOpen(forward, map)) {
    me.go();
  } else {
    me.turn("right");
  }
}

function nextStep(start, goal, map, enemyTank, enemy, avoidLOS) {
  var queue = [{ pos: start, first: null }];
  var seen = {};
  seen[key(start)] = true;
  // v26: hybrid BFS budget
  //   small map (≤200, Star Cup public-map-6 etc): v24's 150 — safe + proven
  //   medium/large: mapSize/1.5 (random 285→190) — faster runtime for tiebreakers
  var mapSize = map.length * (map[0] ? map[0].length : 0);
  var maxNodes = mapSize <= 200 ? 150 : Math.max(180, Math.floor(mapSize / 1.5));

  for (var head = 0; head < queue.length && head < maxNodes; head++) {
    var item = queue[head];
    if (samePos(item.pos, goal)) return item.first;

    var dirs = ["up", "right", "down", "left"];
    for (var i = 0; i < dirs.length; i++) {
      var next = add(item.pos, delta(dirs[i]));
      var k = key(next);
      if (seen[k] || !isOpen(next, map)) continue;
      // v9: in safe mode, skip the immediate next tile if it's a fresh kill zone
      // (only checks our FIRST step — deeper path nodes are not pruned to avoid over-blocking)
      if (avoidLOS && item.first === null && stepIsKillZone(next, enemyTank, enemy, map, goal)) continue;
      seen[k] = true;
      queue.push({ pos: next, first: item.first || next });
    }
  }
  return null;
}

function stepIsKillZone(tile, enemyTank, enemy, map, goal) {
  // the goal itself is always allowed (we accept risk to reach it)
  if (goal && tile[0] === goal[0] && tile[1] === goal[1]) return false;
  if (!enemyTank || !enemyTank.position || !enemyTank.direction) return false;
  // enemy can't fire if their bullet is still in flight
  if (enemy && enemy.bullet) return false;
  if (enemy && enemy.status && (enemy.status.frozen || enemy.status.stunned)) return false;
  var ep = enemyTank.position;
  if (tile[0] !== ep[0] && tile[1] !== ep[1]) return false;
  // enemy must be aimed at this tile's row/column
  var aim = directionTo(ep, tile);
  if (enemyTank.direction !== aim) return false;
  // clear bullet path from enemy to tile
  var step = delta(aim);
  var p = [ep[0] + step[0], ep[1] + step[1]];
  while (p[0] !== tile[0] || p[1] !== tile[1]) {
    if (!map[p[0]] || map[p[0]][p[1]] === "x" || map[p[0]][p[1]] === "m") return false;
    p = [p[0] + step[0], p[1] + step[1]];
  }
  // only avoid if close enough that we can't out-dodge (distance ≤ 4 since bullets are 2/frame)
  var dist = Math.abs(tile[0] - ep[0]) + Math.abs(tile[1] - ep[1]);
  return dist <= 4;
}

function canShoot(a, b, map) {
  if (a[0] !== b[0] && a[1] !== b[1]) return false;
  var dir = directionTo(a, b);
  var step = delta(dir);
  var pos = add(a, step);
  for (var i = 0; i < 50 && !samePos(pos, b); i++) {
    if (!isOpen(pos, map)) return false;
    pos = add(pos, step);
  }
  return samePos(pos, b);
}

function isAligned(a, b) {
  return a && b && (a[0] === b[0] || a[1] === b[1]);
}

function directionTo(a, b) {
  if (b[0] > a[0]) return "right";
  if (b[0] < a[0]) return "left";
  if (b[1] > a[1]) return "down";
  return "up";
}

function turnDirection(currentDir, targetDir) {
  var dirs = ["up", "right", "down", "left"];
  var current = dirs.indexOf(currentDir);
  var target = dirs.indexOf(targetDir);
  if (current < 0 || target < 0) return "right";
  var diff = (target - current + 4) % 4;
  return diff === 3 ? "left" : "right";
}

function delta(dir) {
  if (dir === "up") return [0, -1];
  if (dir === "right") return [1, 0];
  if (dir === "down") return [0, 1];
  return [-1, 0];
}

function add(pos, d) {
  return [pos[0] + d[0], pos[1] + d[1]];
}

function isOpen(pos, map) {
  return map[pos[0]] && map[pos[0]][pos[1]] && map[pos[0]][pos[1]] !== "x" && map[pos[0]][pos[1]] !== "m";
}

function samePos(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function key(pos) {
  return pos[0] + "," + pos[1];
}
