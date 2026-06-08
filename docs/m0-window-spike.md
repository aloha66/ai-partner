# M0 Window Spike

日期：2026-06-02

## 范围

本 spike 只验证桌面壳能力，不实现 Codex wrapper、完整 renderer 或资产加载系统。

## 验收矩阵

| Check | 实现位置 | 当前结果 | 备注 |
| --- | --- | --- | --- |
| 透明无边框 | `src-tauri/tauri.conf.json` | 通过 | 2026-06-03 `pnpm tauri:dev` 截图验证：透明背景、无系统标题栏/边框；`transparent: true`、`decorations: false`、`macOSPrivateApi: true` |
| 置顶 | `src-tauri/tauri.conf.json` + `frontend/src/tauriWindow.ts` | 通过 | 2026-06-03 截图验证窗口覆盖在 Codex 上方；启动配置和运行时 `setAlwaysOnTop(true)` |
| 不抢焦点 | `src-tauri/tauri.conf.json` + `src-tauri/src/lib.rs` + `frontend/src/tauriWindow.ts` | 通过 | 初测前台被 `ai-partner` 激活；已加 `ActivationPolicy::Accessory` 降级修正。2026-06-03 复测 `osascript` 显示前台仍为 Codex |
| 拖动 | `frontend/src/App.tsx` + `frontend/src/tauriWindow.ts` | 通过 | 2026-06-03 人工初测发现拖动位置明显漂移；已改为 Tauri 物理 cursor position + 物理 window position 同源计算。人工复测确认拖动通过 |
| Click-through 恢复 | `src-tauri/src/lib.rs` + `frontend/src/tauriWindow.ts` + `frontend/src/App.tsx` | 通过 | 2026-06-03 M0 人工复测确认进入 click-through 后 UI 不再接收点击，6 秒后后端自动恢复正常；2026-06-05 M2 clean GUI 复核完成布局/入口小修/恢复闭环，用户真实物理复核确认点击可落到底层 app，6 秒后恢复且 AI Partner 可再次点击 |
| Spaces/fullscreen | `src-tauri/tauri.conf.json` | 通过 | 2026-06-03 人工复测确认普通 Space 可见可用、fullscreen Space 不覆盖、回普通桌面后窗口仍可用；默认 `visibleOnAllWorkspaces: false` 符合 M0 预期 |
| CSS sprite frame alignment | `frontend/src/spriteProbe.ts` | 通过 | 单元测试覆盖 Petdex 1536x1872 / 192x208 / 8x9 探针；2026-06-03 截图显示 `review:n` frame 无半格偏移 |

## 运行

```bash
pnpm install
pnpm tauri:dev
```

本机需要 Rust/Cargo 和 macOS Tauri prerequisites。
若 Tauri 编译时提示 capability permission 名称不匹配，先运行 `pnpm exec tauri add global-shortcut` 或使用 cargo 下载后的生成 schema 校正 `src-tauri/capabilities/m0-window-spike.json`；当前 M0 已把所需窗口 API 权限显式列出。

## 已跑门禁

```bash
pnpm test
pnpm --filter @ai-partner/contracts typecheck
pnpm --filter @ai-partner/frontend typecheck
pnpm --filter @ai-partner/frontend build
cargo test
pnpm exec tauri info
pnpm tauri:dev
```

结果：JS/TS 测试、fixture tests、typecheck、前端 build 和 Rust fixture tests 通过。已安装 minimal Rust toolchain，`pnpm exec tauri info` 可识别 `rustc`/`cargo`，`pnpm tauri:dev` 可编译并启动 Tauri 窗口。

2026-06-03 复测记录：

