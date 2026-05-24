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

  // v21: mound-breaking — if aligned with enemy but path blocked by exactly 1 mound,
  //      fire to destroy the mound (next shot will reach). Only do this if no immediate threats.
  if (enemyTank && canFireNow(me) && !enemyBullet) {
    var moundInfo = singleMoundBlock(myPos, enemyTank.position, map);
    if (moundInfo) {
      var aimDir = directionTo(myPos, enemyTank.position);
      if (myDir === aimDir) {
        me.fire(); // destroys mound on path
        return;
      }
      // turn toward enemy (next frame we may be aligned and able to fire-break)
      if (!enemyAimedAtMeClose(myPos, enemyTank, map)) {
        me.turn(turnDirection(myDir, aimDir));
        return;
      }
    }
  }

  // v20: explicit state — prioritize fire-position over star vs pursue
  // 1. if star exists and we are closer or equidistant, COLLECT mode
  // 2. else HUNT mode: aim for a tile that has clear LOS to enemy (firing position)
  // 3. fallback: pursue enemy directly
  var target = null;
  if (game.star && enemyTank && enemyTank.position) {
    var myStarDist = manhattan(myPos, game.star);
    var enemyStarDist = manhattan(enemyTank.position, game.star);
    if (myStarDist <= enemyStarDist) {
      target = game.star;
    } else {
      // enemy is closer to star — go for fire position instead
      target = findFirePosition(myPos, enemyTank.position, map) || enemyTank.position;
    }
  } else if (game.star) {
    target = game.star;
  } else if (enemyTank && enemyTank.position) {
    target = findFirePosition(myPos, enemyTank.position, map) || enemyTank.position;
  }

  // v9: try BFS avoiding enemy aimed-LOS tiles first; fall back if blocked
  var next = target && nextStep(myPos, target, map, enemyTank, enemy, true);
  if (!next && target) next = nextStep(myPos, target, map, enemyTank, enemy, false);
  if (next) {
    moveToward(me, myDir, myPos, next);
    return;
  }

  patrol(me, myDir, myPos, map);
}

function singleMoundBlock(myPos, enemyPos, map) {
  // returns true if the row/col path between us has EXACTLY 1 mound and nothing else blocking
  if (myPos[0] !== enemyPos[0] && myPos[1] !== enemyPos[1]) return false;
  var step;
  if (myPos[0] === enemyPos[0]) {
    step = [0, enemyPos[1] > myPos[1] ? 1 : -1];
  } else {
    step = [enemyPos[0] > myPos[0] ? 1 : -1, 0];
  }
  var pos = [myPos[0] + step[0], myPos[1] + step[1]];
  var mounds = 0;
  var safety = 0;
  while ((pos[0] !== enemyPos[0] || pos[1] !== enemyPos[1]) && safety++ < 30) {
    var t = map[pos[0]] && map[pos[0]][pos[1]];
    if (!t || t === "x") return false; // wall or out of map — can't break through
    if (t === "m") {
      mounds++;
      if (mounds > 1) return false; // more than 1 mound — can't break through with single shot
    }
    pos = [pos[0] + step[0], pos[1] + step[1]];
  }
  return mounds === 1;
}

function manhattan(a, b) {
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]);
}

function findFirePosition(myPos, enemyPos, map) {
  // find the nearest tile on enemy's row or column that has clear LOS to enemy
  // returns position to move to in order to get a shot
  if (!enemyPos) return null;
  var ex = enemyPos[0], ey = enemyPos[1];
  var best = null, bestDist = Infinity;
  // same column candidates
  for (var dy = -10; dy <= 10; dy++) {
    if (dy === 0) continue;
    var p = [ex, ey + dy];
    if (p[1] < 1 || !map[p[0]] || !map[p[0]][p[1]]) continue;
    var t = map[p[0]][p[1]];
    if (t === "x" || t === "m") continue;
    if (!losClear(p, enemyPos, map)) continue;
    var d = manhattan(myPos, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  // same row candidates
  for (var dx = -10; dx <= 10; dx++) {
    if (dx === 0) continue;
    var p = [ex + dx, ey];
    if (p[0] < 1 || !map[p[0]] || !map[p[0]][p[1]]) continue;
    var t = map[p[0]][p[1]];
    if (t === "x" || t === "m") continue;
    if (!losClear(p, enemyPos, map)) continue;
    var d = manhattan(myPos, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function losClear(a, b, map) {
  // check clear bullet path from a to b along their shared row/col
  if (a[0] === b[0]) {
    var step = b[1] > a[1] ? 1 : -1;
    var y = a[1] + step;
    while (y !== b[1]) {
      var t = map[a[0]] && map[a[0]][y];
      if (!t || t === "x" || t === "m") return false;
      y += step;
    }
    return true;
  }
  if (a[1] === b[1]) {
    var step = b[0] > a[0] ? 1 : -1;
    var x = a[0] + step;
    while (x !== b[0]) {
      var t = map[x] && map[x][a[1]];
      if (!t || t === "x" || t === "m") return false;
      x += step;
    }
    return true;
  }
  return false;
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
  var maxNodes = 400;

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
