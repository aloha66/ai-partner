# AI 桌面伴侣工程实现计划

日期：2026-06-02
状态：M0/contracts/M1-M5 最小 MVP 技术预览闭环已完成；当前无 active TODO
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
| Click-through 恢复 | 安静穿透模式可通过后端自动恢复或已注册快捷键恢复 | 若不可恢复，MVP 不启用 click-through |
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
  ├── [DONE] atomic write + 0600 permissions              ├── [DONE] [->E2E] running -> reading -> editing -> done
  ├── [DONE] stale pid/port rejected                      ├── [DONE] waiting requires user attention
  ├── [DONE/M5.5-T2] token rotation on restart            ├── [DONE] error is visible and clearable
  ├── [DONE/M5.5-T2] quit/restart rejects old endpoint    └── [DONE] pause prevents event spam on resume
  └── [DONE/T9] wrapper descriptor discovery

[+] Rust ingress + state store                         [+] Drag and physical interaction
  ├── [DONE] auth/localhost/CORS/origin                   ├── [DONE/front slice] carried -> struggling -> falling -> recovering
  ├── [DONE] payload 4KB + forbidden fields               ├── [DONE/model] waiting bubble survives drag
  ├── [DONE] duplicate event id + TTL/LRU                 └── [DONE/model] done body celebration expires after 5s
  ├── [DONE] 10 events/s burst 30 rate budget
  ├── [DONE] message newline/length rejection
  ├── [DONE] activeRunId arbitration
  ├── [DONE] done -> idle after 3s
  ├── [DONE] error persists until clear
  └── [DONE] get_current_state/pause/resume/clear_error

[+] Tauri bridge + renderer                            [+] Partner selection
  ├── [DONE] state event emitted by Rust                  ├── [DONE/model] corrupt asset falls back to default partner
  ├── [DONE] renderer subscription pulls current snapshot ├── [ROADMAP/NOT MVP] search/switch local partner
  ├── [DONE] minimal bubble/source/status visual          └── [ROADMAP/NOT MVP] exit requires confirmation
  ├── [DONE/front slice] physicalStateMachine reducer
  ├── [DONE/T8] CSS/DOM sprite + default Petdex/probe intent mapping
  ├── [DONE/T8] 520x360 screenshot/layout sanity
  └── [DONE] M0 integer scale/frame alignment

[+] TypeScript resolver                                [+] Desktop shell
  ├── [DONE/front slice] workflow normal mappings         ├── [DONE/M0] [->E2E/manual] transparent window
  ├── [DONE/front slice] physical body override           ├── [DONE/M0] [->E2E/manual] always-on-top behavior
  ├── [DONE/front slice] waiting/error bubble priority    ├── [DONE] click-through quiet mode can recover
  ├── [DONE/front slice] done queued under physical       ├── [DONE/M5.5-T3] Retina/high-DPI manual smoke
  │                                                        └── [ROADMAP/RISK] external multi-display experience
  ├── [DONE/front slice] frontend queued done replay
  └── [DONE/front slice] extension -> legacy -> procedural fallback

[+] Asset loader + validator                           [+] macOS internal build
  ├── [DONE/front slice] pet.json required fields         ├── [DONE/M5] DMG install launches packaged app
  ├── [DONE/front slice] spritesheet exists               ├── [DONE/M5] debug CLI reaches packaged endpoint
  ├── [DONE/front slice] 1536x1872 atlas                  ├── [DONE/M5] runtime token omitted from docs/logs
  ├── [DONE/front slice] 192x208 runtime frame            └── [DONE/M5.5-T2] packaged quit/restart lifecycle
  ├── [DONE/front slice] optional ai-partner.animations.json
  ├── [DONE/front slice] root sandbox/path traversal/symlink reject
  └── [DONE/front slice] extras max 32 frames, fps 1-24

[+] Codex wrapper
  ├── [DONE/T9] classifier fixtures: running/reading/editing/waiting/error/done
  ├── [DONE/T9] structured signal priority
  ├── [DONE/T9] stdout/stderr conservative fallback
  ├── [DONE/T9] unknown -> running
  └── [DONE/T9] no code/diff/prompt sent

LLM integration: [NOT MVP] [->EVAL] only when opt-in LLM or memory ships

COVERAGE NOW: M0 + contracts + M1 minimal Rust State Bridge + localhost ingress/descriptor paths + debug sender/discovery + M2 minimal renderer state subscription + M3 resolver/assets front slice + T5/T7 renderer integration closeout + T6 minimal physical/renderer integration closeout + T8 minimal CSS/DOM sprite renderer + T9 minimal Codex wrapper event bridge + M5 packaged app/DMG smoke + M5.5-T1 real Codex provider live run + M5.5-T2 packaged quit/restart lifecycle + M5.5-T3 Retina/high-DPI release smoke are tested. Transparent window and always-on-top are DONE/M0. Partner search/switch, exit confirmation, full asset loader UI and external multi-display experience are ROADMAP/NOT MVP.
TARGET: MVP coverage accounted before acceptance; ROADMAP/NOT MVP rows are excluded from the MVP target
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
11. Component tests cover bubble placement, source badge and pause/resume. Selector open/search/switch and exit confirmation tests start when those roadmap UI surfaces enter MVP scope.
12. E2E/manual script covers transparent window, focus behavior, drag, click-through recovery and full-screen/Spaces. Retina/high-DPI sanity is a release-pre manual smoke gate; external multi-display UX is a roadmap/risk note unless the MVP scope explicitly changes.
13. Codex wrapper tests cover classifier fixtures, structured priority, stdout/stderr fallback, unknown fallback and no code/diff/prompt sent.
14. DMG smoke test covers default partner visible, local endpoint reachable, no focus stealing, packaged app quit/restart lifecycle, descriptor rotation, and stale endpoint/token rejection.