- 截图证据：`/private/tmp/ai-partner-m0-accessory.png`。
- `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'` 复测返回 `Codex`，确认 accessory 修正后 AI Partner 不再成为前台应用。
- `pgrep -fl 'target/debug/ai-partner|vite --host 127.0.0.1 --port 1420'` 可见 Tauri dev 进程，`lsof -nP -iTCP:1420 -sTCP:LISTEN` 可见 Vite 监听 `127.0.0.1:1420`。
- 自动化拖动尝试触发 macOS 辅助功能授权弹窗 `universalAccessAuthWarn`。
- 人工拖动初测发现 sprite 明显飘离拖动位置。根因判断为浏览器 `screenX/screenY` 与 Tauri `outerPosition` / `setPosition` 的坐标单位混用；已改为 `cursorPosition()`、`outerPosition()`、`PhysicalPosition` 统一物理坐标，并补充 `core:window:allow-cursor-position` capability。
- 修复后已跑 `pnpm --filter @ai-partner/frontend typecheck`、`pnpm test`、`cargo test` 通过；拖动人工复测通过。
- 人工截图 `/Users/aloha66/Library/Containers/com.tencent.qq/Data/tmp/QQ_1780487650025.png` 显示 520x360 窗口触发了 `@media (max-width: 520px)` 单列布局，导致 M0 面板下半截被窗口裁掉；已把断点调整到 460px，避免默认窗口尺寸隐藏 click-through 控件。
- Click-through 人工复测确认进入穿透后无法点击 AI Partner 其它图标，这是穿透生效的预期表现；阻塞点是恢复。`Command+Shift+P` 被其它软件占用，`Option+Shift+P` 触发系统/第三方鼠标隐藏显示，`Command+Option+Shift+P` 无反应。已移除 `Option+Shift+P`，改为 `CommandOrControl+Shift+KeyP` / `CommandOrControl+Alt+Shift+KeyP` 注册诊断。
- 前端 timer 兜底未能解锁一次穿透态，导致窗口无法点击/拖动。已新增 Rust 命令 `enter_click_through_for_ms`：后端进入 `set_ignore_cursor_events(true)` 后用后台任务等待 6 秒，再强制 `set_ignore_cursor_events(false)`、`set_focusable(false)`、`set_always_on_top(true)`、`show()`。已重启 `pnpm tauri:dev` 运行后端恢复版本。
- 第二张人工截图 `/Users/aloha66/Library/Containers/com.tencent.qq/Data/tmp/QQ_1780488854785.png` 显示底部 runtime strip 仍被裁切；已压缩 M0 panel 的状态文本、卡片高度、间距和按钮尺寸。
- 后端自动恢复版本复测通过：click-through 可进入，6 秒后自动恢复，恢复后可继续交互。
- Spaces/fullscreen 人工复测通过：普通 Space 可见可用，fullscreen app Space 不被 AI Partner 覆盖，回普通桌面后窗口仍可见可用。

2026-06-04 M2 live verification 记录：

- `pnpm tauri:dev` 可启动 Tauri dev app；首次沙箱内监听 `127.0.0.1:1420` 被拦截，提权后 Vite 和 Tauri app 正常启动。
- `pnpm debug:discover` 通过，发现本机 endpoint；runtime descriptor 位于 `${TMPDIR}/ai-partner/runtime-descriptor.json`，文件权限复核为 `0600`。
- `osascript` 复测前台应用仍为 `Codex`，确认 M2 状态订阅加入后不改变 M0 不抢焦点行为。
- `pnpm debug:send running/reading/editing/waiting/error/done` 均可被本机 ingress 接收，前端 workflow/source/message/paused/connection 区域能实时显示对应 snapshot；`done` 约 3 秒后回到 `idle`。
- `pnpm debug:sequence` 默认 350ms 间隔在 live run 中暴露一次 waiting 事件 HTTP 400；已把 debug CLI 默认 sequence 间隔调到 500ms，重新运行默认 `pnpm debug:sequence` 通过完整 `running -> reading -> editing -> waiting -> error -> done` 序列。
- Pause/resume/clear_error 通过 macOS accessibility 点击复测：pause 后 UI 保持 paused snapshot，paused 期间 ingress 继续接受 latest safe snapshot，resume 后显示 latest waiting snapshot；error 下 clear_error 回到 `idle`，并保留 paused 标志符合 Rust state store 语义。
- 默认 520x360 窗口下初测发现新增 workflow 状态区后底部 runtime strip 被裁切；已压缩右侧面板间距、卡片高度、按钮尺寸和 companion 布局，并把 `backend auto restore` 显示为 `auto 6s`。复测截图 `/private/tmp/ai-partner-m2-layout-after-css-crop.png` 显示 M0 controls、workflow 状态区和 runtime strip 均在默认窗口内可见。
- Click-through 本轮自动化复测未计通过：普通 CGEvent 坐标点击只触发 hover；AXPress 能触发 button 2，但随后 macOS accessibility 显示 `ai-partner` 窗口数为 0，`screencapture` 变为黑屏。M0 既有人工复测仍记录为通过，但 M2 状态区加入后的 click-through banner/恢复需要在干净 GUI 会话中手测复核。

2026-06-05 M2 click-through clean GUI follow-up：

