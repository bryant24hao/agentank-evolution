# AgenTank Evolution — 望京尼克斯

[望京尼克斯](https://agentank.ai/share/tanks/tnk_1zQjtA8aUmEGl7Pjk) 在 [AgenTank](https://agentank.ai) 平台的代码迭代历程。

技能：**Overload**（双弹平行射击）

## 当前状态

- 段位：Champion-1
- Score：~2050
- 全局：top 15% (Top 300/1900+)
- 历史峰值：score 2172，全局 #216

## 起点 → 现状

| 阶段 | Score | 段位 | 全局 |
|---|---|---|---|
| Session 起点 | 265 | Bronze I | placement |
| v3 翻车低谷 | 306 | Silver III | #42 |
| v10 publish | 1235 | Diamond-3 | #25 |
| v8 升 Gold | 731→890 | Gold II→I | #30→#26 |
| **v24 (现在)** | **~2050** | **Champion-1** | **~#290** |
| 历史峰值 | 2172 | Champion-1 | #216 |

净增 **+1780 score** (×7.7)，**9 段位提升**，Eazo Cup 拿到铜牌。

## 进化历程：成功的 8 个版本

每个版本只解决一类**实测**的死法，逐步打磨：

| 版本 | 解决的问题 | 改动核心 |
|---|---|---|
| **v5** | 子弹速度被低估（实际 2 tiles/frame） | `bulletThreatensSoon` 窗口 3→6，`sidestep` 同帧 queue turn+go |
| **v6** | 敌人瞄好我傻追，被秒杀 | `enemyAimedAtMeClose` 检测：敌方对齐+瞄准时不转身追击 |
| **v7** | 180° 转向只 turn 一次走错方向 | 排两个 turn，并按"少转优先"排序 |
| **v8** | aligned fire-trade 时 Overload 浪费一帧 | 对齐时跳过 Overload 直接 fire |
| **v9** | 二次走回同一火线被打死 | BFS 第一步避开敌方瞄准 LOS |
| **v10** | Overload 偏移射击未利用 | 1 格 off-axis + 距离≥3 时 overload 双弹拦截 |
| **v24** | Star Cup 地图 runtime 慢 | 地图 ≤200 格时 BFS maxNodes 400→150 |
| **v26** ⭐ | 大地图 runtime 也可优化 | Hybrid：小图保 150，大图 mapSize/1.5 (random 285→190) |

## 失败的 15 次实验

全部 rollback，平均每次扣 30-50 分：

| 版本 | 思路 | 失败原因 |
|---|---|---|
| v3 | 全面重写 | 一次性改太多，10+ 新 bug |
| v11 | 连走 3 步同向后随机 juke | 抢星变慢 |
| v12 | sidestep 优先 grass | 偏好让路径绕远 |
| v13 | cloak 反伏击 | 触发太窄，cloak 用户仍赢 |
| v14 | enemyAimed 检查外移到 pursuit | pursuit 阶段过度防御卡死 |
| v15 | (diagnostic) globals 持久化探测 | 确认 globals 持久（用于 v16） |
| v16 | state-aware lane memory | 小样本 5W/4L pass，stress 0W/7L 灾难 |
| v17 | predictive firing (line) | 预测错误率高，浪费 Overload CD |
| v18 | 纯防御不开火 | 没火力压制，敌人从容瞄死 |
| v19 | anti-camp detection | 触发率太低，跟 v10 没区别 |
| v20 | findFirePosition 主动找火力位 | 边际增益 + 增加 runtime 30% |
| v21 | mound-breaking shot | 浪费 shot 槽（1 帧 cooldown）|
| v22 | v10 + mound-break only | 同 v21 问题 |
| v23 | revert to pure v10 | (回滚版本号) |
| v25 | 所有地图按 mapSize/1.5 | 小地图节点太低 (117) Star Cup map 退化 |
| v27 | chain turn+fire 同 onIdle | sim 9/9 但 real **0W/4L 灾难** — sim mislead |

## 关键 meta 教训

1. **小样本骗人**：3 场 pass 不可信，stress 测可能反转
2. **每个 surgical fix 有 edge case 代价**：理论增益常被实际 bug 抵消  
3. **找到局部最优要收手**：v10/v24 经过 7 次成功迭代，再改 13 次全失败
4. **Matchmaking 是均衡机制**：score 涨→对手强→WR 跌，**真实 ceiling 由代码决定**
5. **Globals 持久化** ✓（v15 diagnostic 证实），但 logic 难写对
6. **Runtime 关键**：mutual-kill tiebreaker 按 ms 比较慢的输；v24 减 BFS 预算赢回更多

## 文件结构

```
agentank-evolution/
├── README.md                # 本文件
├── docs/
│   ├── ITERATION_LOG.md     # 详细每版本变更日志
│   └── STRATEGY.md          # 核心策略说明
└── versions/
    ├── agt-v2.js   ~ v24.js # 所有版本
    └── ...
```

## 怎么用

```bash
# 部署最新版本
cat versions/agt-v24.js  # 当前 live

# 通过 AgenTank Agent API publish
curl -X POST -H "Authorization: Bearer YOUR_TANK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$(cat versions/agt-v24.js)\",\"submittedBy\":\"Claude\",\"notes\":\"...\"}" \
  https://agentank.ai/api/agent/tank/code
```

## 引用文档

- [AgenTank Agent Guide](https://agentank.ai/agent-guide)
- [v2ex 玩家讨论](https://www.v2ex.com/t/1212167)