### Release Gates

| Gate | Runs where | Blocks |
| --- | --- | --- |
| CI gate | contracts, Rust unit, TS unit, wrapper fixtures, asset validator | Any code merge |
| Manual desktop gate | Tauri window spike, focus/Spaces/click-through; Retina/high-DPI manual smoke before release | M0 acceptance and release |
| DMG smoke gate | install launch, default partner visible, endpoint reachable, no focus stealing, quit/restart lifecycle | M5 acceptance |
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

Release readiness:

- Retina/high-DPI sanity passed the 2026-06-09 release-pre manual smoke gate: default partner, bubble/status overlay and click-through banner were verified at active Retina scale with no clipping, blur-driven frame drift or text overlap. The banner is now rendered as an in-panel `role=status` row instead of a fixed overlay, so it stays inside the right panel footprint under Retina/WebView transparency.
- External multi-display behavior is not an MVP commitment for the macOS Codex technical preview. Treat it as a roadmap/risk note unless the release scope explicitly adds external display UX; do not keep it as an MVP gap.

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

Status 2026-06-03：已完成并复核 M1 的三片最小闭环：第一片是 Rust `PartnerStateStore`、Tauri commands（`get_current_state`、`apply_workflow_event`、`pause`、`resume`、`clear_error`）、`partner-state-changed` event emit、done -> idle timer、active run 仲裁、pause/resume、error clear、schema/id/timestamp/message/code-context 校验和 stale timestamp 拒绝；第二片是 localhost `POST /events` ingress + runtime descriptor；第三片是本地 debug sender/discovery。Ingress 只绑定 `127.0.0.1`，启动时生成 session bearer token 并写入 `${TMPDIR}/ai-partner/runtime-descriptor.json`，descriptor 使用临时文件 + rename 原子写入、Unix owner-only 权限、stale cleanup 和退出删除。Ingress gate 已覆盖 bearer auth、payload 4KB、字段白名单、forbidden fields、`code_context_allowed=false`、message 160 字/无换行、CORS preflight / `Origin` 拒绝、event id TTL/LRU 去重、per-run 300ms debounce、per-run 10 events/s burst 30 rate budget；超预算或 debounce 命中的事件仍作为 latest safe snapshot 写入 store，并通过 trailing flush 推送最新安全快照。`packages/debug-cli/` 已读取 runtime descriptor、校验 freshness、用 bearer token 发送 `cli` 来源的 `WorkflowEvent`，覆盖 `running/reading/editing/waiting/error/done`，并拒绝 code/diff/prompt/file content 等 code-context 输入。2026-06-06 已完成 T9 最小 Codex wrapper event bridge；完整 renderer、animation resolver 和完整 asset loader 仍按后续切片推进。

Tasks:

- `POST /events` 只监听 `127.0.0.1`。（已做）
- runtime token 认证。（已做）
- Runtime descriptor 原子写入、权限、stale cleanup。（已做；debug CLI discovery 已做；Codex wrapper discovery 已在 T9 读取同一 descriptor）
- schema validation、白名单、payload 4KB、forbidden fields。（已做 ingress gate + store 二次校验）
- CORS/origin reject。（已做）
- event id 去重，TTL/LRU。（已做）
- Per-run 300ms debounce。（已做）
- Per-run 10 events/s、burst 30 rate limit。（已做，超预算会更新 latest safe snapshot 并 trailing flush）
- `activeRunId` 仲裁。（最小 State Bridge 已做。）
- Soft pause latest safe snapshot。（最小 State Bridge 已做。）
- `get_current_state`、`pause`、`resume`、`clear_error` commands。（最小 State Bridge 已做。）
- Rust 管 workflow `done -> idle` timer。（最小 State Bridge 已做，pause/resume 不取消 timer。）
- Tauri event 推送 `PartnerStateSnapshot`。（最小 State Bridge 已做。）
- 本地 debug sender 读取 descriptor 并发送 `running/reading/editing/waiting/error/done`。（已做；Codex wrapper 在 T9 复用同一 discovery/sender 边界）

Acceptance:

- Rust tests 覆盖 security、descriptor、state transition、active run、pause/resume 和 rate budget。（已覆盖 M1 当前片：descriptor 写入/权限/清理、stale cleanup、auth、payload limit、origin/CORS、forbidden/unknown fields、dedupe TTL/LRU、debounce、rate budget、pause latest snapshot、state transition。）
- CLI 能发出所有 workflow 状态。（已做最小 debug sender：`pnpm debug:send <state>` / `pnpm debug:sequence` 覆盖 `running/reading/editing/waiting/error/done`。）

### M2: Frontend Partner Window

目标：renderer 显示状态，不负责外部连接。