- 启动前已清理旧 `ai-partner` / Vite / Tauri dev 进程，并重新运行 `pnpm tauri:dev`。
- 默认 520x360 窗口可见；截图 `/private/tmp/ai-partner-clean-restart-baseline.png` 显示 M0 controls、workflow 状态区和 runtime strip 均在窗口内，没有裁切。
- 前台应用为 Chrome click target，AI Partner 仍置顶但不抢焦点；`osascript` 读取窗口为 `520x360`。
- 自动化坐标点击、AX `click` 和 `AXPress` 均能命中/命名 `进入点击穿透` 按钮，但在当前 macOS automation 会话中没有把 `click` 交给 Tauri WebView；随后 HID/CGEvent 截图路径再次出现黑屏，不能作为真实物理手点等价证据。
- 已做限定小修：click-through 按钮增加 `aria-label`，在 `pointerdown` / `mousedown` 即启动穿透并用恢复 timer 防重入；Rust `enter_click_through_for_ms` 进入时重申 `focusable(false)` / `always_on_top(true)`，6 秒后恢复时 emit `click-through-restored`，renderer 监听后清理 banner/timer。
- 小修后 `pnpm --filter @ai-partner/frontend typecheck`、`pnpm --filter @ai-partner/frontend test`、`cargo test --manifest-path src-tauri/Cargo.toml` 通过。
- 用户真实物理 click-through 复核通过：点鼠标图标后 banner 显示，点击可落到底层 app，等待 6 秒后自动恢复，恢复后 AI Partner 可再次点击。

2026-06-06 T9 live verification 记录：

- 启动前工作区状态：分支 `codex/ai-partner-m0-contracts`，HEAD `7281d4a`；工作区仅有未跟踪 `.agents/`，未纳入验证或提交。
- `pnpm tauri:dev` 沙箱内启动仍因 `127.0.0.1:1420` 监听 `EPERM` 失败；提权后 Tauri dev app 正常启动，Vite 监听 `127.0.0.1:1420`，Rust app 生成 runtime descriptor。
- Runtime descriptor 位于 `${TMPDIR}/ai-partner/runtime-descriptor.json`，本轮复核文件权限为 `0600`；`pnpm debug:discover` 提权后通过，发现 `http://127.0.0.1:56726/events`，`appInstanceId=app_20260606T024138Z_94708_a5574dc965031407`。
- 真实外部 Codex run 命令已按安全短 prompt 尝试：`pnpm codex:wrap -- exec --json --sandbox read-only --ephemeral ...`；安全审核因可能让另一个 Codex agent 读取本地仓库而拒绝执行。本轮未绕过该边界，也未发送 prompt/code/diff/file content 到 ingress。
- 使用等价本地 Codex bin transcript 完成闭环：`pnpm codex:wrap --codex-bin /bin/zsh -- -lc '<safe JSONL transcript>'`。transcript 只输出 `{"workflow_state":"reading"}`、`{"workflow_state":"editing"}`、`{"workflow_state":"waiting"}`，wrapper 启动时补发 `running`，0 退出时补发 `done`。
- 本地 wrapper -> runtime descriptor discovery -> `POST /events` -> Rust state store/Tauri app 闭环通过；wrapper 命令退出 0 且没有 `ai-partner event bridge failed`，说明 ingress 接受事件。状态类别覆盖 `running/reading/editing/waiting/done`，满足至少 3 类 live verification 要求。
- 事件 body 隐私边界由 `packages/codex-wrapper/tests/runner.test.ts` 和 `packages/debug-cli/tests/debugCli.test.ts` 复核：发送到 ingress 的 payload 只保留 `schemaVersion/event_id/source/run_id/workflow_state/timestamp/message/code_context_allowed`，`source=codex-wrapper`，`code_context_allowed=false`，不包含 prompt、code、diff 或 file content；wrapper 原样转发子进程 stdout/stderr 到终端不等于发送到 ingress。
- macOS automation 沙箱内取证仍不可用：`osascript` 返回 `-10827`，`screencapture` 返回 `could not create image from display`。提权后复核成功：`osascript` 读取窗口为 `AI Partner M0`、位置 `1020,269`、尺寸 `520x360`，前台应用仍为 `Codex`；截图 `/private/tmp/ai-partner-t9-wrapper-waiting-live.png` 显示 UI 处于 `WAITING / Codex is waiting`，`source=codex`，`message=Codex is waiting`，无裁切异常。
- 本轮验证通过：`pnpm test`、`pnpm --filter @ai-partner/codex-wrapper typecheck`、`pnpm --filter @ai-partner/codex-wrapper build`。

2026-06-06 T8 renderer status 收口：

