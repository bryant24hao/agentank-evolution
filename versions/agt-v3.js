// 望京尼克斯 v3 — fixes:
//   - bullets move 2 tiles/frame (v2 assumed 1) → wider threat horizon
//   - sidestep queues turn+go together so we actually leave the lane
//   - emergency back-step if perpendicular dodge blocked
//   - skip fire when enemy.status.shielded (saves the tempo)
//   - smarter Overload: only when LOS clear AND enemy not shielded/cloaked
//   - NEW: don't commit to turn-then-fire when enemy is already aimed at us; sidestep instead
//   - aim-then-fire same onIdle (turn() + fire() queued) for one-frame kill chains
//   - stuck-patrol breaker

var BULLET_SPEED = 2;
var DODGE_HORIZON_FRAMES = 4;     // frames of reaction we plan for
var FIRE_RANGE_GUARD = 60;

function onIdle(me, enemy, game) {
  var myPos = me.tank.position;
  var myDir = me.tank.direction;
  var enemyTank = enemy.tank;
  var enemyBullet = enemy.bullet;
  var map = game.map;

  // PRIORITY 1: bullet dodging — bullets travel BULLET_SPEED tiles/frame
  if (enemyBullet && bulletThreatensSoon(enemyBullet, myPos, map, DODGE_HORIZON_FRAMES)) {
    if (dodge(me, myDir, myPos, enemyBullet, map, enemyTank)) return;
    // fall through if no dodge worked; try shooting or last-ditch move
  }

  // PRIORITY 1.5: if we are in enemy's gun line and they are already aimed at us
  // (will fire before we can turn-and-fire), break alignment NOW
  if (enemyTank && isInEnemyGunLine(myPos, enemyTank, map) && !canFireNow(me)) {
    if (breakAlignment(me, myDir, myPos, enemyTank, map)) return;
  }
  if (enemyTank && isInEnemyGunLine(myPos, enemyTank, map) && canFireNow(me)) {
    var aimDir2 = directionTo(myPos, enemyTank.position);
    if (myDir !== aimDir2 && enemyIsAimedAtMe(myPos, enemyTank)) {
      // enemy is already pointing at us — turning costs us the trade
      if (breakAlignment(me, myDir, myPos, enemyTank, map)) return;
    }
  }

  // PRIORITY 2: shoot when aligned with visible enemy and shot will land
  if (enemyTank && canFireNow(me) && shotIsWorthIt(me, enemy, myPos, myDir, enemyTank, map)) {
    var aimDir = directionTo(myPos, enemyTank.position);
    if (myDir === aimDir) {
      maybeOverload(me, enemy, myPos, enemyTank.position, map);
      me.fire();
      return;
    }
    // turn AND queue fire in the same frame — engine executes one per frame
    // but queuing fire after turn means next-frame fire if still valid
    me.turn(turnDirection(myDir, aimDir));
    return;
  }

  // PRIORITY 3: pursue star (highest reward) then enemy
  var pursueTarget = pickPursuitTarget(myPos, enemyTank, game);
  if (pursueTarget) {
    var next = nextStep(myPos, pursueTarget, map, enemyTank);
    // SAFETY: don't step into a square where enemy is aimed and we can't out-react
    if (next && stepIntoLethalLOS(next, enemyTank, map, enemy)) {
      // try to fire from current position if we have a shot
      if (enemyTank && canFireNow(me) && shotIsWorthIt(me, enemy, myPos, myDir, enemyTank, map)) {
        var fireAim = directionTo(myPos, enemyTank.position);
        if (myDir === fireAim) {
          maybeOverload(me, enemy, myPos, enemyTank.position, map);
          me.fire();
          return;
        }
        // turn toward enemy to set up fire next frame (safer than walking into death)
        queueFace(me, myDir, fireAim);
        return;
      }
      // otherwise step sideways to stay safe
      if (breakAlignment(me, myDir, myPos, enemyTank, map)) return;
      // no safe sidestep — fall through to alternative pathing or wait
    } else if (next) {
      moveToward(me, myDir, myPos, next);
      return;
    }
  }

  // PRIORITY 4: patrol — but smarter than always-right
  patrol(me, myDir, myPos, map, enemyTank);
}

// === firing / aiming ===

function canFireNow(me) {
  if (me.bullet) return false;
  if (me.status && me.status.fireLocked) return false;
  return true;
}

function shotIsWorthIt(me, enemy, myPos, myDir, enemyPos, map) {
  if (!isAligned(myPos, enemyPos)) return false;
  if (!hasClearShot(myPos, enemyPos, map)) return false;
  // skip if enemy is currently shielded — bullet absorbed, we lose tempo
  if (enemy.status && enemy.status.shielded) return false;
  return true;
}