Status 2026-06-06：已完成 M2 最小前端状态订阅 slice，并做过 live verification/follow-up。Renderer 启动时调用 `get_current_state`，订阅 Tauri `partner-state-changed` event，在现有 M0 窗口 UI 内显示 workflow state、source、message、paused 和 connection，并把 pause/resume/clear_error 接到前端按钮。`pnpm debug:send running/reading/editing/waiting/error/done`、`pnpm debug:sequence`、pause/resume latest snapshot、error clear、`done -> idle` 均已在本机 Tauri dev app 中复测。默认 520x360 下新增状态区初测裁切 runtime strip，已小幅压缩面板和 companion 尺寸后复测可见。Click-through 在 M0 人工验收仍为通过；M2 follow-up 在干净启动下确认默认布局和不抢焦点，补了入口 `pointerdown` / `mousedown` 触发、按钮 `aria-label`、后端恢复事件 `click-through-restored` 和 renderer 清 banner 闭环。当前 macOS automation 点击/截图路径仍会出现 WebView click 不触发或黑屏，不能作为真实物理手点等价证据；用户已在干净 GUI 会话中真实物理复核通过：banner 显示、点击落到底层 app、6 秒后恢复，恢复后 AI Partner 可再次点击。2026-06-06 已完成 T6 最小 physical/renderer integration 收口：`frontend/src/physicalStateMachine.ts` 作为纯 reducer 覆盖 `normal/carried/struggling/falling/recovering` 和 abnormal reset，`App.tsx` 只把现有 drag start/hold/release/cancel 转成 semantic physical state 后交给 resolver，pointermove 坐标留在 ref + rAF + Tauri window move 边界，不进入 resolver dependency；resolver/renderer tests 覆盖 `waiting/error` bubble 在 physical override 下保留 workflow 语义、queued `done` 在 recovery 后补播和新 workflow 丢弃旧 queue。2026-06-06 已完成 T8 最小 renderer 收口：CSS/DOM sprite、bubble/status/source overlay、默认 Petdex/probe atlas intent 映射和 520x360 screenshot/layout sanity，截图为 `/private/tmp/ai-partner-t8-renderer-520x360.png`。2026-06-06 已完成 T9 最小 Codex wrapper 本地 live verification；仍未做右键菜单或 partner selection。

Tasks:

- 订阅 Tauri state event。（已完成最小 slice）
- 启动和恢复时调用 `get_current_state`。（已完成最小 slice；resume command 返回 snapshot 后直接更新 UI）
- CSS/DOM sprite renderer。（已完成 T8 最小 renderer 收口）
- bubble/status/source badge overlay。（已完成最小 workflow/source/status 展示；T8 已保留 overlay 并做 520x360 sanity）
- `physicalStateMachine` / reducer。（已完成 T6 最小 physical/renderer integration 收口）
- drag pointer 坐标用 ref + rAF + Tauri window move。（已做；本轮用结构测试锁住 pointermove 不进入 resolver dependency）
- 右键菜单/控制面：暂停、恢复。（已由当前最小控制入口覆盖）
- Roadmap/NOT MVP：切换伴侣、本地伴侣搜索和退出二次确认。
- 整数缩放和固定 scale preset。

Acceptance:

- Mock snapshot 能驱动伴侣状态变化。（已由 M2 state bridge/view-model tests 覆盖；T8 已通过默认 Petdex/probe atlas intent 映射显示 CSS/DOM sprite）
- 拖动不丢 workflow bubble。（已由 resolver/renderer tests 覆盖 `waiting/error` 在 carried/struggling/falling/recovering 下只替换 body、不替换 bubble）
- Renderer 不因 pointermove 每帧重跑 resolver。（已由 App 边界测试覆盖 resolver dependency 只含 workflow/physical/queue，pointermove 只走 ref + rAF）
- Live verification：debug CLI 能驱动最小 workflow/status/source/message/paused/connection UI。（已通过；click-through 入口/恢复已小修并通过自动门禁，真实物理点击落到底层 app 已由用户在干净 GUI 会话中手动确认；T8 screenshot sanity 见 `/private/tmp/ai-partner-t8-renderer-520x360.png`）

### M3: Resolver and Asset Loader

目标：没有扩展动画也不空白。

Status 2026-06-06：已完成 M3/T5/T7 最小闭环，但完整 M3 产品面不标完成。`packages/resolver/` 新增纯 TypeScript `resolveAnimation(snapshot, physicalState, capabilities)`，集中 `AnimationRef` / `PartnerCapabilities` / Petdex legacy fallback，覆盖 workflow normal mapping、physical body override、`waiting/error` 高优先级 bubble、`done` 5 秒队列和过期丢弃、extension -> legacy -> procedural fallback；前端 resolver adapter 现在可注入 loaded capabilities 和 queued state，`App.tsx` 会保留并回传 queued `done`，resolver 在新 workflow 激活时丢弃旧 queued done，避免旧完成庆祝压过新任务。`packages/assets/` 新增 Petdex/hatch-pet thin loader/validator，集中 Petdex atlas/cell/row 常量，校验 `pet.json`、`spritesheet.webp` metadata、可选 `ai-partner.animations.json`、one assets root scan、relative path sandbox、symlink reject、runtime frame/fps/frame-count budgets，并在损坏资产时 fallback 到默认 Petdex capabilities；测试已覆盖 invalid asset -> default Petdex capabilities -> resolver 非空 intent。Frontend 只做必要 wiring：现有 probe atlas 通过 resolver intent 选择 Petdex 行，测试已覆盖 loaded canonical intent 到 Petdex/probe row、queued done replay 到 CSS/DOM sprite model，以及 physical override 下 bubble workflow 语义保留；不做 UI redesign、不做完整 asset selector。2026-06-06 已完成 T6 最小 physical/renderer integration 收口；2026-06-06 已完成 T8 最小 renderer 收口，默认 Petdex/probe atlas intent 映射、CSS/DOM sprite、bubble/status overlay 和 520x360 screenshot/layout sanity 已落地；2026-06-06 已完成 T9 最小 wrapper event bridge；仍未做 partner switch/search。

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