- T8 最小 renderer 收口已完成：前端使用 CSS/DOM sprite 渲染现有 Petdex/probe atlas，并保留 bubble/status/source overlay；默认 Petdex/probe atlas 已通过 resolver intent 映射选择对应 legacy 行，未引入 UI redesign。
- 默认 520x360 screenshot/layout sanity 通过；截图证据：`/private/tmp/ai-partner-t8-renderer-520x360.png`。该截图覆盖 sprite、bubble/status overlay、M0 controls 和 runtime strip 在默认窗口内可见，无裁切异常。
- 验证通过：`pnpm test`、`pnpm --filter @ai-partner/frontend typecheck`、`pnpm --filter @ai-partner/frontend build`。
- 本轮未跑 `cargo test`，因为 T8 收口未修改 Rust，也未碰 `src-tauri`。
- 本轮明确不做 UI redesign、不做 partner search/switch、不做多 AI adapter、不碰 `src-tauri`。

2026-06-06 M3/T5/T7 next closeout：

- T5 最小闭环补齐：前端 resolver adapter 可注入 loaded `PartnerCapabilities` 和 resolver queue，`App.tsx` 保留并回传 `done` body queue；resolver 在新 workflow 激活时丢弃旧 queued done，避免旧完成庆祝压过新任务。
- T7 最小闭环补齐：无效资产 fallback 到默认 Petdex capabilities 后，会继续进入 resolver 并产出非空默认动画 intent；测试覆盖 `invalid asset -> default-petdex -> legacy.review`。
- T5/T7 与 T8 集成验证补齐：测试覆盖 loaded canonical resolver intent 映射到 Petdex/probe `review` row，以及 queued `workflow.done` 在 physical recovery 后 5 秒内补播。
- 验证通过：`pnpm --filter @ai-partner/resolver test`、`pnpm --filter @ai-partner/resolver typecheck`、`pnpm --filter @ai-partner/assets test`、`pnpm --filter @ai-partner/assets typecheck`、`pnpm --filter @ai-partner/frontend test`、`pnpm --filter @ai-partner/frontend typecheck`。
- 本轮仍不做 UI redesign、partner search/switch、完整 asset loader UI、多 AI adapter，也未碰 `src-tauri`。

2026-06-06 T6 physical/renderer integration 最小收口：

- T6 最小 physical/renderer integration 已收口，不扩大 UI：`physicalStateMachine` 仍是纯 reducer，`App.tsx` 只把 drag start/hold/release/cancel 转成 semantic physical state；pointermove 坐标保留在 ref + rAF + Tauri window move 边界，不进入 resolver dependency。
- Resolver/renderer 语义补测完成：`waiting/error` bubble 在 `carried/struggling/falling/recovering` 下仍保留 workflow state/text/high priority，只替换 body motion；queued `done` 在 recovery 后进入同一 CSS/DOM sprite model 补播，且新 workflow 会丢弃旧 queued done。
- 本轮文档把 T6/T8 表述限定为最小 CSS/DOM sprite renderer 集成；右键菜单、selector、partner search/switch 和完整产品 UI 仍属后续范围。

2026-06-06 M5/macOS packaging smoke gate 前置收口：

- 当前 Tauri package 路径已复核：`src-tauri/tauri.conf.json` 的 `build.beforeBuildCommand` 会运行 `pnpm --filter @ai-partner/frontend build`，`frontendDist` 指向 `../frontend/dist`，`bundle.active=true` 且 `bundle.targets=["dmg"]`。
- 本轮未修改 `src-tauri`，因为 DMG target、透明无边框、置顶、不可聚焦和普通 Space 默认策略已在既有配置中满足 M5 smoke 前置要求。
- 新增根级命令：`pnpm smoke:dmg:preflight` 只读检查 packaging/smoke 关键配置；`pnpm tauri:build` 固化 Tauri build 入口；`pnpm package:dmg` 先跑 preflight 再 build。
- DMG smoke gate 固定为安装后人工复核：默认伴侣可见、本地 runtime descriptor/endpoint 可发现、`pnpm debug:send waiting` 可驱动 packaged app、启动不抢当前输入焦点、descriptor 文件权限仍为 `0600`。
- 已完成的 T6/T8/T9 仍只代表 physical reducer + CSS/DOM sprite renderer + Codex wrapper 最小闭环；完整产品 UI、asset selector、partner search/switch、多 AI adapter 仍未做，也不属于本轮范围。

2026-06-07 M5/macOS packaged app smoke：

