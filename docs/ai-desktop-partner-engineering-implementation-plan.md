# AI 桌面伴侣工程实现计划

日期：2026-06-02
状态：已通过 `/plan-eng-review`，可从 M0 和 contracts 开始实施
来源：

- 已批准设计：`~/.gstack/projects/ai-partner/aloha66-master-design-20260530-213545.md`
- 业务需求：[ai-desktop-partner-business-requirements.md](ai-desktop-partner-business-requirements.md)
- Tauri 可行性：[ai-desktop-partner-tauri-feasibility.md](ai-desktop-partner-tauri-feasibility.md)
- 动画解析器：[ai-desktop-partner-animation-resolver-design.md](ai-desktop-partner-animation-resolver-design.md)
- 资产指南：[ai-desktop-partner-asset-preparation-guide.md](ai-desktop-partner-asset-preparation-guide.md)
- 官方校验：Tauri v2 配置、命令、事件、channel、分发文档
- Eng review：2026-06-02，含 architecture/code quality/test/performance/subagent/outside voice

## 目标

第一版做“AI 工作流状态联动桌面伴侣”，不是完整聊天伴侣、资产生态或私人秘书。

用户要看到一个轻量常驻桌面伴侣。当 Codex wrapper 或调试 CLI 发出状态事件时，伴侣能用动作和气泡表达：

```text
AI 正在运行 / 读取 / 编辑 / 等待用户 / 出错 / 完成
```

用户拖动、拎起或释放伴侣时，身体动作进入物理状态，但 AI 工作流语义不丢。

核心公式固定为：

```text
workflowState + physicalState + partnerCapabilities
  -> animationIntent
  -> renderer
```

## 已锁定决策

| 编号 | 决策 | 结果 |
| --- | --- | --- |
| D1 | MVP 范围 | 分阶段完整 MVP。完整闭环不砍，但先做窗口 spike 和协议冻结 |
| D2 | renderer 状态同步 | 外部 wrapper 用 localhost HTTP；Tauri app 内部用 Rust state store -> Tauri events -> renderer |
| D3 | animation resolver 位置 | 第一版做纯 TypeScript 模块，Rust 不判断动画 |
| D4 | 测试范围 | 第一版写完整测试矩阵，不只写 smoke test |
| D5 | 动画渲染 | 第一版用 CSS/DOM sprite 渲染，不引入 Canvas 或游戏引擎 |
| D6 | wrapper 发现 app endpoint | App 启动写 runtime descriptor；wrapper/CLI 读取 port/token |
| D7 | pause/resume 语义 | Soft pause：endpoint 继续运行并校验事件，不推 UI，只保留 latest safe snapshot |
| D8 | contracts source of truth | `packages/contracts/`，含 schema、fixtures、wire/domain casing 边界 |
| D9 | `done` timer 归属 | Rust 管 workflow `done -> idle`；resolver/UI 管 body queue 和 5 秒丢弃 |
| D10 | physical transition | 单独 `physicalStateMachine` / reducer，不写散在 renderer component 里 |
| D11 | schema version | 所有 wire contracts 带 `schemaVersion` |
| D12 | `clear_error` | 清除后回 `idle`，不复活旧 run |
| D13 | Codex wrapper 分类 | 多源组合：结构化信号优先，stdout/stderr 保守 fallback，unknown -> `running` |
| D14 | DMG smoke test | 覆盖默认伴侣可见、本地 endpoint 可用、不抢焦点 |
| D15 | ingress rate budget | 每 run 10 events/s，burst 30，超限只保留 latest state |
| D16 | asset scan | MVP 只扫描一个用户配置的 assets 根目录 |
| D17 | 默认随包资产 | 1 个默认 Petdex 兼容伴侣 |
| D18 | 缩放策略 | 优先整数缩放，必要时固定档位 |
| D19 | `extras/` runtime budget | MVP v1 每段最多 32 帧、运行帧 192x208、fps 1-24；不限制未来源素材和 v2 规格 |

## Step 0 Scope Challenge

### What Already Exists

| 子问题 | 已有输入 | 复用方式 |
| --- | --- | --- |
| 产品边界 | `business-requirements` 和已批准设计 | 直接作为 MVP/非 MVP 边界，不重开产品定义 |
| 桌面壳选择 | `tauri-feasibility` | Tauri 优先，只在 spike 失败时重评 Electron |
| 状态语义 | 已批准设计和 `animation-resolver-design` | 复用 canonical workflow/physical 状态 |
| 资产输入 | `asset-preparation-guide` | 复用 Petdex/hatch-pet 薄导入契约 |
| AI 接入 | 已批准设计的 Codex wrapper 首接目标 | 先接 Codex，其他 AI 工具只保留 adapter 位 |

当前仓库还没有应用代码，所以工程计划不要复刻一套新架构。它应把已批准设计转成实现顺序、测试矩阵、失败模式和并行工作流。

### Minimum Complete Change Set

完整 MVP 必须包含：

1. Tauri macOS 窗口 spike。
2. `packages/contracts/` 中的 `WorkflowEvent`、`PartnerStateSnapshot`、`AnimationIntent`、`RuntimeDescriptor` schema 和 fixtures。
3. Rust 本地状态服务和 localhost 事件入口。
4. Runtime descriptor 写入、读取、过期清理和 wrapper 发现失败处理。
5. Tauri event/command 状态同步。
6. 纯 TypeScript animation resolver。
7. `physicalStateMachine` / reducer。
8. Petdex/hatch-pet 基础资产加载。
9. CSS/DOM sprite renderer。
10. Codex wrapper 真实接入。
11. 调试 CLI。
12. 完整测试矩阵和 macOS DMG 打包路径。

可延期但不丢失：

- 完整陪伴模式、mood、relationship、personality。
- 私人秘书、大模型接入和记忆。
- 多 AI 助手完整适配。
- 多 run 聚合 UI。
- 动画编辑器、资产市场、Live2D、Spine、Rive。
- Windows 体验对等发布。
- Mac App Store 路线。

