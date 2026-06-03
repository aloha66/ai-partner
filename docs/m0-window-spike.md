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
| Click-through 恢复 | `src-tauri/src/lib.rs` + `frontend/src/tauriWindow.ts` + `frontend/src/App.tsx` | 通过 | 2026-06-03 人工复测确认进入 click-through 后 UI 不再接收点击，说明穿透生效；恢复快捷键不可用或被占用。已改为 Rust 后端命令进入穿透并在 6 秒后强制恢复，人工复测确认穿透恢复正常 |
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

M0 acceptance 当前状态：通过。透明无边框、置顶、不抢焦点、拖动、click-through 恢复、Spaces/fullscreen、CSS sprite frame alignment 均已验证通过；可以进入 M1 最小 Rust State Bridge。

## M1 最小 State Bridge 进展

2026-06-03 已进入 M1 的最小 Rust State Bridge，但仅完成内存状态桥第一片，不实现 Codex wrapper、完整 renderer、完整 asset loader。

已完成：

- `src-tauri/src/state.rs`：新增 Rust `PartnerStateStore`，维护 `PartnerStateSnapshot`、active run、pause/resume、clear error、done -> idle timer。
- `src-tauri/src/lib.rs`：新增 Tauri commands：`get_current_state`、`apply_workflow_event`、`pause`、`resume`、`clear_error`，并在状态变化时 emit `partner-state-changed`。
- Rust tests 覆盖 idle 初始快照、active run 抢占、旧 run done 不覆盖新 active run、pause suppress emit、resume snapshot、clear error、done timer、stale done timer、code context/newline message 拒绝。

仍未做：

- localhost `POST /events` ingress。
- runtime descriptor 写入、token、端口发现。
- debug CLI / Codex wrapper。
- 前端 renderer 状态订阅和完整状态展示。

## 手测步骤

1. 打开常用编辑器或终端并保持输入焦点。
2. 运行 `pnpm tauri:dev`，确认 AI Partner 窗口出现且输入焦点没有跳走。
3. 拖动 sprite，确认窗口移动、bubble 不丢、无明显帧偏移。
4. 点击鼠标图标进入穿透，确认点击落到底层 app；等待 6 秒自动恢复，或按 UI 显示的已注册恢复快捷键，确认恢复后 AI Partner 图标可再次点击。
5. 在 Mission Control、普通 Space 和 fullscreen app 中确认窗口行为：普通 Space 可见可用，fullscreen app Space 不被 AI Partner 覆盖，回普通桌面后窗口仍可见可用。M0 默认保持 `visibleOnAllWorkspaces: false`。

## M0 工具按钮

从左到右：

1. 恢复默认窗口策略：关闭 click-through，恢复置顶、不可聚焦、只在普通 Space 显示。
2. 进入点击穿透：让鼠标点击落到底层 app，6 秒后后端自动恢复。
3. 刷新 spike 状态：重新读取透明、置顶、焦点、Spaces 等配置状态。
4. 切换 sprite 探针帧：手动切换 CSS sprite frame，用来检查帧对齐。