- 环境：分支 `codex/ai-partner-m0-contracts`，smoke 起点 HEAD `896b91e`；macOS 26.2 build 25C56，arm64；Node `v24.14.1`，pnpm `10.33.0`，rustc/cargo `1.96.0`，Tauri CLI `2.11.2`。
- `pnpm smoke:dmg:preflight` 通过；preflight 现在同时锁住 `pnpm tauri:build:app` 和内部 DMG builder 入口。
- 初始 `pnpm package:dmg` 暴露 Tauri 生成的 `bundle_dmg.sh` 在 Finder AppleScript 美化步骤卡住；这是 packaging 路径问题，不是产品窗口或 Rust 状态桥问题。已保持 `src-tauri` 不变，改为 `pnpm tauri:build:app` 生成 release `.app` 后，由 `scripts/package-macos-dmg.mjs` 使用 `hdiutil create` 生成内部 smoke DMG，避开 Finder AppleScript。
- `pnpm package:dmg` 提权后通过，生成 DMG：`/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`；格式 `UDZO`，大小约 `2.9M`，CRC32 `$F2BDC7A2`。packaged app 同时位于 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app`。
- DMG 已挂载到 `/Volumes/AI Partner`，并安装到临时路径 `/private/tmp/ai-partner-m5-smoke.YHwFP1/AI Partner.app` 后从 packaged app 启动，未使用 `pnpm tauri:dev`。
- packaged app 进程来自临时安装路径：`/private/tmp/ai-partner-m5-smoke.YHwFP1/AI Partner.app/Contents/MacOS/ai-partner`，pid `17979`。WindowServer 元数据显示 `AI Partner M0` on-screen，owner pid `17979`，bounds `1046,314 468x325`，默认伴侣窗口可见。
- 不抢焦点复核通过：启动前后前台应用保持 `Finder`，`AI Partner` 未成为 frontmost app。
- Runtime descriptor 位于 `${TMPDIR}/ai-partner/runtime-descriptor.json`，文件权限 `0600`，目录权限 `0700`；文档和命令记录只保留 `appInstanceId/pid/port/createdAt`，未记录 token。
- `pnpm debug:discover` 提权后通过，发现 `http://127.0.0.1:52969/events`，`appInstanceId=app_20260606T145154Z_17979_3d65f8850b99dd41`。
- `pnpm debug:send waiting` / `pnpm debug:send done` 原样复核通过。smoke 中发现单发 `done` 默认新建 run id 会被 active-run 仲裁拒绝；已最小修复 debug CLI，让 `waiting` 等非终态单发记录最近 run id，后续 `done/error` 未显式传 `--run-id` 时复用该 run id。
- Click-through packaged app 物理复核通过：用户真实手点确认点击可落到底层 app，等待 6 秒后 AI Partner 恢复可点击。macOS 自动化路径仍不能替代这条证据：`screencapture -l` 对透明无边框窗口失败，AX 无法稳定进入 WebView 控件，CGEvent/System Events 坐标点击未能被临时底层目标窗口接收。
- 签名/公证/Gatekeeper 风险已记录：当前 app 为 ad-hoc/linker 签名，`codesign --verify --deep --strict --verbose=2` 返回 `code has no resources but signature indicates they must be present`；`spctl --assess` 对 app/DMG 返回 Code Signing subsystem internal error；`xcrun stapler validate` 未通过。当前目标是 Petdex-like 本机内测/CLI 安装，不做面向公众的 notarized direct-DMG 分发，因此不要求 Apple Developer ID，签名公证不阻塞 M5 acceptance。
- 验证通过：`pnpm test`、`pnpm test:typecheck`、`pnpm smoke:dmg:preflight`。本轮未修改 Rust，也未额外跑 `cargo test`。

2026-06-07 M5.5-T1 real Codex provider live run gate：

