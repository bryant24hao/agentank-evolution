# Self-Evolution Framework

基于本 session 8 成功 + 15 失败的真实数据设计的自迭代闭环。

## 设计目标

让坦克代码**自主进化**而不需要每次人工：
- 提示词工程
- 读 replay
- 写代码
- 验证
- 决策 publish

## 5 层架构

```
Observation → Hypothesis → Validation → Decision → Knowledge
    ↑                                                    │
    └────────────── feedback loop ───────────────────────┘
```

### Layer 1: Observation
- `pull_recent_matches()`：用 Agent API 拉最近 N 局
- `classify_losses()`：把败局归到 pattern (crashed/star/runTime 等)

### Layer 2: Hypothesis Generator
- 查 `fix_database.py`：pattern → 候选 fix
- 跳过 `knowledge.failed` 里已知失败的
- 同时不重做 `knowledge.successful` 已生效的

### Layer 3: Multi-Stage Validation
三道闸门，**所有 fix 必须全部通过**：

| Gate | 数量 | 阈值 |
|---|---|---|
| Gate 1: Sim | 15-30 局 | ≥80% |
| Gate 2: Real cautious | 5 局 | ≥3 胜 |
| Gate 3: Real stress | 30 局 | ≥55% |

任一 gate 失败 → 立刻 rollback。

### Layer 4: Decision & Persistence
- Promote：三 gate 通过，更新 live + GitHub
- Reject：写入 `knowledge.failed`
- Inconclusive：再 20 局重测

### Layer 5: Knowledge Base
`knowledge.json`：
```json
{
  "successful": [
    {"pattern": "180° turn bug", "fix": "v7-double-turn", "evidence": "..."},
    ...
  ],
  "failed": [
    {"pattern": "predictive firing", "tried": "v17", "reason": "线性预测不准"},
    ...
  ],
  "structural_unsolvable": [
    {"pattern": "vs teleport star-race", "reason": "skill 限制，需买 teleport"}
  ]
}
```

## 实施进度

| 模块 | 文件 | 状态 |
|---|---|---|
| API client | `api.py` | ✅ 完成 |
| Loss classifier | `classifier.py` | ✅ 完成 |
| Fix database | `fix_database.py` | ✅ 编码本 session 实证 |
| Validator (3-gate) | `validator.py` | ✅ 完成 |
| Main harness | `harness.py` | ✅ 完成 |
| Knowledge persistence | `knowledge.json` | ✅ 初始化 |
| Example cycle | `examples/demo_cycle.py` | ✅ 完成 |

## 使用

```bash
# 单次 cycle (推荐先这样测)
TANK_KEY=agtk_xxx python examples/demo_cycle.py

# 持续闭环 (每小时一次)
TANK_KEY=agtk_xxx python harness.py --interval=3600

# 仅诊断不 publish
TANK_KEY=agtk_xxx python harness.py --dry-run
```

## 安全机制

- **Bounded loss**：每次实验最多 -100 分，超过自动暂停
- **Cooldown**：连续 3 个 cycle 失败后冷却 6 小时
- **Manual override**：任何时候 `touch FREEZE` 文件即暂停所有 cycle

## 现实限制

| 限制 | 影响 |
|---|---|
| API 速率（5s/req） | 1 cycle ~5 分钟 |
| 每次实验真分成本 | ~-50 分平均 |
| Fix DB 上限 | 本 session 已穷尽明显 pattern |
| Sim ≠ Real | 必须付真分验证 |

**理论可行，实战 ROI 边际**。适合作为长期工具而非短期突破。