- Resolver 矩阵全测，并覆盖 frontend queued done replay 与新 workflow 丢弃旧 queue。
- 损坏或越界资产 fallback 到默认伴侣，并通过 resolver 非空 intent 测试。

### M4: Codex Wrapper MVP

目标：真实 Codex 工作流自动产生至少 3 类状态。

Status 2026-06-08：T9 最小 Codex wrapper event bridge 和 M5.5-T1 真实 Codex provider live run gate 均已完成。`packages/codex-wrapper/` 提供 `pnpm codex:wrap`，读取 `${TMPDIR}/ai-partner/runtime-descriptor.json`，通过 `sendWorkflowEvent` 向本机 ingress 发送 `source=codex-wrapper` 的安全 `WorkflowEvent`。Wrapper 启动发 `running`，结构化信号优先识别 `reading/editing/waiting`，stdout/stderr 使用保守 fallback，unknown 降级 `running`，0 exit 发 `done`，非 0/signal 发 `error`。发送到 ingress 的 event body 只包含 `schemaVersion/event_id/source/run_id/workflow_state/timestamp/message/code_context_allowed`，固定 `code_context_allowed=false`，不发送 prompt、code、diff 或 file content。2026-06-06 本地等价 Codex bin transcript 已完成 wrapper -> descriptor -> `POST /events` -> Tauri app fallback 回归闭环，覆盖 `running/reading/editing/waiting/done` 至少 3 类状态；2026-06-07 真实 Codex provider packaged-app live run 已在空临时目录中通过，覆盖至少 4 类 workflow 状态，且未读取仓库、未发送 prompt/code/diff/file content 到 ingress。

M5.5-T1 live provider gate record 2026-06-07：

- 起点：分支 `main`，HEAD `2785092 docs(plan): reconcile mvp task status`；工作区仅有未跟踪 `.agents/`，未纳入 git。
- 使用 packaged app，不使用 `pnpm tauri:dev`：从 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` 启动，进程 pid `30436`，runtime descriptor 写出到 `${TMPDIR}/ai-partner/runtime-descriptor.json`。WindowServer 元信息确认 `AI Partner M0` on-screen，owner `AI Partner`，pid `30436`，bounds `1020,269 520x360`。
- Runtime descriptor discovery 通过：`pnpm debug:discover` 提权后发现 `http://127.0.0.1:56656/events`，`appInstanceId=app_20260607T154531Z_30436_4e6fccfe68f3c68f`；descriptor 目录权限 `0700`、文件权限 `0600`，记录只保留 `schemaVersion/appInstanceId/pid/port/createdAt/tokenLength`，不记录 token。
- 本机 endpoint 复核：`lsof` 显示 `ai-partner` 只监听 `127.0.0.1:56656`；GET `/events` 返回 `405 Method Not Allowed`，安全 POST probe 返回 `202`。
- 真实 Codex provider run 已通过：为避免项目内容风险，新建空目录 `/private/tmp/ai-partner-codex-live.aFYTMz`，通过 `pnpm codex:wrap --codex-bin /bin/zsh -- -lc 'cd "$1" && shift && exec codex "$@"' ... --ask-for-approval never exec --json --cd /private/tmp/ai-partner-codex-live.aFYTMz --skip-git-repo-check --sandbox read-only --ephemeral --ignore-rules 'Use only this empty temp directory. Run pwd and ls -la, then answer SAFE_SMOKE_OK.'` 包住真实 `codex exec --json`。
- Codex JSONL 输出确认实际工作目录为 `/private/tmp/ai-partner-codex-live.aFYTMz`，`ls -la` 只显示空临时目录自身和 `..`，最终 agent message 为 `SAFE_SMOKE_OK`；未读取仓库、未要求写文件、未绕过 sandbox。
- Wrapper 分类信号覆盖至少 4 类 workflow 状态：启动补发 `running`；真实 Codex JSONL 的 `item.started` / `item.completed command_execution` 命中结构化 `running` / `reading`；Codex 配置 deprecation/error item 命中结构化 `error`；0 exit 补发 `done`。由于本次安全 prompt 不触发审批，也不制造写操作，未强行追求 `waiting/editing`。
- Ingress payload 隐私边界复核：wrapper 事件仍由 `createCodexWorkflowEvent` / `workflowEventPayloadForPost` 生成，只含 `schemaVersion/event_id/source/run_id/workflow_state/timestamp/message/code_context_allowed`，固定 `code_context_allowed=false`；不发送 prompt、code、diff、file_content。真实 Codex stdout/stderr 原样转发到终端不等于发送到 ingress。
- 不抢焦点复核通过：packaged app 启动前、启动后、真实 Codex run 后，`osascript` 读取 frontmost 均为 `Codex`；`System Events` 读取 `ai-partner` 为 `frontmost=false`。
- 自动化视觉取证限制：全屏 `screencapture` 被安全审核拒绝，因为会捕获无关桌面内容；当前 macOS SDK 的旧单窗截图 API 已不可用，`System Events` 对 Tauri/WebView 只暴露 `AXApplication`/menu bar，不能稳定读取窗口文本。M5.5-T1 因此以 wrapper classification + ingress accepted + WindowServer/descriptor/focus 元数据作为 gate 证据，不新增产品 UI 或调试导出。