### Complexity Check

该计划一定会超过 8 个文件和 2 个服务。结论不是砍掉能力，而是拆阶段实施：

```text
M0 窗口 spike + 协议冻结
  |
  +--> M1 Rust 状态桥
  +--> M2 前端窗口和 renderer
  +--> M3 resolver + asset loader
  |
  +--> M4 Codex wrapper
  |
  +--> M5 macOS 打包内测
```

这是分阶段完整 MVP。每阶段单独可验证，最终仍是一个完整闭环。

### Search Check

- [Layer 1] Tauri v2 配置支持 `transparent`、`alwaysOnTop`、`focusable` 等窗口选项；macOS 透明窗口需要 `macos-private-api`，官方明确说这会影响 App Store 接受。工程上采用 direct DMG，不承诺 App Store。
- [Layer 1] Tauri v2 commands 和 event system 已覆盖前后端通信；renderer 不需要再开 WebSocket。命令适合拉状态和控制动作，事件适合状态推送。
- [Layer 1] Tauri v2 distribution 文档支持 app/dmg 和 Windows installer 路径。MVP 先 macOS DMG，Windows 后置。
- [Layer 3] Petdex 状态名不是产品语义。`waving`、`jumping`、`running-left/right` 只作为 legacy fallback，不进入 canonical model。

### Completeness Check

选择完整测试矩阵，完整度 10/10。AI 辅助下，补齐 resolver 矩阵、事件校验、资产损坏、窗口手测、安全边界的成本远低于事后追状态错乱。

### Distribution Check

MVP 不只写代码。计划包含：

- 本地开发启动。
- macOS direct DMG。
- DMG smoke gate：默认伴侣可见、本地 endpoint 可用、不抢焦点。
- GitHub Releases 后续分发。
- Windows installer 后置。
- Mac App Store 明确不在 MVP 承诺内。

## Architecture Review

### A1. 分阶段完整 MVP

**Finding:** 已批准设计的下一步同时包含状态 schema、本地服务、Petdex 导入、resolver、桌面窗口、CLI、Codex wrapper。一次性实施会放大窗口 spike 和协议不稳定的风险。

**Decision:** 采用 D1 的分阶段完整 MVP。

**Recommendation:** 保留完整目标，但先做 `M0` 窗口 spike 和协议冻结，再并行实现 Rust、前端、resolver、资产和 wrapper。

### A2. 内部通信不要引入 WebSocket

**Finding:** 已批准设计里出现过 WebSocket reconnect，但 Tauri app 内部已有 commands/events/channel。renderer 自己维护 WebSocket 会多一套连接恢复、认证和测试路径。

**Decision:** 采用 D2。外部事件入口是 localhost HTTP；app 内部是 Rust state store -> Tauri event -> renderer。

**Recommendation:** 删除 renderer WebSocket 设计。保留 `get_current_state` command 用于启动、恢复和事件丢失后的快照拉取。

Implementation override:

```text
工程计划覆盖旧设计：
- 外部只实现 POST /events。
- renderer 只用 Tauri events + get_current_state command。
- 不实现 renderer WebSocket。
- 不实现 HTTP GET /state 给 renderer。
```

### A3. Resolver 必须保持单一实现

**Finding:** resolver 是产品语义核心。如果 Rust 和前端各实现一份，`waiting/error/done` 的优先级和 fallback 很容易漂移。

**Decision:** 采用 D3。第一版 resolver 是纯 TypeScript 模块。

**Recommendation:** Rust 只输出标准化 `PartnerStateSnapshot`。前端 resolver 根据 snapshot、physical state 和 asset capabilities 产出 `AnimationIntent`。

### A4. 本地事件入口必须是安全边界

**Finding:** 本地 endpoint 如果只做 demo 收事件，很容易变成任意本地进程刷屏或注入气泡的入口。

**Decision:** `POST /events` 必须只绑定 `127.0.0.1`，携带 bearer token，限制 payload 4KB，白名单状态，拒绝 `file_content`、`code`、`diff`、`prompt` 等字段，气泡文本截断到 160 字。

**Additional requirements:**

- CORS disabled；拒绝浏览器跨源请求和非允许 origin。
- Token 仅本次 app session 有效，不写项目仓库。
- Descriptor 文件权限必须是 owner-only，目标为 Unix `0600`。
- App 多实例时旧 descriptor 作废。
- 每 source/run 使用 token bucket 限流。
- Debug log 采样并滚动，禁止记录 code/diff/prompt。

### A5. Runtime descriptor 是 wrapper bootstrap 契约

**Finding:** `127.0.0.1:{port}` 和 bearer token 如果只写在架构图里，wrapper/CLI 会不知道如何发现 app endpoint。

**Decision:** App 启动时原子写入 `RuntimeDescriptor` 到用户运行目录。Wrapper/debug CLI 读取它，失败时提示用户启动 app 或重试，不猜固定端口。

Descriptor 至少包含：

```json
{
  "schemaVersion": "ai-partner.runtime-descriptor.v1",
  "appInstanceId": "app_20260602_0001",
  "pid": 12345,
  "port": 43172,
  "token": "runtime-token",
  "createdAt": "2026-06-02T00:00:00Z"
}
```

Rules:

- 写入采用临时文件 + rename，避免 wrapper 读到半文件。
- 权限 owner-only。
- Wrapper 读取后校验 pid/port 是否仍活着。
- App 退出时删除 descriptor。
- 启动新实例时旧 descriptor 作废。
- Token rotation 和 stale descriptor cleanup 需要测试。

### A6. Soft pause 是明确状态机，不是 UI 文案

**Finding:** “暂停”如果只写成 UI command，Rust、renderer、wrapper 会各自理解事件是否继续收、是否回放历史。

**Decision:** Soft pause。Endpoint 继续运行并校验事件，暂停期间不向 renderer emit，只保留 latest safe snapshot。恢复时只拉一次当前 snapshot，不回放历史气泡。

