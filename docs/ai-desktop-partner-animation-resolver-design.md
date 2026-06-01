# AI 桌面伴侣动画解析器设计

日期：2026-05-31

## 定位

动画解析器是本项目的核心设计。

它负责把 AI 工作流状态、伴侣物理互动状态和当前伴侣资产能力合成为最终动画意图。不要把 AI 状态直接等同于动画名，也不要继承 Petdex 的 `waving`、`jumping`、`running-left/right` 作为产品状态。

核心公式：

```text
workflowState + physicalState + partnerCapabilities -> animationIntent
```

## 三层状态

### 1. AI 工作流状态

MVP 状态：

```text
idle | running | reading | editing | waiting | error | done
```

含义：

| 状态 | 含义 |
| --- | --- |
| `idle` | 当前没有活跃任务，或系统已回到安静状态 |
| `running` | AI 正在执行普通任务 |
| `reading` | AI 正在读取、搜索、审查上下文 |
| `editing` | AI 正在编辑、打 patch、写文件 |
| `waiting` | AI 正在等待用户确认、授权或输入 |
| `error` | AI 任务失败、异常或权限受阻 |
| `done` | AI 任务完成，短暂展示后回到 idle |

### 2. 伴侣物理互动状态

MVP 状态：

```text
normal | carried | struggling | falling | recovering
```

含义：

| 状态 | 含义 |
| --- | --- |
| `normal` | 没有被用户物理干预 |
| `carried` | 被用户拖动、拎起或抓住 |
| `struggling` | 被拎住时左右挣扎 |
| `falling` | 用户松手后下落 |
| `recovering` | 落地后站稳、恢复 |

这些状态不是 AI 专属。后续陪伴模式也应该复用它们。

### 3. 后续陪伴状态

不进 MVP，但设计要预留：

```text
mood: happy | annoyed | sleepy | curious | focused
relationship: unfamiliar | familiar | close
mode: quiet | companion | focus
```

陪伴状态以后可以影响动画选择，但不应该覆盖 `waiting`、`error` 这类高优先级 workflow 提醒。

## 合成原则

1. `workflowState` 决定任务语义。
2. `physicalState` 可以抢占身体动画。
3. 气泡和状态标识必须保留 workflow 语义。
4. `waiting` 和 `error` 的气泡优先级最高。
5. `done` 如果被 physical 抢占，先显示完成气泡，身体庆祝动画排队，最多保留 5 秒。
6. 缺少目标动画时，依次使用 extension fallback、Petdex legacy fallback、程序化 transform。

## Resolver 输入输出

输入：

```json
{
  "workflowState": "waiting",
  "physicalState": "carried",
  "availableAnimations": [
    "legacy.idle",
    "legacy.running-left",
    "legacy.running-right",
    "legacy.waiting"
  ],
  "message": "正在等待用户确认"
}
```

输出：

```json
{
  "body": {
    "animation": "legacy.running-left/right",
    "procedural": ["shake"],
    "loop": true
  },
  "bubble": {
    "state": "waiting",
    "text": "正在等待用户确认",
    "priority": "high"
  },
  "queued": []
}
```

## 示例矩阵

| workflow | physical | 资源能力 | body animation | bubble/status |
| --- | --- | --- | --- | --- |
| `reading` | `normal` | 有 `workflow.reading` | `workflow.reading` | 正在读取 |
| `reading` | `carried` | 有 `physical.carried` | `physical.carried` | 正在读取 |
| `waiting` | `carried` | 无 `physical.carried` | `legacy.running-left/right + shake` | 等待用户确认 |
| `done` | `falling` | 有 `workflow.done` | `physical.falling`，落地后补播 `workflow.done` | 已完成 |
| `error` | `normal` | 无 `workflow.error` | `legacy.failed` | 发生错误 |
| `editing` | `struggling` | 无扩展动画 | `legacy.running-left/right + shake` | 正在编辑 |

## Petdex legacy 映射

Petdex/hatch-pet 行顺序：

```text
idle
running-right
running-left
waving
jumping
failed
waiting
running
review
```

映射原则：

| Petdex row | ai-partner 语义 |
| --- | --- |
| `idle` | `workflow.idle` 和所有安全 fallback |
| `running` | `workflow.running` / `workflow.editing` fallback |
| `review` | `workflow.reading` fallback |
| `waiting` | `workflow.waiting` fallback |
| `failed` | `workflow.error` fallback |
| `waving` | `workflow.done` fallback |
| `jumping` | `workflow.done` / `celebrate` fallback |
| `running-left/right` | `physical.struggling` / drag-direction fallback |

## done 与 physical 的冲突处理

当 workflow 进入 `done`，但 physical 不是 `normal`：

1. bubble 立即显示完成。
2. 当前 body 保持 physical 动画。
3. resolver 创建 `queuedBodyAnimation = workflow.done`。
4. physical 回到 `normal` 或 `recovering` 结束后补播。
5. 如果 5 秒内没有机会补播，丢弃 queued animation，避免过期庆祝。

## 后续陪伴模式复用

陪伴模式不要另起一套完全独立的状态系统。它应该复用物理状态，并添加 mood / relationship / mode。

例子：

```text
workflowState = idle
physicalState = touched.head
mood = happy
```

可以解析为摸头开心动画。

```text
workflowState = waiting
physicalState = touched.head
mood = happy
```

应该解析为等待确认优先：身体可以轻微反应，但气泡必须显示等待确认。

## 实现边界

MVP 必做：

- workflow + physical 双状态模型。
- Petdex legacy fallback。
- `done` 排队规则。
- `waiting/error` 气泡优先级。

MVP 不做：

- 完整 mood/personality/relationship。
- 动画编辑器。
- 多伴侣并发。
- 多 run 聚合 UI。