M5.5-T2 packaged lifecycle gate record 2026-06-08：

- 使用 packaged app，不使用 `pnpm tauri:dev`：从 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` 以 `open -g -n` 后台启动，避免验证命令自身激活 app。启动、退出、重启全程 `osascript` 显示前台应用保持 `Google Chrome`，`System Events` 显示 AI Partner `frontmost=false`。
- 首次实例 descriptor discovery 通过：`appInstanceId=app_20260608T000132Z_13848_03e2c451be5b6903`，pid `13848`，port `62502`，`createdAt=2026-06-08T00:01:32.542385+00:00`；descriptor 目录权限 `0700`、文件权限 `0600`，只记录 `tokenLength=64` / `tokenPresent=true`，不记录 token。
- 退出首次实例后，descriptor 文件在本机没有立即删除，但旧 descriptor 不再被 discovery 接受：旧 descriptor copy 下 `debug:discover` 返回 `descriptor_stale: Runtime descriptor process is not alive.`；旧 endpoint + 旧 token POST 返回 `ECONNREFUSED`。因此满足“删除或旧 descriptor 不再被 discovery 接受”的 lifecycle gate。
- 重启后生成新实例：`appInstanceId=app_20260608T000135Z_14126_cbc656b646544c97`，pid `14126`，port `62558`，`createdAt=2026-06-08T00:01:35.425752+00:00`；新 descriptor 权限仍为目录 `0700`、文件 `0600`，token 只在内存中比较，结论为 `tokenChanged=true`。
- `pnpm debug:discover` 发现新 endpoint `http://127.0.0.1:62558/events`；`pnpm debug:send waiting` 对新实例发送成功。旧 token 打到新 endpoint 返回 HTTP `401`，旧 descriptor copy 下 `debug:discover`、`debug:send waiting` 和 `pnpm codex:wrap --descriptor <old-descriptor-copy> --codex-bin /bin/echo -- SAFE` 均返回 `descriptor_stale`；默认 descriptor 下 wrapper 成功，确认 wrapper/debug CLI 不误连旧实例。
- 本轮未修改产品功能，未修改 `src-tauri`/Rust，未跑 `cargo test`。临时验证脚本和旧 descriptor copy 只在 `/private/tmp` 使用并已清理；`.agents/` 仍不纳入 git。Next：把此 gate 保留为 release 前 DMG smoke regression，下一步优先收敛剩余非 lifecycle 的 MVP gap。

M5.5-T3 Retina/high-DPI release smoke gate record 2026-06-09：

- 起点：HEAD `f12c1e7 docs(plan): reconcile release readiness gaps`；初始工作区仅有未跟踪 `.agents/`，未纳入 git。
- 环境：内建 Retina 显示器 `5120 x 2880`，系统缩放 `UI Looks like: 2560 x 1440 @ 60Hz`，即 2x Retina/high-DPI 路径。
- 使用 packaged app，不使用 `pnpm tauri:dev`。最终实例 `appInstanceId=app_20260609T134454Z_37955_9d42c69d6f9ca41d`，pid `37955`，endpoint `http://127.0.0.1:63029/events`；`pnpm debug:discover` / `pnpm debug:send waiting` 均通过。
- 不抢焦点和窗口行为通过：启动与 waiting 事件后前台应用仍为 `Codex`；WindowServer 元信息确认 `AI Partner M0` on-screen，owner `AI Partner`，layer `5`，alpha `1`，bounds `1046,314 468x325`。
- 默认伴侣、waiting bubble/status overlay 通过 Retina 视觉复核；旧实例安全单窗截图 `/private/tmp/ai-partner-retina-waiting-window.png` 显示 companion、`WAITING / 等待用户输入` bubble 和右侧状态面板均未裁切、未重叠、无明显 frame drift / blur / 对齐问题。
- Click-through banner 做了最小前端修复：由 fixed overlay 改为右侧面板内 `role=status` 状态行，与 runtime strip 互斥显示，`frontend/src/layoutSanity.test.ts` 锁定 `width: 100%` 且非 fixed 布局。未修改 `src-tauri`/Rust/窗口策略。
- 安全取证限制：仅尝试单窗口或 AI Partner bounds 小区域截图；新实例上 `screencapture -l/-R` 返回 `could not create image from window/rect`，旧 `CGWindowListCreateImage` API 在当前 SDK 不可用，ScreenCaptureKit 在 Codex 执行上下文触发 WindowServer 初始化断言。未扩大为全屏截图，避免捕获无关桌面内容。
- 验证通过：`pnpm test:frontend`、`pnpm --filter @ai-partner/frontend build`、`pnpm tauri:build:app`、`pnpm smoke:dmg:preflight`。结论：Retina/high-DPI release smoke gate 通过；external multi-display 仍为 roadmap/risk note，不是 MVP blocker。

Tasks:

- Wrapper 读取 `RuntimeDescriptor`。（已做）
- Wrapper 启动发 `running`。（已做）
- 结构化信号优先识别 `reading/editing/waiting`。（已做）
- stdout/stderr 只做保守白名单 fallback。（已做）
- 未知阶段降级为 `running`。（已做）
- 非 0 退出发 `error`。（已做）
- 0 退出发 `done`。（已做）
- 分类置信度写 debug log，不记录 code/diff/prompt。（debug log 尚未单独落盘；当前实现不记录 code/diff/prompt，event body 只含安全状态元数据）