Pause state table:

| Area | Paused behavior |
| --- | --- |
| Ingress | 继续绑定 endpoint、校验 token/schema/rate limit/forbidden fields |
| `running/reading/editing` | 不 emit；可更新 latest safe snapshot，但不回放 |
| `waiting/error/done` | 不 emit；保留最后一个 latest safe snapshot 供 resume 拉取 |
| `done -> idle` timer | Rust timer 继续运行 |
| body queue | UI hidden 时不播放；resume 后只根据当前 snapshot 重新解析 |
| `resume` | renderer 调 `get_current_state`，不回放历史事件 |
| `clear_error` | 回 `idle` |

### A7. 单 run UI 仍需要 active run 仲裁

**Finding:** 多 run 聚合 UI 不进 MVP，但 wrapper 可能交错发多个 run 的状态。单 run UI 也必须有 Rust 端仲裁规则。

**Decision:** Rust state store 维护 `activeRunId`。

Rules:

- 新 run 的 `running/reading/editing/waiting` 可抢占 active run。
- 旧 run 的 `done/error` 不得覆盖新的 active run，除非旧 run 仍是 `activeRunId`。
- 事件按 `timestamp` 和接收顺序做保守仲裁；明显过旧事件进入 debug log，不更新 snapshot。
- Dedupe cache 使用 TTL/LRU 上限。
- 多 run 聚合 UI 仍明确不在 MVP。

### A8. Tauri spike 必须有 pass/fail 标准

**Finding:** “做窗口 spike”不足以消除桌面壳风险。透明、置顶、不抢焦点、click-through 恢复是产品硬门槛。

Pass/fail:

| Check | Pass criteria | If fail |
| --- | --- | --- |
| 透明无边框 | macOS 可显示透明背景，无明显黑边 | 调整 Tauri config；若不可修复，重评 Electron |
| 不抢焦点 | 打字中的 app 不被 companion 抢焦点 | 降级为 focusable false / quiet mode；仍失败则重评窗口方案 |
| 拖动互动 | 伴侣可拖动，workflow bubble 不丢 | 使用自管位置更新替代 `startDragging()` |
| Click-through 恢复 | 安静穿透模式可通过托盘/快捷键恢复 | 若不可恢复，MVP 不启用 click-through |
| Spaces/fullscreen | 不破坏全屏/Spaces 基础工作流 | 记录限制并默认不覆盖全屏 |
| CSS sprite | frame 对齐、透明边缘、bubble 不重叠 | 修 renderer，不能带着抖动进入 M1 |

## Code Quality Review

### Q1. Canonical 状态和 legacy 资产名分层

**Finding:** Petdex 行名容易污染产品状态模型。

**Decision:** 代码里只允许以下 canonical 状态作为业务状态：

```text
workflow: idle | running | reading | editing | waiting | error | done
physical: normal | carried | struggling | falling | recovering
```

`legacy.waving`、`legacy.jumping`、`legacy.running-left/right` 只能出现在 adapter/fallback 层。

### Q2. Contracts 必须独立成包

**Finding:** Rust、frontend、resolver、CLI/wrapper 都会碰 contracts。如果放在 `src/shared/` 或多语言各写一份，状态枚举和 casing 很容易漂移。

**Decision:** `packages/contracts/` 是 source of truth。

Contents:

```text
packages/contracts/
  schema/
    workflow-event.schema.json
    partner-state-snapshot.schema.json
    animation-intent.schema.json
    runtime-descriptor.schema.json
  fixtures/
    valid/
    invalid/
  src/
    workflow.ts
    snapshot.ts
    animation.ts
    runtimeDescriptor.ts
    casing.ts
```

Rules:

- Wire payload 可以是 snake_case；domain object 可以是 camelCase；转换边界集中在 contracts。
- 所有 wire contracts 带 `schemaVersion`。
- Rust/TS/wrapper 都跑同一组 fixture。

### Q3. `done` 生命周期单一归属

**Finding:** `done` 有两个 timer：workflow `done -> idle` 和 physical 抢占后的 body queue。混在 Rust/resolver/UI 多处会导致旧庆祝晚播或状态漂移。

**Decision:** Rust 管 workflow `done -> idle` 的 3 秒 timer。Resolver/UI 管 body queue 和 5 秒丢弃。

Tests:

- Rust state store test：`done` 3 秒后回 `idle`。
- Resolver test：physical 非 normal 时 queue `workflow.done`，5 秒没机会播放则丢弃。
- UI test：后端已 idle 时不播放过期 done。

### Q4. Physical transition 单独成 reducer

**Finding:** `carried -> struggling -> falling -> recovering -> normal` 不是一个布尔值。写进 renderer component 会混入 pointer、timer、DOM 和动画细节。

**Decision:** 新增 `physicalStateMachine` / reducer。Renderer 输入 pointer/drag events，reducer 输出 semantic physical state，resolver 只消费最终状态。

Performance rule:

- 拖动坐标走 ref + `requestAnimationFrame` + CSS transform。
- 只有 physical semantic transition 才触发 resolver。
- Bubble layout 不参与每帧坐标计算。

### Q5. PartnerCapabilities 集中定义

**Finding:** Asset loader 和 resolver 之间缺明确能力接口，容易散落 legacy 字符串和 fallback 表。

**Decision:** `AnimationRef`、`PartnerCapabilities`、Petdex constants、fallback table 放同一模块。

Sketch:

```ts
type AnimationRef = `workflow.${string}` | `physical.${string}` | `legacy.${string}`;

interface PartnerCapabilities {
  partnerId: string;
  base: PetdexAtlasContract;
  animations: Record<AnimationRef, AnimationTimeline>;
  fallbacks: Record<AnimationRef, AnimationRef[]>;
  runtimeLimits: AssetRuntimeLimits;
}
```

## Test Review

测试策略采用 D4：完整测试矩阵。

### Test Framework Plan

项目还没有应用代码。初始化时采用：

