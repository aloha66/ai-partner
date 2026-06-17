# TODOs

## Active

当前无 active TODO。

## Resolved

### TODO-2: 明确多卡片/多 agent 队列语义

**Status:** 已完成，2026-06-17。

**Resolution:** v1 暂时保持 single active snapshot，不支持多张同时可见卡片，也不提供队列/切换入口。桌面伴侣卡片只表达“当前最应该被用户看到的 workflow”；历史 run、被抢占 run 和已完成 run 不作为隐藏队列回放。

**Semantics:**
- **排序:** `timestamp` 是单卡片排序边界；旧 timestamp 事件不能回滚当前 snapshot。
- **去重:** HTTP ingress 继续按 `event_id` 在 TTL 内去重；state 层不把重复/晚到事件转成队列项。
- **抢占:** `running`/`reading`/`editing`/`waiting` 的较新事件可以成为 active snapshot；被抢占的 `(source, run_id)` 后续事件视为过期，不能重新覆盖当前卡片。
- **过期:** `done`/`error`/`idle` 只允许作用于当前 active `(source, run_id)`；完成计时器或主动清错把当前 run 清到 idle 后，同一个 run 也不能用后续事件重新弹回卡片，必须使用新的 `run_id`。
- **授权归属:** 授权决策归属当前可见 snapshot 的 `source + activeRunId/runId + updatedAt + authorization.id`。不同 agent 即使复用 run/auth id，也不会共享本地按钮决策。

**Reasoning:** M0/M1 窗口空间和信任模型更适合一个高置信度 active card。多卡片/队列需要新的优先级、批量授权、过期提示和可恢复 UX；在 contract v1 里提前加队列会制造比它解决的问题更多的产品复杂度。

### TODO-3: 决定 Agent metadata 是否作为第三格显示

**Status:** 已完成，2026-06-17。

**Resolution:** 保持 header `agent-badge` 作为唯一可见 Agent 标识；`Agent` metadata 保留在 `interactiveCardView` 的 view-model 中用于语义和测试，但不进入当前卡片 grid。

**Reasoning:** Agent 是“谁在跑/谁在请求授权”的高优先级信任信号，放在 header badge 更容易扫到；Project/Worktree 是低优先级工作区上下文，适合留在两格 metadata。三格 metadata 或 badge+第三格共存都会在 300px 卡片里制造重复信息，并挤占 380px 最小窗口下的授权按钮和状态文本预算。

### TODO-1: 调整 AI 桌面伴侣 BRD 首版对外口径

**Status:** 已完成，2026-06-07。

**Resolution:** 已把 `docs/ai-desktop-partner-business-requirements.md` 的首版口径改成 “macOS Codex technical preview / AI status companion”，并明确当前 MVP 是 macOS + Codex wrapper/debug CLI + Petdex-like 本机内测/CLI 驱动安装 + 状态反馈桌面伴侣。

**Roadmap clarification:** 多 AI、陪伴模式、深度互动、记忆/长期人格、Windows、partner search/switch、asset marketplace 等均已标为 roadmap，不作为首版承诺。
