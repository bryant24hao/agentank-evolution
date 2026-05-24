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

  var target = game.star || (enemyTank && enemyTank.position);
  var next = target && nextStep(myPos, target, map);
  if (next) {
    moveToward(me, myDir, myPos, next);
    return;
  }

  patrol(me, myDir, myPos, map);
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

function nextStep(start, goal, map) {
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
      seen[k] = true;
      queue.push({ pos: next, first: item.first || next });
    }
  }
  return null;
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
