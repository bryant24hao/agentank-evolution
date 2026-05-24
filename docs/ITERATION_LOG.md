# Iteration Log

## v2 (起点)
- 基础 onIdle：bullet 威胁检测、对齐开火、BFS 寻路、巡逻
- `bulletThreatensSoon` 3 步窗口（错的，子弹其实 2 tiles/frame）
- `sidestep` 转身那帧只 turn 不 go
- 13W/2L 起步

## v3 ❌
- 全面重写为模块化（dodge / strike / hunt / collect / wander）
- **2W/8L 翻车**，rollback。教训：不要一次改太多

## v5 ✅
- `bulletThreatensSoon` 窗口 3→6 步（匹配子弹速度 2/frame）
- `sidestep` 同帧 queue turn+go（不浪费一帧）
- diff 仅 2 处。5W/1L pass

## v6 ✅
- 新增 `enemyAimedAtMeClose` 检测
- fire 决策里：敌方对齐+瞄准时，**不转身追击**而是 sidestep
- 解决 Drill-style 反杀，4W/1L pass

## v7 ✅
- 修 sidestep 180° bug：单 turn 走错方向→排 2 个 turn
- 新增 turn cost 排序，优先 0°/90°
- 7W/1L (Eazo Cup 排名 +5)

## v8 ✅
- aligned + canFire 时跳过 `tryOverload`
- 避免 Overload 优先级前置浪费一帧
- 16W/2L = 89%，score 731→890

## v9 ✅
- BFS 第一步避开 `stepIsKillZone`：敌方瞄准 LOS + 距离 ≤4 的格子
- 解决 Kimi 二次进入同一火线被秒杀
- 22W/4L，score 1071→1194

## v10 ✅ ⭐ (核心稳态)
- `offsetShotDir` 检测：敌方 1 格 off-axis + 距离 ≥3
- 触发 Overload 双弹平行射击（学 🛡 模式）
- 11W/1L = 92%，score 1235→1354

## v11 ❌ → rollback
- 连续 3 步同方向后强制 juke
- 抢星变慢，1W/1L

## v12 ❌ → rollback
- sidestep 优先 grass（隐身）
- sidestep 绕远，1W/2L

## v13 ❌ → rollback
- 敌人 visible→invisible 时强制 sidestep
- 3W/4L stress 失败（cloak 用户仍赢）

## v14 ❌ → rollback
- `enemyAimedAtMeClose` 检查移到 fire-block 外
- pursuit 阶段过度防御卡死，1W/2L

## v15 (diagnostic only)
- 加 `speak(p=N)` 探测 globals 持久性
- **确认 globals 持久 ✓**（p=1 到 p=8 顺序输出）

## v16 ❌ → rollback
- 用 globals 记忆敌方最后位置
- 隐身 1-6 帧内避开旧 lane
- 5W/4L → 0W/7L 灾难 stress

## v17 ❌ → rollback
- 维护敌方位置历史，线性预测下帧
- 朝预测位置开火
- 1W/3L，预测错误率太高

## v18 ❌ → rollback
- 移除所有 fire 行为，纯防御抢星
- 1W/4L，敌人从容瞄死

## v19 ❌ → rollback
- 检测敌方静止 3+ 帧 (camping)
- 5W/2L 阶段性 pass，但 stress 不稳

## v20 ❌ → rollback
- `findFirePosition`：找有 LOS 的目标格
- runtime 增加 30%，输 tiebreaker

## v21 ❌ → rollback
- mound-breaking：1 个 mound 隔开时先射 mound
- 浪费 shot 槽，1 帧 cooldown 给对手机会

## v22 ❌ → rollback
- v10 + mound-break only（移除 v20 重计算）
- 同 v21 问题，5W/5L 持平 v10

## v23 (revert to v10)
- 纯 v10 回滚

## v24 ✅ ⭐ (最新优化)
- BFS maxNodes 按地图大小动态调整：
  - 小地图（≤200 格，如 Star Cup public-map-6 176 格）：150
  - 大地图（>200 格，如 random 285 格）：400
- runtime 减 26%（91ms → 67ms）on Star Cup map
- sim 30/30 全胜，real 5/0 pass
- 累计 17W/8L = 68%

## 路径

- Bronze I (265) → Silver III → Silver II → Silver I → Gold III → Gold II → Gold I → Platinum III → Platinum II → Platinum I → Diamond III → Diamond II → Diamond I → Master III → Master II → Master I → **Champion-1 (~2050)**

## 工作流程

每次迭代严格 3-5 步：

1. **观察败局**：拉 replay event 流，识别死亡帧的 state
2. **诊断**：把死法归到已知 pattern 或新 pattern
3. **最小改动**：1-2 处代码变化，不重写
4. **smoke 仿真**：3 训练 bot × 1 局，验证语法
5. **真实小验证**：3-5 场，≥2/3 算 pass
6. **stress 大样本**：5-10 场，看是否稳定
7. **fail 立刻 rollback**：保住已知优解