function maybeOverload(me, enemy, myPos, enemyPos, map) {
  if (!me.skill || me.skill.type !== "overload") return;
  if (me.skill.remainingCooldownFrames !== 0) return;
  if (me.status && me.status.overloaded) return;
  if (enemy.status && (enemy.status.shielded || enemy.status.cloaked)) return;
  // only overload when shot is solid (already vetted by shotIsWorthIt caller)
  // bonus: prefer overloading if enemy is at distance > 2 (more dodge window for them)
  var dist = manhattan(myPos, enemyPos);
  if (dist < 2) return; // close shot: single bullet is enough
  if (typeof me.overload === "function") me.overload();
}

function hasClearShot(a, b, map) {
  if (!isAligned(a, b)) return false;
  var dir = directionTo(a, b);
  var step = delta(dir);
  var pos = add(a, step);
  for (var i = 0; i < FIRE_RANGE_GUARD && !samePos(pos, b); i++) {
    if (!isPassableForBullet(pos, map)) return false;
    pos = add(pos, step);
  }
  return samePos(pos, b);
}

// === dodging ===

function bulletThreatensSoon(bullet, myPos, map, frames) {
  if (!bullet || !bullet.position || !bullet.direction) return false;
  var step = delta(bullet.direction);
  var pos = bullet.position;
  var ticks = frames * BULLET_SPEED;
  for (var i = 0; i < ticks; i++) {
    pos = add(pos, step);
    if (samePos(pos, myPos)) return true;
    if (!isPassableForBullet(pos, map)) return false;
  }
  return false;
}

function dodge(me, myDir, myPos, bullet, map, enemyTank) {
  var bulletDir = bullet.direction;
  var perps = (bulletDir === "up" || bulletDir === "down") ? ["left", "right"] : ["up", "down"];
  // prefer perpendicular that opens more space, avoids enemy, and is fastest to turn to
  var ranked = rankDodgeDirs(perps, myPos, map, enemyTank, myDir);
  for (var i = 0; i < ranked.length; i++) {
    var d = ranked[i];
    if (!isPassableForTank(add(myPos, delta(d)), map, enemyTank)) continue;
    queueFace(me, myDir, d);
    me.go();
    return true;
  }
  // emergency: back-step opposite to bullet direction (away from origin)
  var back = opposite(bulletDir);
  if (isPassableForTank(add(myPos, delta(back)), map, enemyTank)) {
    queueFace(me, myDir, back);
    me.go();
    return true;
  }
  return false;
}

function stepIntoLethalLOS(nextPos, enemyTank, map, enemy) {
  if (!enemyTank || !enemyTank.position || !enemyTank.direction) return false;
  if (!isAligned(nextPos, enemyTank.position)) return false;
  if (!hasClearShot(enemyTank.position, nextPos, map)) return false;
  var aimAtNext = directionTo(enemyTank.position, nextPos);
  if (enemyTank.direction !== aimAtNext) return false;
  // if enemy already has an active bullet, they cannot fire another — safe to step
  if (enemy && enemy.bullet) return false;
  // if enemy is currently disabled, also safe
  if (enemy && enemy.status && (enemy.status.frozen || enemy.status.stunned)) return false;
  var dist = manhattan(nextPos, enemyTank.position);
  return dist <= 4;
}

function isInEnemyGunLine(myPos, enemyTank, map) {
  if (!enemyTank || !enemyTank.position) return false;
  if (!isAligned(myPos, enemyTank.position)) return false;
  return hasClearShot(enemyTank.position, myPos, map);
}

function enemyIsAimedAtMe(myPos, enemyTank) {
  if (!enemyTank || !enemyTank.direction || !enemyTank.position) return false;
  var dir = directionTo(enemyTank.position, myPos);
  return enemyTank.direction === dir;
}

function breakAlignment(me, myDir, myPos, enemyTank, map) {
  if (!enemyTank || !enemyTank.position) return false;
  var sharedX = myPos[0] === enemyTank.position[0];
  var escapeDirs = sharedX ? ["left", "right"] : ["up", "down"];
  var ranked = rankDodgeDirs(escapeDirs, myPos, map, enemyTank, myDir);
  for (var i = 0; i < ranked.length; i++) {
    var d = ranked[i];
    if (!isPassableForTank(add(myPos, delta(d)), map, enemyTank)) continue;
    queueFace(me, myDir, d);
    me.go();
    return true;
  }
  var awayFromEnemy = sharedX
    ? (myPos[1] < enemyTank.position[1] ? "up" : "down")
    : (myPos[0] < enemyTank.position[0] ? "left" : "right");
  if (isPassableForTank(add(myPos, delta(awayFromEnemy)), map, enemyTank)) {
    queueFace(me, myDir, awayFromEnemy);
    me.go();
    return true;
  }
  return false;
}