- 起点：分支 `main`，HEAD `2785092 docs(plan): reconcile mvp task status`；工作区仅有未跟踪 `.agents/`，未纳入 git。
- 使用 packaged app：从 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` 启动，进程 pid `30436`；WindowServer 元信息确认 `AI Partner M0` on-screen，owner `AI Partner`，pid `30436`，bounds `1020,269 520x360`；`osascript` 复核启动前后 frontmost 均为 `Codex`，AI Partner 未抢焦点。
- Runtime descriptor discovery 已跑：`${TMPDIR}/ai-partner/runtime-descriptor.json` 写出，目录权限 `0700`、文件权限 `0600`；`pnpm debug:discover` 提权后发现 `http://127.0.0.1:56656/events`，`appInstanceId=app_20260607T154531Z_30436_4e6fccfe68f3c68f`，未打印 token。
- 本机 ingress 复核：`lsof` 显示 `ai-partner` 监听 `127.0.0.1:56656`；GET `/events` 返回 `405`，安全 POST probe 返回 `202`。
- 真实 Codex provider run 已通过：新建空临时目录 `/private/tmp/ai-partner-codex-live.aFYTMz`，用 `pnpm codex:wrap` 包住真实 `codex exec --json`，并通过 `/bin/zsh -lc 'cd "$1" && shift && exec codex "$@"'` 确保子进程先进入空目录；Codex 同时带 `--cd` 指向该目录、`--sandbox read-only`、`--ask-for-approval never`、`--ephemeral`、`--ignore-rules`、`--skip-git-repo-check`。
- Prompt 为无项目内容的短安全 prompt：只要求在当前空目录运行 `pwd` / `ls -la` 并回答 `SAFE_SMOKE_OK`。Codex JSONL 输出确认 `pwd` 为 `/private/tmp/ai-partner-codex-live.aFYTMz`，`ls -la` 只包含空目录自身和 `..`，最终 agent message 为 `SAFE_SMOKE_OK`。
- Wrapper 状态覆盖满足 gate：启动补发 `running`；真实 JSONL 的 command execution 结构化事件命中 `running` / `reading`；Codex 配置 deprecation/error item 命中 `error`；0 exit 补发 `done`。本次至少覆盖 4 类 workflow 状态；未强造 `waiting/editing`。
- 隐私边界复核：发送到 ingress 的 wrapper payload 仍只含 `schemaVersion/event_id/source/run_id/workflow_state/timestamp/message/code_context_allowed`，固定 `code_context_allowed=false`，不包含 prompt、code、diff、file_content。真实 Codex stdout/stderr 只转发到终端，不进入 ingress payload。
- 真实 run 后 `osascript` 复核 frontmost 仍为 `Codex`，`ai-partner` 为 `frontmost=false`。全屏截图因会捕获无关桌面内容被安全审核拒绝；当前 macOS SDK 的旧单窗截图 API 已不可用，Tauri/WebView 在当前 AX 路径中不暴露窗口文本，因此本 gate 使用 wrapper classification、ingress accepted、WindowServer/descriptor/focus 元数据作为证据。

2026-06-08 M5.5-T2 packaged app quit/restart lifecycle gate：

- 使用 packaged app，不使用 `pnpm tauri:dev`：从 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` 以后台方式 `open -g -n` 启动，避免验证命令自身激活 app；启动、退出、重启全程前台应用保持 `Google Chrome`，`System Events` 显示 AI Partner `frontmost=false`。
- 首次 packaged app 实例 descriptor discovery 通过：`appInstanceId=app_20260608T000132Z_13848_03e2c451be5b6903`，pid `13848`，port `62502`，`createdAt=2026-06-08T00:01:32.542385+00:00`；descriptor 目录权限 `0700`、文件权限 `0600`，只记录 `tokenLength=64` 和 `tokenPresent=true`，未记录 token。
- `pnpm debug:discover` 发现 `http://127.0.0.1:62502/events`；`pnpm debug:send waiting` 对首次实例发送成功。
- 退出首次 packaged app 后，descriptor 文件在本机没有立即删除，但旧 descriptor 已不可被 discovery 接受：旧 descriptor copy 运行 `debug:discover` 返回 `descriptor_stale: Runtime descriptor process is not alive.`；旧 endpoint + 旧 token POST 返回 `ECONNREFUSED`。这满足 gate 的“descriptor 被删除或旧 descriptor 不再被 discovery 接受”条件。
- 重启 packaged app 后生成新实例：`appInstanceId=app_20260608T000135Z_14126_cbc656b646544c97`，pid `14126`，port `62558`，`createdAt=2026-06-08T00:01:35.425752+00:00`；descriptor 目录权限仍为 `0700`、文件权限仍为 `0600`，`tokenLength=64`，token 只在内存中比较，结果为 `tokenChanged=true`。
- 重启后 `pnpm debug:discover` 发现新 endpoint `http://127.0.0.1:62558/events`；`pnpm debug:send waiting` 对新实例发送成功。旧 token 打到新 endpoint 返回 HTTP `401`，确认旧 token 不可继续使用。
- Wrapper/debug CLI 不误连旧实例：旧 descriptor copy 下 `debug:discover`、`debug:send waiting` 和 `pnpm codex:wrap --descriptor <old-descriptor-copy> --codex-bin /bin/echo -- SAFE` 均返回 `descriptor_stale: Runtime descriptor process is not alive.`；默认 descriptor 下 `pnpm codex:wrap --codex-bin /bin/echo -- SAFE` 成功并发现新实例。
- 本轮未发现需要产品代码修复的 lifecycle 缺口。未修改 `src-tauri`/Rust，未跑 `cargo test`；验证脚本和旧 descriptor copy 均位于 `/private/tmp` 且已清理，不纳入仓库。Next：把此 gate 保留为 release 前 DMG smoke regression，下一步优先收敛剩余非 lifecycle 的 MVP gap。

M0 acceptance 当前状态：通过。透明无边框、置顶、不抢焦点、拖动、click-through 恢复、Spaces/fullscreen、CSS sprite frame alignment 均已验证通过；可以进入 M1 最小 Rust State Bridge。