- Contracts：JSON Schema fixtures + TS schema tests + Rust serde fixture tests。
- Rust backend：`cargo test`，必要时加 `proptest`。
- Frontend/resolver：Vitest + Testing Library。
- E2E/视觉：Playwright 跑 webview 可测部分，Tauri 壳补手测和平台脚本。
- Asset validator：自定义 CLI，校验 `pet.json`、atlas 尺寸、cell、行数、manifest、path sandbox、runtime budget。
- Security：localhost、token、descriptor、payload、状态白名单、文本长度、速率限制。
- Packaging：DMG smoke gate。
- LLM eval：MVP 不启用大模型；后续一旦改 prompt、工具定义、记忆策略，必须加 eval。

### Coverage Diagram

```text
CODE PATHS                                             USER FLOWS
[+] Contracts/schema                                   [+] First launch desktop companion
  ├── [DONE] WorkflowEvent valid/invalid fixtures         ├── [DONE] [->E2E/manual] default partner visible
  ├── [DONE] PartnerStateSnapshot fixtures                ├── [DONE] [->E2E/manual] no focus stealing
  ├── [DONE] AnimationIntent fixtures                     └── [DONE] [->E2E/manual] tray/shortcut recovery
  ├── [DONE] RuntimeDescriptor fixtures
  └── [DONE] snake_case <-> camelCase boundary

[+] Runtime descriptor                                 [+] Codex run visible on desktop
  ├── [GAP] atomic write + 0600 permissions               ├── [GAP] [->E2E] running -> reading -> editing -> done
  ├── [GAP] stale pid/port rejected                       ├── [GAP] waiting requires user attention
  ├── [GAP] token rotation                                ├── [GAP] error is visible and clearable
  └── [GAP] wrapper discover failure UX                   └── [GAP] pause prevents event spam on resume

[+] Rust ingress + state store                         [+] Drag and physical interaction
  ├── [GAP] auth/localhost/CORS/origin                    ├── [GAP] carried -> struggling -> falling -> recovering
  ├── [GAP] payload 4KB + forbidden fields                ├── [GAP] [->E2E] waiting bubble survives drag
  ├── [GAP] duplicate event id + TTL/LRU                  └── [GAP] done body celebration expires after 5s
  ├── [GAP] 10 events/s burst 30 rate budget
  ├── [DONE] message newline/length rejection
  ├── [DONE] activeRunId arbitration
  ├── [DONE] done -> idle after 3s
  ├── [DONE] error persists until clear
  └── [DONE] get_current_state/pause/resume/clear_error

[+] Tauri bridge + renderer                            [+] Partner selection
  ├── [PARTIAL] state event emitted by Rust               ├── [GAP] corrupt asset shows default partner
  ├── [GAP] renderer subscription pulls current snapshot  ├── [GAP] search/switch local partner
  ├── [GAP] CSS frame + bubble/source badge visual        └── [GAP] exit requires confirmation
  ├── [GAP] physicalStateMachine reducer
  └── [DONE] M0 integer scale/frame alignment

[+] TypeScript resolver                                [+] Desktop shell
  ├── [GAP] workflow normal mappings                      ├── [GAP] [->E2E/manual] transparent window
  ├── [GAP] physical body override                        ├── [GAP] [->E2E/manual] always on top behavior
  ├── [GAP] waiting/error bubble priority                 ├── [GAP] click-through quiet mode can recover
  ├── [GAP] done queued under physical                    └── [GAP] multi-display/high-DPI sanity
  └── [GAP] extension -> legacy -> procedural fallback

[+] Asset loader + validator                           [+] macOS internal build
  ├── [GAP] pet.json required fields                      ├── [GAP] [->E2E/manual] DMG install launches
  ├── [GAP] spritesheet exists                            ├── [GAP] debug CLI can reach endpoint
  ├── [GAP] 1536x1872 atlas                               └── [GAP] diagnostic logs do not leak code
  ├── [GAP] 192x208 runtime frame
  ├── [GAP] optional ai-partner.animations.json
  ├── [GAP] root sandbox/path traversal/symlink reject
  └── [GAP] extras max 32 frames, fps 1-24

[+] Codex wrapper
  ├── [GAP] classifier fixtures: running/reading/editing/waiting/error/done
  ├── [GAP] structured signal priority
  ├── [GAP] stdout/stderr conservative fallback
  ├── [GAP] unknown -> running
  └── [GAP] no code/diff/prompt sent

LLM integration: [NOT MVP] [->EVAL] only when opt-in LLM or memory ships

COVERAGE NOW: M0 + contracts + minimal Rust State Bridge paths are tested; ingress, descriptor runtime behavior, renderer, resolver, assets, wrapper and packaging remain planned gaps
TARGET: 60/60 planned before MVP acceptance
QUALITY TARGET: contracts/security/resolver/assets/wrapper need behavior + edge + error tests
```

Legend:

```text
[->E2E] = integration or desktop/manual verification required
[->EVAL] = prompt or LLM behavior eval required
```

### Test Requirements

1. `packages/contracts` fixtures cover all wire schemas, invalid payloads, `schemaVersion`, casing conversion and runtime descriptor.
2. Rust serde/schema tests consume the same fixtures as TypeScript.
3. Runtime descriptor tests cover atomic write, permissions, stale pid/port, token rotation and wrapper discovery failure.
4. `event_ingress` Rust tests cover auth, localhost binding, CORS/origin, payload limit, forbidden fields, duplicate event id, rate budget and debounce.
5. `state_store` Rust tests cover activeRunId arbitration, stale events, soft pause, resume snapshot, `clear_error -> idle`, done timer and error persistence.
6. Tauri bridge integration covers state event delivery and `get_current_state` after startup/reopen.
7. `physicalStateMachine` tests cover carried, struggling, falling, recovering, normal and abnormal reset.
8. `resolver.test.ts` covers every workflow x physical priority case in the design matrix.
9. `resolver.test.ts` covers `done` queue and 5 second expiry.
10. `asset_loader.test.ts` covers missing `pet.json`, missing spritesheet, wrong atlas size, wrong cell size, extension fallback, path escape and symlink rejection.
11. Component tests cover bubble placement, source badge, selector open/search/switch, pause/resume and exit confirmation.
12. E2E/manual script covers transparent window, focus behavior, drag, click-through recovery, full-screen/Spaces and high-DPI.
13. Codex wrapper tests cover classifier fixtures, structured priority, stdout/stderr fallback, unknown fallback and no code/diff/prompt sent.
14. DMG smoke test covers default partner visible, local endpoint reachable, no focus stealing.