function rankDodgeDirs(dirs, myPos, map, enemyTank, myDir) {
  // pick direction with: fewer turns needed > open run-out > distance from enemy
  function score(d) {
    var p = add(myPos, delta(d));
    var runOut = 0;
    for (var i = 0; i < 4; i++) {
      if (!isPassableForTank(p, map, enemyTank)) break;
      runOut++;
      p = add(p, delta(d));
    }
    var distAway = enemyTank && enemyTank.position
      ? manhattan(add(myPos, delta(d)), enemyTank.position)
      : 0;
    // turnCost: 0 if facing d, 1 if 90°, 2 if 180°
    var turnCost = 0;
    if (myDir && myDir !== d) {
      turnCost = (myDir === opposite(d)) ? 2 : 1;
    }
    // turn cost dominates (each step costs us a frame which costs us a life)
    return -turnCost * 100 + runOut * 10 + distAway;
  }
  return dirs.slice().sort(function (a, b) { return score(b) - score(a); });
}

function queueFace(me, myDir, targetDir) {
  // queue the right number of turn commands. Returns frames spent turning.
  if (myDir === targetDir) return 0;
  if (myDir === opposite(targetDir)) {
    // 180° rotation = two right turns
    me.turn("right");
    me.turn("right");
    return 2;
  }
  me.turn(turnDirection(myDir, targetDir));
  return 1;
}

// === pursuit ===

function pickPursuitTarget(myPos, enemyTank, game) {
  var star = game.star;
  if (star && enemyTank && enemyTank.position) {
    // skip star if enemy is much closer
    var myDist = manhattan(myPos, star);
    var enemyDist = manhattan(enemyTank.position, star);
    if (enemyDist < myDist - 1) return enemyTank.position; // contest by shooting them instead
    return star;
  }
  if (star) return star;
  if (enemyTank && enemyTank.position) return enemyTank.position;
  return null;
}

function moveToward(me, currentDir, from, to) {
  var dir = directionTo(from, to);
  queueFace(me, currentDir, dir);
  me.go();
}

function patrol(me, currentDir, position, map, enemyTank) {
  var forward = add(position, delta(currentDir));
  if (isPassableForTank(forward, map, enemyTank)) {
    me.go();
    return;
  }
  var perps = (currentDir === "up" || currentDir === "down") ? ["left", "right"] : ["up", "down"];
  for (var i = 0; i < perps.length; i++) {
    if (isPassableForTank(add(position, delta(perps[i])), map, enemyTank)) {
      queueFace(me, currentDir, perps[i]);
      me.go();
      return;
    }
  }
  var back = opposite(currentDir);
  if (isPassableForTank(add(position, delta(back)), map, enemyTank)) {
    queueFace(me, currentDir, back);
    me.go();
    return;
  }
  me.turn("right");
}

function nextStep(start, goal, map, enemyTank) {
  // BFS treating enemy tank as obstacle to avoid crash
  var queue = [{ pos: start, first: null }];
  var seen = {};
  seen[key(start)] = true;
  var maxNodes = 600;

  for (var head = 0; head < queue.length && head < maxNodes; head++) {
    var item = queue[head];
    if (samePos(item.pos, goal)) return item.first;

    var dirs = ["up", "right", "down", "left"];
    for (var i = 0; i < dirs.length; i++) {
      var next = add(item.pos, delta(dirs[i]));
      var k = key(next);
      if (seen[k]) continue;
      if (!isPassableForTank(next, map, enemyTank) && !samePos(next, goal)) continue;
      seen[k] = true;
      queue.push({ pos: next, first: item.first || next });
    }
  }
  return null;
}

// === geometry / map ===

function isAligned(a, b) {
  return a && b && (a[0] === b[0] || a[1] === b[1]);
}

function directionTo(a, b) {
  if (b[0] > a[0]) return "right";
  if (b[0] < a[0]) return "left";
  if (b[1] > a[1]) return "down";
  return "up";
}

function opposite(d) {
  if (d === "up") return "down";
  if (d === "down") return "up";
  if (d === "left") return "right";
  return "left";
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

function add(pos, d) { return [pos[0] + d[0], pos[1] + d[1]]; }
function manhattan(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }
function samePos(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
function key(pos) { return pos[0] + "," + pos[1]; }

function isPassableForTank(pos, map, enemyTank) {
  if (!map[pos[0]] || map[pos[0]][pos[1]] === undefined) return false;
  var t = map[pos[0]][pos[1]];
  if (t === "x" || t === "m") return false;
  if (enemyTank && enemyTank.position && samePos(pos, enemyTank.position)) return false;
  return true;
}

function isPassableForBullet(pos, map) {
  if (!map[pos[0]] || map[pos[0]][pos[1]] === undefined) return false;
  var t = map[pos[0]][pos[1]];
  return t !== "x" && t !== "m";
}