Acceptance:

- 一次真实外部 Codex provider run 能驱动桌面伴侣至少 3 类 workflow 变化。（M5.5-T1 已通过；T9 本地等价 Codex bin run 仍作为 fallback 回归样例）
- Wrapper 不发送代码内容、diff、prompt。（已由 tests 和 live event bridge 边界复核）
- Fixture corpus 覆盖分类和隐私边界。（已覆盖）

### M5: macOS Internal Build

目标：可交付本机内测包。

Status 2026-06-07：M5 packaged app/DMG internal smoke 已通过；本轮仍不扩展产品 UI、不做 asset selector、partner search/switch 或多 AI adapter。当前 `src-tauri/tauri.conf.json` 仍保持 `bundle.active=true`、`bundle.targets=["dmg"]`、`beforeBuildCommand=pnpm --filter @ai-partner/frontend build` 和 `frontendDist=../frontend/dist`，本轮未修改 `src-tauri`。`pnpm package:dmg` 先跑只读 preflight，再用 `pnpm tauri:build:app` 生成 release `.app`，最后由 `scripts/package-macos-dmg.mjs` 创建内部 smoke DMG；这是因为 Tauri 生成的 `bundle_dmg.sh` 在当前 macOS GUI/automation 环境卡在 Finder AppleScript 美化步骤。该修复只影响 packaging 脚本，不改变产品窗口、权限或 Rust 状态桥。

Status 2026-06-07 distribution scope clarification：当前目标是 Petdex-like 本机内测/CLI 驱动安装，不做面向公众的 App Store 外 notarized direct-DMG 分发，因此 M5 不要求 Apple Developer ID 证书、notarization 或 stapled ticket。签名/公证/Gatekeeper 结果只作为风险记录；如果后续目标改为公开 direct-DMG 分发，再单独引入 Developer ID signing/notarization gate。

M5 smoke record 2026-06-07：

- 环境：分支 `codex/ai-partner-m0-contracts`，smoke 起点 HEAD `896b91e`；macOS 26.2 build 25C56，arm64；Node `v24.14.1`，pnpm `10.33.0`，rustc/cargo `1.96.0`，Tauri CLI `2.11.2`。
- `pnpm smoke:dmg:preflight` 通过；`pnpm package:dmg` 提权后通过，产物为 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`，格式 `UDZO`，大小约 `2.9M`，CRC32 `$F2BDC7A2`。
- DMG 挂载到 `/Volumes/AI Partner`，packaged app 安装到 `/private/tmp/ai-partner-m5-smoke.YHwFP1/AI Partner.app` 并从该路径启动，未使用 `pnpm tauri:dev`。
- packaged app 进程来自临时安装路径，pid `17979`；WindowServer 确认 `AI Partner M0` on-screen，owner pid `17979`，默认伴侣窗口可见。
- 不抢焦点通过：启动前后前台应用保持 `Finder`，AI Partner 未成为 frontmost app。
- `${TMPDIR}/ai-partner/runtime-descriptor.json` 权限为 `0600`，目录为 `0700`；token 未写入仓库、文档或日志。
- `pnpm debug:discover` 提权后发现 `http://127.0.0.1:52969/events`，`appInstanceId=app_20260606T145154Z_17979_3d65f8850b99dd41`。
- `pnpm debug:send waiting` / `pnpm debug:send done` 原样通过；为支撑 checklist，debug CLI 现在会记录最近一次单发非终态 run id，后续未显式传 `--run-id` 的 `done/error` 复用该 run id，避免被 active-run 仲裁拒绝。
- Click-through 物理复核通过：用户真实手点确认点击可落到底层 app，6 秒后 AI Partner 恢复可点击。自动化点击/截图路径仍不作为等价证据。
- 签名/公证/Gatekeeper 风险：当前 app 为 ad-hoc/linker 签名；`codesign --verify --deep --strict --verbose=2` 失败，提示 `code has no resources but signature indicates they must be present`；`spctl --assess` 对 app/DMG 返回 Code Signing subsystem internal error；`xcrun stapler validate` 未通过。这些不阻塞 Petdex-like 本机内测/CLI 安装路线；本轮不扩 UI、不做签名公证收口，也不引入 Apple Developer ID 依赖。
- 验证通过：`pnpm test`、`pnpm test:typecheck`、`pnpm smoke:dmg:preflight`。本轮未修改 Rust，未额外跑 `cargo test`。

Tasks:

- macOS app/dmg build。
- 1 个默认 Petdex 兼容伴侣随包。
- 本地诊断日志和 rollover。
- GitHub Releases 预留 artifact 上传。
- Windows build 只做后续 lane，不承诺同等体验。
- DMG smoke gate。

DMG smoke checklist:

1. 运行 `pnpm smoke:dmg:preflight`，确认 Tauri build、DMG target、默认窗口和不抢焦点配置未漂移。
2. 运行 `pnpm package:dmg` 生成 macOS DMG；若只需定位 build 问题，可单独运行 `pnpm tauri:build`。
3. 挂载 DMG，把 packaged app 安装到临时位置或 Applications，并从 packaged app 启动，不用 `pnpm tauri:dev`。
4. 保持终端或编辑器为前台输入应用，确认 AI Partner 首次启动后默认伴侣可见，且前台应用没有切到 AI Partner；需要后台启动验证时使用 `open -g -n <AI Partner.app>`。
5. 运行 `pnpm debug:discover`，确认 packaged app 写出的 runtime descriptor 可发现，endpoint 指向 `127.0.0.1`。
6. 复核 `${TMPDIR}/ai-partner/runtime-descriptor.json` 权限为 `0600`，并确认 token 未写入仓库或日志。
7. 运行 `pnpm debug:send waiting`，确认 packaged app UI 显示 waiting/source/message；再运行 `pnpm debug:send done`，确认状态可回到 idle。
8. 点击进入 click-through，确认点击落到底层 app，等待 6 秒后自动恢复；快捷键未注册不单独判失败。
9. 退出 packaged app，确认 descriptor 被删除，或旧 descriptor 在 `debug:discover --descriptor <old-copy>` 下被拒绝。
10. 重启 packaged app，确认 `appInstanceId`、pid、port 和 token 都变化；文档只记录 token 是否变化和长度，不记录 token 值。
11. 确认旧 endpoint/token 不可继续使用，旧 token 打新 endpoint 应返回 `401`；旧 descriptor copy 下 debug CLI 和 wrapper 都不能把事件送进新实例。
12. 记录签名、公证、Gatekeeper 提示和 DMG 安装路径问题；这些风险只用于判断未来是否要做公开 direct-DMG 分发，不阻塞当前 Petdex-like 内测路线。

Acceptance:

- DMG 可安装运行。
- 首次启动默认伴侣可见。
- Debug CLI 能到达本地 endpoint。
- 不抢当前输入焦点。
- 退出/重启会轮换 descriptor endpoint/token，旧 descriptor、旧 endpoint 和旧 token 不会被 debug CLI 或 wrapper 继续使用。
- 不要求 Apple Developer ID、notarization 或 stapled ticket；签名/公证/Gatekeeper 仅作为未来公开 direct-DMG 分发的风险记录。

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

## Resolved TODOs

### TODO-1: 调整 BRD 首版对外口径

Status: 已完成，2026-06-07。

Resolution: 已把 [ai-desktop-partner-business-requirements.md](ai-desktop-partner-business-requirements.md) 的首版口径改成 “macOS Codex technical preview / AI status companion”，并明确当前 MVP 是 macOS + Codex wrapper/debug CLI + Petdex-like 本机内测/CLI 驱动安装 + 状态反馈桌面伴侣。

Roadmap clarification: 多 AI、陪伴模式、深度互动、记忆/长期人格、Windows、partner search/switch、asset marketplace 等均已标为 roadmap，不作为首版承诺。

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

- [x] **T1 (P1, human: ~1 day / CC: ~30 min)** - Desktop shell - Run Tauri window spike with pass/fail gates
  - Surfaced by: Architecture Review A1/A8
  - Files: `src-tauri/`, `frontend/`
  - Verify: manual macOS matrix for transparent, focus, drag, click-through, Spaces
  - Status: 2026-06-07 reconciled as complete from existing M0 work. `docs/m0-window-spike.md` records M0 acceptance as passing for transparent borderless window, always-on-top, no focus stealing, drag, click-through recovery, Spaces/fullscreen behavior and CSS sprite frame alignment; later M2/M5 records kept those checks valid for the packaged app path. No new `src-tauri` changes were needed for this status update.
- [x] **T2 (P1, human: ~4h / CC: ~25 min)** - Contracts - Create `packages/contracts/` with schemas, versions and fixtures
  - Surfaced by: Code Quality Q2, Test Review
  - Files: `packages/contracts/`
  - Verify: schema fixture tests in TS and Rust
  - Status: 2026-06-07 reconciled as complete from existing contracts work. `packages/contracts/` contains the four schema files, valid/invalid fixtures, TypeScript contract modules and casing boundary tests; `src-tauri/tests/contracts_fixtures.rs` consumes the same JSON schema fixtures from Rust. This matches the earlier M0 status line that contracts/schema/fixtures were established and tested.
- [x] **T3 (P1, human: ~3h / CC: ~20 min)** - Runtime descriptor - Implement app endpoint bootstrap for wrapper/CLI
  - Surfaced by: Architecture Review A5
  - Files: `packages/contracts/`, `src-tauri/`, `scripts/` or `cli/`
  - Verify: descriptor atomic write, permission, stale cleanup and discover failure tests
  - Status: M1 app-side descriptor bootstrap done in `src-tauri`; debug CLI discovery done in `packages/debug-cli`; T9 wrapper discovery now reads the same runtime descriptor.
- [x] **T4 (P1, human: ~1 day / CC: ~45 min)** - Rust bridge - Build secure localhost event ingress and state store
  - Surfaced by: Architecture Review A4/A6/A7, Performance P1
  - Files: `src-tauri/`
  - Verify: `cargo test` for auth, rate limit, active run, pause/resume, timers
  - Status: M1 secure localhost ingress + state store done; renderer subscription remains M2.
- [x] **T5 (P1, human: ~1 day / CC: ~45 min)** - Resolver - Implement pure TypeScript animation resolver
  - Surfaced by: Architecture Review A3, Code Quality Q1/Q3/Q5
  - Files: `packages/resolver/` or `frontend/`
  - Verify: `vitest resolver`
  - Status: 2026-06-06 M3/T5 closeout done. `packages/resolver/` has matrix tests, physical override, high-priority waiting/error bubbles, `done` queue + 5s expiry, stale queue drop on new workflow, and frontend queued replay wiring. Integration with the minimal CSS sprite renderer is covered by loaded canonical intent -> Petdex/probe row tests; full UI selector/right-click work remains outside T5.