### Release Gates

| Gate | Runs where | Blocks |
| --- | --- | --- |
| CI gate | contracts, Rust unit, TS unit, wrapper fixtures, asset validator | Any code merge |
| Manual desktop gate | Tauri window spike, focus/Spaces/click-through/high-DPI matrix | M0 acceptance and release |
| DMG smoke gate | install launch, default partner visible, endpoint reachable, no focus stealing | M5 acceptance |
| Privacy gate | forbidden fields, no code/diff/prompt logs, descriptor permissions | M1/M4/M5 |

## Performance Review

### P1. Event flood and animation flicker

**Finding:** AI wrappers can emit frequent logs. If every event immediately changes animation, the companion flickers. If ingress has no hard budget, Rust validation, dedupe and debug logs can still be flooded.

**Decision:** Keep per-`run_id` 300ms coalescing in Rust state service and only emit state snapshots when canonical state or bubble text changes. Add ingress budget: each run allows 10 events/s with burst 30; over budget keeps only latest state.

Implementation details:

- Per-source/per-run token bucket.
- `event_id` cache uses TTL/LRU.
- Tauri event queue is latest snapshot wins.
- Debug log is sampled and rolled over.

### P2. CSS sprite is right-sized for MVP

**Finding:** Petdex base atlas is fixed and small enough for DOM sprite rendering. Canvas or game engine is not needed.

**Decision:** Use CSS background-position with stable frame dimensions. Add visual tests for transparent edge, frame alignment, source badge and bubble non-overlap.

### P3. Large partner lists need bounded UI work

**Finding:** Business requirements mention local partner search and smooth browsing, but MVP should not build an asset marketplace.

**Decision:** MVP scans one user-configured assets root only.

Rules:

- Limit scan depth.
- Metadata scan does not decode images.
- Cache invalidates by path + mtime + size.
- UI list uses hard cap or pagination.
- Reject path traversal, absolute manifest paths and escaping symlinks.

### P4. Asset runtime budgets

**Finding:** `extras/` PNG frame sequence can cause decode, memory and packaging bloat if unconstrained.

**Decision:** MVP v1 runtime accepts max 32 frames per animation, frame size 192x208, fps 1-24. This is a runtime budget, not a long-term source asset rule.

Rules:

- Current partner base atlas eager-loads.
- Extension animations lazy-load.
- Switching partners releases old decoded frames.
- Future high-resolution assets require new schema/version and tests.

### P5. High-DPI and package budgets

**Decision:** Prefer integer scaling, with fixed scale presets if needed. Ship one default Petdex-compatible companion in the DMG.

Budgets:

- Default asset count: 1.
- Runtime frame: 192x208 in MVP v1.
- Diagnostic logs must roll over and never include code/diff/prompt.
- DMG smoke must validate install and first-run behavior.

## System Architecture

```text
Codex wrapper / debug CLI
  |
  | read RuntimeDescriptor from user runtime dir
  |   - port
  |   - token
  |   - appInstanceId
  v
POST http://127.0.0.1:{port}/events
Authorization: Bearer <runtime-token>
  |
  v
Rust local event ingress
  |
  | validate source, token, schema, whitelist, payload size
  | CORS/origin reject, forbidden fields, rate limit
  | dedupe event_id, coalesce per run_id
  v
Rust state service
  |
  | owns workflowState, activeRunId, message, pause/error/done timers
  | exposes get_current_state and control commands
  | writes latest safe snapshot
  v
Tauri event bus
  |
  | emits PartnerStateSnapshot when not paused
  v
Frontend app
  |
  +--> physicalStateMachine
  +--> asset loader -> PartnerCapabilities
  +--> TypeScript animation resolver
          |
          v
      AnimationIntent
          |
          v
      CSS/DOM sprite + bubble/status overlay
```

## Data Contracts

### WorkflowEvent

```json
{
  "schemaVersion": "ai-partner.workflow-event.v1",
  "event_id": "evt_20260602_0001",
  "source": "codex-wrapper",
  "run_id": "run_abc123",
  "workflow_state": "reading",
  "timestamp": "2026-06-02T00:00:00Z",
  "message": "正在读取项目内容",
  "code_context_allowed": false
}
```

Rules:

- `source`: `cli`、`codex-wrapper`、`demo-script` only in MVP.
- `workflow_state`: `idle | running | reading | editing | waiting | error | done`.
- `message`: optional, max 160 chars after newline removal.
- `code_context_allowed`: must be `false` in MVP.
- Forbidden fields: `file_content`、`code`、`diff`、`prompt`、`screen_text`、`clipboard`.

### PartnerStateSnapshot

```json
{
  "schemaVersion": "ai-partner.partner-state-snapshot.v1",
  "workflowState": "reading",
  "runId": "run_abc123",
  "activeRunId": "run_abc123",
  "source": "codex-wrapper",
  "message": "正在读取项目内容",
  "priority": "normal",
  "updatedAt": "2026-06-02T00:00:00Z",
  "paused": false,
  "connection": "ok"
}
```

### AnimationIntent

```json
{
  "schemaVersion": "ai-partner.animation-intent.v1",
  "body": {
    "animation": "legacy.review",
    "procedural": [],
    "loop": true
  },
  "bubble": {
    "state": "reading",
    "text": "正在读取项目内容",
    "priority": "normal"
  },
  "queued": []
}
```

### RuntimeDescriptor

