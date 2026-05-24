function onIdle(me, enemy, game) {
  var myPos = me.tank.position;
  var myDir = me.tank.direction;
  var enemyTank = enemy.tank;
  var enemyBullet = enemy.bullet;
  var map = game.map;

  // v19: track enemy position for camp detection
  if (typeof __ehist === 'undefined') __ehist = [];
  if (enemyTank && enemyTank.position) {
    __ehist.push([enemyTank.position[0], enemyTank.position[1]]);
    if (__ehist.length > 5) __ehist.shift();
  }

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
  // v9: try BFS avoiding enemy aimed-LOS tiles first; fall back if blocked
  var next = target && nextStep(myPos, target, map, enemyTank, enemy, true);
  if (!next && target) next = nextStep(myPos, target, map, enemyTank, enemy, false);

  // v19: anti-camp — if enemy stationary in same row/col for ≥3 frames AND BFS would
  // step us onto their lane, sidestep instead
  if (next && enemyTank && enemyTank.position && isCamping()) {
    var ep = enemyTank.position;
    var nextOnLane = next[0] === ep[0] || next[1] === ep[1];
    var meOnLane = myPos[0] === ep[0] || myPos[1] === ep[1];
    if (nextOnLane && !meOnLane) {
      var perps = (myDir === "up" || myDir === "down") ? ["left", "right"] : ["up", "down"];
      for (var pi = 0; pi < perps.length; pi++) {
        var pd = perps[pi];
        var pp = [myPos[0] + delta(pd)[0], myPos[1] + delta(pd)[1]];
        if (isOpen(pp, map) && pp[0] !== ep[0] && pp[1] !== ep[1]) {
          if (myDir === pd) me.go();
          else { me.turn(turnDirection(myDir, pd)); me.go(); }
          return;
        }
      }
    }
  }

  if (next) {
    moveToward(me, myDir, myPos, next);
    return;
  }

  patrol(me, myDir, myPos, map);
}

function isCamping() {
  if (!__ehist || __ehist.length < 3) return false;
  var last3 = __ehist.slice(-3);
  // stationary in same exact tile for 3 frames
  return last3[0][0] === last3[1][0] && last3[1][0] === last3[2][0]
      && last3[0][1] === last3[1][1] && last3[1][1] === last3[2][1];
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