- [x] **T6 (P1, human: ~4h / CC: ~20 min)** - Physical interaction - Implement `physicalStateMachine`
  - Surfaced by: Code Quality Q4, Performance P2
  - Files: `frontend/` or `packages/interaction/`
  - Verify: reducer tests and drag does not rerun resolver per frame
  - Status: 2026-06-06 T6 minimal physical/renderer integration closeout done. `frontend/src/physicalStateMachine.ts` has reducer tests and App drag wiring keeps pointermove on ref + rAF + Tauri window move, with resolver dependencies limited to semantic workflow/physical/queue state. Tests now cover `waiting/error` bubbles under carried/struggling/falling/recovering, queued `done` replay after recovery, new workflow dropping old queued done, and replayed done entering the CSS/DOM sprite model. Right-click/selector work remains open under later UI tasks.
- [x] **T7 (P1, human: ~1 day / CC: ~45 min)** - Assets - Implement Petdex thin import, validator and fallback
  - Surfaced by: Code Quality Q5, Performance P3/P4
  - Files: `packages/assets/` or `frontend/`
  - Verify: asset validator tests for dimensions, path sandbox, symlinks and runtime budgets
  - Status: 2026-06-06 M3/T7 closeout done. `packages/assets/` covers Petdex thin validation/capabilities, path sandbox/symlink/runtime budgets, one-root scan, invalid asset fallback to default Petdex capabilities, and resolver nonblank intent after fallback. Full UI asset switching/search remains open under later product scope.
- [x] **T8 (P1, human: ~1 day / CC: ~45 min)** - Frontend - Render partner with CSS/DOM sprite and bubble overlay
  - Surfaced by: Code Quality Q3, Performance P2/P5
  - Files: `frontend/`
  - Verify: `pnpm test`; `pnpm --filter @ai-partner/frontend typecheck`; `pnpm --filter @ai-partner/frontend build`; 520x360 screenshot/layout sanity
  - Status: 2026-06-06 T8 最小 renderer 收口完成。CSS/DOM sprite、bubble/status/source overlay、默认 Petdex/probe atlas intent 映射已落地，并通过默认 520x360 screenshot/layout sanity；截图路径为 `/private/tmp/ai-partner-t8-renderer-520x360.png`。本轮未跑 `cargo test`，因为未改 Rust；未做 UI redesign、partner search/switch、多 AI adapter，也未碰 `src-tauri`。
- [x] **T9 (P1, human: ~1 day / CC: ~45 min)** - Codex wrapper - Emit real workflow events without code content
  - Surfaced by: Architecture Review A4, Test Review, Outside Voice
  - Files: `scripts/`, `cli/` or `src-tauri/`
  - Verify: integration fixture drives 3+ workflow states, no code/diff/prompt sent
  - Status: 2026-06-08 reconciled as complete. `packages/codex-wrapper/` has tests and local fallback live verification; `pnpm codex:wrap --codex-bin /bin/zsh -- -lc '<safe JSONL transcript>'` drove `running/reading/editing/waiting/done` through descriptor + ingress without sending prompt/code/diff/file content. M5.5-T1 later completed the real Codex provider packaged-app live run in an empty temp directory, covering at least 4 workflow states while keeping prompt/code/diff/file content out of ingress.
- [x] **T10 (P2, human: ~1 day / CC: ~30 min)** - Release - Produce macOS app/dmg internal build
  - Surfaced by: Distribution Check, Test Review
  - Files: `package.json`, `scripts/`, `docs/`, `src-tauri/` only if Tauri packaging requires it
  - Verify: `pnpm smoke:dmg:preflight`, Tauri build, install smoke, endpoint reachable, no focus stealing
  - Status: 2026-06-07 M5 packaged app/DMG internal smoke 通过；产物 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`，安装到临时路径并从 packaged app 启动，endpoint/debug/focus/descriptor/click-through 复核通过；签名/公证/Gatekeeper 风险列入 release checklist。
- [x] **T11 (P3, human: ~1h / CC: ~10 min)** - Product docs - Align BRD first-version messaging with MVP scope
  - Surfaced by: Outside Voice
  - Files: `docs/ai-desktop-partner-business-requirements.md`, `TODOS.md`
  - Verify: BRD labels non-MVP capabilities as roadmap
  - Status: 2026-06-07 completed. BRD now labels first version as “macOS Codex technical preview / AI status companion”, defines the MVP as macOS + Codex wrapper/debug CLI + Petdex-like local internal/CLI-driven install + status feedback desktop companion, and moves multi AI, companion mode, deep interaction, memory/long-term personality, Windows, partner search/switch, and asset marketplace to roadmap.

## Completion Summary

- Step 0: Scope Challenge - scope accepted as-is: phased complete MVP
- Architecture Review: 8 issues found, 2 user decisions, 6 plan clarifications
- Code Quality Review: 5 issues found, 3 user decisions, 2 plan clarifications
- Test Review: diagram produced, 26 additional gaps identified and added
- Performance Review: 5 issues found, 5 user decisions
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user and accepted; 2026-06-07 active list reconciled to none
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
- **VERDICT:** ENG CLEARED. Current status: M0 window spike and `packages/contracts/` are complete and reconciled in the task list.