```json
{
  "schemaVersion": "ai-partner.runtime-descriptor.v1",
  "appInstanceId": "app_20260602_0001",
  "pid": 12345,
  "port": 43172,
  "token": "runtime-token",
  "createdAt": "2026-06-02T00:00:00Z"
}
```

## Asset Contract

基础兼容层固定为 Petdex/hatch-pet 输入契约：

```text
pet.json
spritesheet.webp
```

```text
atlas: 1536x1872
grid: 8 columns x 9 rows
cell: 192x208
```

行顺序：

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

这只是基础兼容层，不是长期产品语义。后续泛化通过 `ai-partner.animations.json`：

```text
ai-partner.animations.json
extras/
  workflow-done/
  physical-struggling/
  physical-falling/
  physical-recovering/
```

MVP v1 runtime limits:

- 每段扩展动画最多 32 帧。
- 运行帧固定 192x208。
- fps 1-24。
- Source asset 可以更高分辨率；v2 schema 再放宽运行规格。
- Manifest 只允许 companion root 内相对路径。
- 拒绝 `..`、绝对路径和逃逸 symlink。

## Implementation Milestones

### M0: Window Spike and Contracts

目标：先验证桌面壳和冻结协议。

Status 2026-06-03：M0 window spike acceptance 已通过。透明无边框、置顶、不抢焦点、拖动、click-through 恢复、Spaces/fullscreen、CSS sprite frame alignment 均有验证记录；contracts/schema/fixtures 已在 `packages/contracts/` 建立并通过 TS/Rust fixture tests。

Tasks:

- 创建 Tauri v2 + React + TypeScript + Rust 项目骨架。
- 验证透明、无边框、置顶、不抢焦点、拖动、click-through 恢复。
- 验证 macOS Spaces/fullscreen/Mission Control 行为。
- 验证 CSS sprite 渲染 Petdex atlas 的透明边缘和帧对齐。
- 创建 `packages/contracts/`。
- 定义 `WorkflowEvent`、`PartnerStateSnapshot`、`AnimationIntent`、`RuntimeDescriptor` schema 和 fixtures。

Acceptance:

- Spike pass/fail 表每项都有结果：可行、降级方案或必须重评 Electron。
- Schema 进入代码并有 shared fixtures。
- Runtime descriptor bootstrap 方案可由 fixture 测试。

### M1: Rust State Bridge

目标：外部事件进来，Rust 变成状态快照。

Status 2026-06-03：已完成并复核最小内存 State Bridge 第一片：Rust `PartnerStateStore`、Tauri commands（`get_current_state`、`apply_workflow_event`、`pause`、`resume`、`clear_error`）、`partner-state-changed` event emit、done -> idle timer、active run 仲裁、pause/resume、error clear、schema/id/timestamp/message/code-context 校验和 stale timestamp 拒绝。Rust tests 已覆盖这些最小状态桥边界。尚未实现 localhost ingress、runtime descriptor、debug CLI、Codex wrapper、完整 renderer 或完整 asset loader。

Tasks:

- `POST /events` 只监听 `127.0.0.1`。
- runtime token 认证。
- Runtime descriptor 原子写入、权限、stale cleanup。
- schema validation、白名单、payload 4KB、forbidden fields。（最小 State Bridge 已做 Rust command 入参的 schemaVersion/id/timestamp/message/code_context_allowed 校验；完整 ingress 仍需 JSON Schema/payload/security gate。）
- CORS/origin reject。
- event id 去重，TTL/LRU。（未做，留给 ingress slice。）
- Per-run 300ms debounce。
- Per-run 10 events/s、burst 30 rate limit。
- `activeRunId` 仲裁。（最小 State Bridge 已做。）
- Soft pause latest safe snapshot。（最小 State Bridge 已做。）
- `get_current_state`、`pause`、`resume`、`clear_error` commands。（最小 State Bridge 已做。）
- Rust 管 workflow `done -> idle` timer。（最小 State Bridge 已做，pause/resume 不取消 timer。）
- Tauri event 推送 `PartnerStateSnapshot`。（最小 State Bridge 已做。）

Acceptance:

- Rust tests 覆盖 security、descriptor、state transition、active run、pause/resume 和 rate budget。（当前仅 state transition / active run / pause-resume / done timer / command payload privacy validation 已覆盖；descriptor、auth、payload limit、dedupe、rate budget 仍待完整 ingress slice。）
- CLI 能发出所有 workflow 状态。

### M2: Frontend Partner Window

目标：renderer 显示状态，不负责外部连接。

Tasks:

- 订阅 Tauri state event。
- 启动和恢复时调用 `get_current_state`。
- CSS/DOM sprite renderer。
- bubble/status/source badge overlay。
- `physicalStateMachine` / reducer。
- drag pointer 坐标用 ref + rAF + CSS transform。
- 右键菜单：暂停、恢复、切换伴侣、退出确认。
- 整数缩放和固定 scale preset。

Acceptance:

- Mock snapshot 能驱动伴侣状态变化。
- 拖动不丢 workflow bubble。
- Renderer 不因 pointermove 每帧重跑 resolver。

### M3: Resolver and Asset Loader

目标：没有扩展动画也不空白。

Tasks:

- `resolveAnimation(snapshot, physicalState, capabilities)`。
- `AnimationRef`、`PartnerCapabilities`、Petdex constants、fallback table 集中定义。
- extension -> legacy -> procedural fallback。
- `waiting/error` bubble 最高优先级。
- `done` body queue 和 5 秒过期。
- Petdex `pet.json + spritesheet.webp` loader。
- Atlas 尺寸和 cell 校验。
- One assets root scan。
- Path sandbox、symlink reject、runtime budget validation。

Acceptance:

- Resolver 矩阵全测。
- 损坏或越界资产 fallback 到默认伴侣。

### M4: Codex Wrapper MVP

目标：真实 Codex 工作流自动产生至少 3 类状态。

Tasks:

- Wrapper 读取 `RuntimeDescriptor`。
- Wrapper 启动发 `running`。
- 结构化信号优先识别 `reading/editing/waiting`。
- stdout/stderr 只做保守白名单 fallback。
- 未知阶段降级为 `running`。
- 非 0 退出发 `error`。
- 0 退出发 `done`。
- 分类置信度写 debug log，不记录 code/diff/prompt。

Acceptance:

- 一次真实 Codex run 能驱动桌面伴侣至少 3 类 workflow 变化。
- Wrapper 不发送代码内容、diff、prompt。
- Fixture corpus 覆盖分类和隐私边界。

### M5: macOS Internal Build

目标：可交付本机内测包。

Tasks:

- macOS app/dmg build。
- 1 个默认 Petdex 兼容伴侣随包。
- 本地诊断日志和 rollover。
- GitHub Releases 预留 artifact 上传。
- Windows build 只做后续 lane，不承诺同等体验。
- DMG smoke gate。

Acceptance:

- DMG 可安装运行。
- 首次启动默认伴侣可见。
- Debug CLI 能到达本地 endpoint。
- 不抢当前输入焦点。
- 签名/公证风险列入 release checklist。

## Failure Modes

| Codepath | Production failure | Test | Handling | User sees |
| --- | --- | --- | --- | --- |
| Runtime descriptor | Wrapper 读到旧 port/token | descriptor stale tests | 拒绝 stale descriptor，提示启动 app | 看到连接失败提示 |
| `POST /events` | 外部来源刷状态 | auth/local/security tests | 拒绝并 debug log | 无打扰 |
| event validation | 插件发送代码或 diff | forbidden fields tests | 拒绝事件 | 无代码泄露 |
| rate limit | 高频日志打满 ingress | token bucket tests | 只保留 latest state | 动作稳定 |
| debounce | 高频状态导致动画闪烁 | debounce tests | 300ms 合并 | 动作稳定 |
| active run | 旧 run 完成覆盖新 run | interleaved run tests | 旧 run suppressed | 不显示过期完成 |
| soft pause | 恢复时历史气泡刷屏 | pause/resume tests | 不回放，只拉 latest | 恢复后稳定 |
| done workflow timer | done 长期停留 | Rust timer tests | 3 秒回 idle | 完成后安静 |
| done body queue | 过期庆祝晚播 | resolver timer tests | 5 秒后丢弃 queue | 不出现旧任务庆祝 |
| waiting bubble | 拖动覆盖等待提示 | resolver + E2E | bubble 保留 workflow | 仍看到等待确认 |
| asset loader | atlas 尺寸错误 | asset tests | fallback 默认伴侣 | 看到资产错误提示 |
| asset sandbox | manifest 路径逃逸 | path/symlink tests | 拒绝资产 | 看到资产错误提示 |
| renderer | CSS frame 偏移 | screenshot test | 固定 cell + visual test | 动作不抖 |
| window focus | 桌面伴侣抢焦点 | spike/manual | focusable 降级策略 | 不打断输入 |
| click-through | 安静模式无法恢复互动 | spike/manual | 托盘/快捷键恢复 | 可恢复控制 |
| Codex wrapper | 状态识别误判 | classifier fixtures | unknown -> running + debug log | 不显示代码内容 |
| DMG install | 能 build 但不可用 | DMG smoke gate | 阻塞 M5 acceptance | 不发布坏包 |

Critical gaps after review: none. Implementation cannot pass MVP until tests and gates above exist.

## NOT in Scope

- 完整聊天伴侣：先做状态反馈层，避免主线偏到聊天体验。
- 大模型私人秘书：需要授权、数据范围和记忆治理，不进 MVP。
- 长期人格和关系系统：先预留状态维度，不实现成长模型。
- 多 AI 助手全接入：先 Codex wrapper，其他 adapter 后续复用协议。
- 多 run 聚合 UI：MVP 只显示最近活跃 run；Rust active run 仲裁仍在 scope。
- 资产市场：先单 assets root 本地导入。
- 动画编辑器：先静态 manifest。
- Live2D/Spine/Rive：MVP 固定 Petdex atlas + CSS sprite。
- 高分辨率 runtime asset：source asset 可更高，MVP v1 runtime frame 仍固定 192x208。
- Windows 体验对等发布：MVP 先 macOS，Windows 后置。
- Mac App Store：透明窗口 private API 风险未解，先 direct DMG。

## TODO Candidates

### TODO-1: 调整 BRD 首版对外口径

What: 把 [ai-desktop-partner-business-requirements.md](ai-desktop-partner-business-requirements.md) 的首版口径改成 “macOS Codex technical preview / AI status companion”，并把多 AI、陪伴模式、深度互动、记忆、Windows 等标为 roadmap。

Why: 工程计划锁定的是 macOS + Codex + 状态反馈层 MVP。BRD 面向产品、销售、客户成功，如果继续把 roadmap 能力写在核心功能总览里，容易被误读为首版承诺。

Pros: 对外沟通和工程交付一致，减少 demo/内测时期的承诺错位。

Cons: 需要另开文档编辑轮，不能在这份工程计划里替代 BRD。

Context: Outside voice 指出业务需求功能表比 MVP 宽。用户选择将此作为 TODO，而不是本轮直接修改 BRD。

Depends on / blocked by: 无；建议在第一版实现前完成。

## Parallel Worktree Strategy

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Window spike | `src-tauri/`, `frontend/` | - |
| Contracts | `packages/contracts/` | - |
| Rust state bridge | `src-tauri/` | Contracts |
| Frontend window | `frontend/` | Window spike, Contracts |
| Resolver | `packages/resolver/` or `frontend/` | Contracts |
| Physical state machine | `frontend/` or `packages/interaction/` | Contracts |
| Asset loader | `packages/assets/` or `frontend/` | Contracts |
| Codex wrapper | `scripts/`, `cli/`, maybe `src-tauri/` | Rust state bridge, Contracts |
| Build/release | `.github/`, `src-tauri/` | Window spike |

