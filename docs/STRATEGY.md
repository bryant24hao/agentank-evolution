# v24 策略说明

## 决策优先级（顺序执行，先满足先执行）

```
onIdle 入口
  │
  1. ┌─ 子弹威胁? ──┐  (bulletThreatensSoon, 6 步)
  │  └─ 是 ───────→ sidestep 排 turn+go
  │
  2. ┌─ 敌方可见 + 可开火 + 路径清晰? ──┐  (canShoot)
  │  ├─ 已对齐 ─→ tryOverload(避免 fire-trade) + fire
  │  ├─ 敌方对我瞄准 + 距离 ≤5 ──→ sidestep 防伏击
  │  └─ 否则 ──→ turn 朝敌方
  │
  3. ┌─ Overload 就绪 + 1 格 off-axis + 距离 ≥3 ──┐  (offsetShotDir)
  │  └─ 是 ───────→ overload + fire（双弹拦截）
  │
  4. ┌─ 有 target (star 或 enemy)? ──┐
  │  ├─ BFS 第一步避瞄准 LOS ──→ moveToward
  │  └─ 无路则忽略 LOS 退而求 ──→ moveToward
  │
  5. patrol 巡逻
```

## v24 核心：地图大小自适应

```js
function nextStep(...) {
  ...
  var mapSize = map.length * (map[0]?.length || 0);
  var maxNodes = mapSize <= 200 ? 150 : 400;
  // 小地图（如 Star Cup public-map-6 176 格）只需 150 节点
  // 大地图（random 285 格）维持 400
}
```

**收益**：runtime 减 26%，mutual-kill tiebreaker 胜率提升

## 关键参数

| 参数 | 值 | 解释 |
|---|---|---|
| `BULLET_SPEED` | 2 tiles/frame | 子弹速度（实测） |
| `DODGE_HORIZON_FRAMES` | 6 步 | 子弹威胁视野 |
| `enemyAimedAtMeClose` 距离 | ≤5 | 瞄准防伏击触发距离 |
| `offsetShotDir` 距离 | ≥3 + ≤12 | Overload 偏移射击范围 |
| `stepIsKillZone` 距离 | ≤4 | BFS 避瞄准 LOS 触发距离 |
| BFS maxNodes (大地图) | 400 | 标准搜索深度 |
| BFS maxNodes (小地图) | **150** | v24 优化 |

## 已知弱点

| 对手类型 | v24 胜率 | 原因 |
|---|---|---|
| 激进型 (azure-hunter) | 95%+ | 反击 + dodge 链克制 |
| 训练 bot 全体 | 78-100% | sim 内强势 |
| 同级 (1900-2100) | 55-65% | 平衡战 |
| Sniper (keith 类) | 20-30% | 占位强 + skill 灵活 |
| Cloak 大师 | 30-40% | 隐身后无法预测 |
| Teleport 抢星 | 40-50% | 抢不过 |
| Score >2200 顶尖 | 30-40% | 综合素质差距 |

## 试过但不工作的方向

1. **Predictive firing**：线性预测错误率高
2. **路径随机化**：抢星变慢
3. **Cloak 反伏击**：触发太窄
4. **Anti-camp**：触发率太低
5. **Mound breaking**：浪费 shot 槽
6. **状态机重写**：复杂度增加无净收益
7. **ML/RL**：引擎沙箱限制

## 未来探索（高风险/高回报）

1. **换技能**：teleport/cloak（需买，重写技能逻辑）
2. **地图特化代码**：除 v24 BFS 调整外，针对 public-map-6 写专门 onIdle
3. **真正 state tracking**：敌方轨迹拟合 + 多目标预测