## M1 Rust State Bridge 进展

2026-06-03 已进入 M1 Rust State Bridge。当前已完成并复核内存状态桥、localhost HTTP ingress + runtime descriptor 的最小闭环，以及本地 debug sender/discovery。2026-06-04 已完成 M2 最小前端状态订阅；2026-06-05 已开始 M3 最小 resolver + asset loader 前置切片；2026-06-06 已完成 T6 最小 physical/renderer integration 收口、T8 最小 renderer 收口和 T9 最小 Codex wrapper 本地 live verification。不实现完整 asset loader UI、partner search/switch 或多 AI adapter。

已完成：

- `src-tauri/src/state.rs`：新增 Rust `PartnerStateStore`，维护 `PartnerStateSnapshot`、active run、pause/resume、clear error、done -> idle timer。
- Rust 状态机边界已复核并补齐：`schemaVersion`、`event_id` / `run_id` 前缀、长度和字符集、RFC3339 timestamp、禁止 `code_context_allowed`、message 160 字和换行拒绝、active run 仲裁、stale timestamp 拒绝、pause/resume 不取消 done timer、`clear_error -> idle`。
- `src-tauri/src/lib.rs`：新增 Tauri commands：`get_current_state`、`apply_workflow_event`、`pause`、`resume`、`clear_error`，并在状态变化时 emit `partner-state-changed`。
- Rust tests 覆盖 idle 初始快照、active run 抢占、旧 run done/error 不覆盖新 active run、active idle 清空 run、pause suppress emit、resume snapshot、paused clear error、done timer、pause 期间 done timer 继续回 idle、stale done timer、stale timestamp、schema/id/timestamp/code context/message 拒绝。
- `src-tauri/src/ingress.rs`：新增只绑定 `127.0.0.1` 的 `POST /events` ingress，启动时生成 session bearer token，写入 runtime descriptor 到 `${TMPDIR}/ai-partner/runtime-descriptor.json`。
- Runtime descriptor 已做临时文件 + rename 原子写入，Unix owner-only 目录/文件权限（`0700` / `0600`）、旧 descriptor stale cleanup、启动新实例覆盖旧 descriptor、退出时按 `appInstanceId` 删除。
- Ingress gate 已做 bearer token、method/path/content-type、payload 4KB、top-level 白名单字段、forbidden field、schema/id/timestamp/source/state/message/code_context_allowed、CORS preflight / `Origin` 拒绝。
- Flood 预算已做 `event_id` TTL/LRU 去重、per-run 300ms debounce、per-run 10 events/s + burst 30 token bucket；超预算或 debounce 命中的事件仍会更新 Rust latest safe snapshot，并通过 trailing flush 推送最新安全快照，避免 UI 永久停在旧状态。
- Rust tests 已覆盖 descriptor 原子写入/权限/清理、stale descriptor、auth、origin、payload size、unknown/forbidden field、dedupe TTL/LRU、debounce、rate budget、paused latest snapshot 和 HTTP gate -> state store 闭环。
- `packages/debug-cli/`：新增最小本地 debug sender/discovery，读取 `${TMPDIR}/ai-partner/runtime-descriptor.json`，校验 `schemaVersion`、`pid`、`port`、`token`、`createdAt` 和 endpoint 可达性，然后用 bearer token 向 `POST /events` 发送 `cli` 来源的 `WorkflowEvent`。
- Debug sender 覆盖 `running`、`reading`、`editing`、`waiting`、`error`、`done`；payload 只生成白名单字段，`code_context_allowed=false`，拒绝 `code`、`diff`、`prompt`、file content 等 code-context 输入。
- Debug sender tests 覆盖 descriptor missing/stale、endpoint failure、bad token/connection failure、合法事件发送和 forbidden payload 拒绝。
- `packages/codex-wrapper/`：新增 T9 最小 Codex wrapper event bridge，读取同一 runtime descriptor，启动发 `running`，结构化信号优先识别 `reading/editing/waiting`，stdout/stderr 做保守 fallback，unknown -> `running`，0 exit -> `done`，非 0/signal -> `error`；发送到 ingress 的 event body 只含安全状态元数据。
- Codex wrapper tests 覆盖 classifier、structured priority、stdout/stderr fallback、unknown fallback、exit mapping、allowed source 和 prompt/code/file content 不进入 ingress payload。
- `frontend/src/tauriWindow.ts`：新增 M2 state bridge，renderer 可调用 `get_current_state`，订阅 `partner-state-changed`，并通过 `pause`、`resume`、`clear_error` 控制 Rust state store；控制命令失败时回拉 `get_current_state` 作为兜底。
- `frontend/src/App.tsx`：启动时注册 Tauri event listener 并拉取当前 snapshot；现有窗口 UI 中显示 workflow state、source、message、paused、connection，并保留 M0 window controls。Pause/resume/clear error 已接到前端按钮，command 返回 snapshot 后立即更新 UI。
- `frontend/src/physicalStateMachine.ts`：新增 T6 最小 pure reducer，覆盖 `normal/carried/struggling/falling/recovering` 和 abnormal reset；`App.tsx` 只把现有 drag start/hold/release/cancel 转成 semantic physical state，不改 UI 外观，pointermove 坐标留在 ref + rAF 边界，不进入 resolver dependency。
- T8 最小 renderer 收口：现有 frontend 以 CSS/DOM sprite 显示默认 Petdex/probe atlas，并由 resolver intent 映射到默认 Petdex/probe atlas 行；bubble/status/source overlay、workflow 状态和 520x360 默认窗口布局已完成 screenshot sanity，证据为 `/private/tmp/ai-partner-t8-renderer-520x360.png`。
- M3/T5/T7 最小闭环收口：frontend resolver adapter 支持 capabilities/queued 注入，App 保留 `done` body queue，resolver 在新 workflow 下丢弃旧 queued done；asset fallback 到默认 Petdex capabilities 后已通过 resolver 非空 intent 测试，loaded canonical intent 到 Petdex/probe row、physical override bubble 语义和 queued done replay 到 CSS/DOM sprite model 的测试已覆盖。
- `src-tauri/capabilities/m0-window-spike.json`：新增 `core:event:allow-listen`，允许 renderer 订阅 `partner-state-changed`。
- Frontend tests 覆盖 snapshot display view model、Tauri event update callback 和 state command fallback。