Parallel lanes:

```text
Lane A: Window spike -> Build/release
Lane B: Contracts -> Rust state bridge -> Codex wrapper
Lane C: Contracts -> Resolver -> Asset loader
Lane D: Contracts -> Physical state machine -> Frontend window
```

Execution order:

```text
1. Start Lane A and Contracts first.
2. After contracts freeze, launch Lane B + C + D in parallel worktrees.
3. Merge Rust state bridge + resolver + frontend.
4. Add Codex wrapper.
5. Build macOS DMG and run smoke gate.
```

Conflict flags:

- Lane C and Lane D both touch frontend modules. Keep resolver/assets in separate packages or modules and make frontend consume them by interface.
- Lane A and Lane D both touch Tauri/window behavior. Keep spike branch short and merge before large UI work.
- Lane B and M4 wrapper both depend on RuntimeDescriptor; do not start wrapper implementation until descriptor fixtures are locked.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Codex or Claude Code; checkbox as you ship.

- [ ] **T1 (P1, human: ~1 day / CC: ~30 min)** - Desktop shell - Run Tauri window spike with pass/fail gates
  - Surfaced by: Architecture Review A1/A8
  - Files: `src-tauri/`, `frontend/`
  - Verify: manual macOS matrix for transparent, focus, drag, click-through, Spaces
- [ ] **T2 (P1, human: ~4h / CC: ~25 min)** - Contracts - Create `packages/contracts/` with schemas, versions and fixtures
  - Surfaced by: Code Quality Q2, Test Review
  - Files: `packages/contracts/`
  - Verify: schema fixture tests in TS and Rust
- [ ] **T3 (P1, human: ~3h / CC: ~20 min)** - Runtime descriptor - Implement app endpoint bootstrap for wrapper/CLI
  - Surfaced by: Architecture Review A5
  - Files: `packages/contracts/`, `src-tauri/`, `scripts/` or `cli/`
  - Verify: descriptor atomic write, permission, stale cleanup and discover failure tests
- [ ] **T4 (P1, human: ~1 day / CC: ~45 min)** - Rust bridge - Build secure localhost event ingress and state store
  - Surfaced by: Architecture Review A4/A6/A7, Performance P1
  - Files: `src-tauri/`
  - Verify: `cargo test` for auth, rate limit, active run, pause/resume, timers
- [ ] **T5 (P1, human: ~1 day / CC: ~45 min)** - Resolver - Implement pure TypeScript animation resolver
  - Surfaced by: Architecture Review A3, Code Quality Q1/Q3/Q5
  - Files: `packages/resolver/` or `frontend/`
  - Verify: `vitest resolver`
- [ ] **T6 (P1, human: ~4h / CC: ~20 min)** - Physical interaction - Implement `physicalStateMachine`
  - Surfaced by: Code Quality Q4, Performance P2
  - Files: `frontend/` or `packages/interaction/`
  - Verify: reducer tests and drag does not rerun resolver per frame
- [ ] **T7 (P1, human: ~1 day / CC: ~45 min)** - Assets - Implement Petdex thin import, validator and fallback
  - Surfaced by: Code Quality Q5, Performance P3/P4
  - Files: `packages/assets/` or `frontend/`
  - Verify: asset validator tests for dimensions, path sandbox, symlinks and runtime budgets
- [ ] **T8 (P1, human: ~1 day / CC: ~45 min)** - Frontend - Render partner with CSS/DOM sprite and bubble overlay
  - Surfaced by: Code Quality Q3, Performance P2/P5
  - Files: `frontend/`
  - Verify: component tests + screenshot sanity + integer scale checks
- [ ] **T9 (P1, human: ~1 day / CC: ~45 min)** - Codex wrapper - Emit real workflow events without code content
  - Surfaced by: Architecture Review A4, Test Review, Outside Voice
  - Files: `scripts/`, `cli/` or `src-tauri/`
  - Verify: integration fixture drives 3+ workflow states, no code/diff/prompt sent
- [ ] **T10 (P2, human: ~1 day / CC: ~30 min)** - Release - Produce macOS app/dmg internal build
  - Surfaced by: Distribution Check, Test Review
  - Files: `src-tauri/`, `.github/`
  - Verify: Tauri build, install smoke, endpoint reachable, no focus stealing
- [ ] **T11 (P3, human: ~1h / CC: ~10 min)** - Product docs - Align BRD first-version messaging with MVP scope
  - Surfaced by: Outside Voice
  - Files: `docs/ai-desktop-partner-business-requirements.md`, `TODOS.md`
  - Verify: BRD labels non-MVP capabilities as roadmap

## Completion Summary

- Step 0: Scope Challenge - scope accepted as-is: phased complete MVP
- Architecture Review: 8 issues found, 2 user decisions, 6 plan clarifications
- Code Quality Review: 5 issues found, 3 user decisions, 2 plan clarifications
- Test Review: diagram produced, 26 additional gaps identified and added
- Performance Review: 5 issues found, 5 user decisions
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user and accepted
- Failure modes: 0 critical gaps after plan updates
- Outside voice: ran via subagent; Codex CLI failed due local state DB permission in read-only sandbox
- Parallelization: 4 lanes, 3 parallel after contracts / 1 sequential release lane
- Lake Score: 15/15 recommendations chose complete option

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | - | Not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | DONE_WITH_CONCERNS | Codex CLI unavailable; subagent outside voice found 8 issues, all resolved or captured |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 15 decisions locked, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | RECOMMENDED | UI/window behavior exists, run before visual implementation |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | OPTIONAL | Not needed before M0/M1 |

- **CODEX:** Codex CLI outside voice failed in read-only sandbox because it could not write its local state DB; fallback subagent ran.
- **CROSS-MODEL:** Outside voice agreed on descriptor, pause, active run, wrapper classifier, asset limits and release gates; added Tauri spike pass/fail and BRD TODO.
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED - ready to implement M0 window spike and `packages/contracts/`.