仍未做：

- 真实外部 Codex provider live run 需要用户显式批准后再跑；本轮只完成本地等价 Codex bin live verification。
- 完整 asset loader UI、partner search/switch、多 run 聚合 UI。
- UI redesign、多 AI adapter 仍不在本轮范围；T8 未碰 `src-tauri`。

Debug sender 用法：

```bash
pnpm debug:discover
pnpm debug:send running
pnpm debug:sequence
pnpm codex:wrap --codex-bin /bin/zsh -- -lc '<safe JSONL transcript>'
```

## 手测步骤

1. 打开常用编辑器或终端并保持输入焦点。
2. 运行 `pnpm tauri:dev`，确认 AI Partner 窗口出现且输入焦点没有跳走。
3. 拖动 sprite，确认窗口移动、bubble 不丢、无明显帧偏移。
4. 运行 `pnpm debug:discover`，确认本机 endpoint 可发现。
5. 运行 `pnpm debug:send running`、`reading`、`editing`、`waiting`、`error`、`done`，确认 workflow、source、message、paused、connection 实时更新，`done` 约 3 秒后回到 `idle`。
6. 运行 `pnpm debug:sequence`，确认完整状态序列显示；如做节奏敏感复测，可显式使用 `--delay-ms 500`。
7. 运行本地 wrapper 等价 transcript，例如 `pnpm codex:wrap --codex-bin /bin/zsh -- -lc '<safe JSONL transcript>'`，确认 `source=codex-wrapper` 且至少显示 `running/reading/editing/waiting/done` 中 3 类状态；不要在 transcript 或 prompt 中包含 code/diff/file content。
8. 点击 pause/resume/clear_error，确认 pause 后不实时推送、resume 后显示 latest safe snapshot、clear_error 回 `idle`。
9. 点击鼠标图标进入穿透，确认 banner 显示 `穿透中 / 6s auto restore` 且不裁切；点击 AI Partner 覆盖区域，确认点击落到底层 app；等待 6 秒自动恢复，确认 banner 消失且 AI Partner 图标可再次点击。快捷键未注册不单独判失败；当前 gate 以 6 秒后端自动恢复可靠通过为准。
10. 在 Mission Control、普通 Space 和 fullscreen app 中确认窗口行为：普通 Space 可见可用，fullscreen app Space 不被 AI Partner 覆盖，回普通桌面后窗口仍可见可用。M0 默认保持 `visibleOnAllWorkspaces: false`。

## M0 工具按钮

从左到右：

1. 恢复默认窗口策略：关闭 click-through，恢复置顶、不可聚焦、只在普通 Space 显示。
2. 进入点击穿透：让鼠标点击落到底层 app，6 秒后后端自动恢复。
3. 刷新 spike 状态：重新读取透明、置顶、焦点、Spaces 等配置状态。
4. 切换 sprite 探针帧：手动切换 CSS sprite frame，用来检查帧对齐。
