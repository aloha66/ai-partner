# AI 桌面伴侣 Tauri 可行性检查

日期：2026-05-31

## 结论

Tauri 可以满足当前 MVP 需要，建议把桌面壳从“Electron 或 Tauri 待定”收敛为 **Tauri 优先**。

理由：

- 透明、无边框、置顶、可拖动窗口都有官方 API 或配置支持。
- 托盘、全局快捷键、shell/sidecar、本地 Rust backend、前后端事件通信都能覆盖桌面伴侣控制和 Codex wrapper 集成。
- macOS/Windows 分发有官方路径，后续不用因为桌面壳能力不足而换架构。

主要风险：

- macOS 透明窗口需要 `macos-private-api`，官方文档明确提示这会影响 App Store 上架。MVP 和直发 DMG 没问题，但如果未来目标是 Mac App Store，要提前准备替代窗口方案。
- “不抢焦点但还能互动”是最需要 spike 的点。Tauri 有 `focus`、`focusable`、`setFocusable`、`setIgnoreCursorEvents` 等能力，但跨平台细节要实测。

## 功能对照

| 需求 | Tauri 支持情况 | 结论 |
| --- | --- | --- |
| 透明桌面窗口 | `transparent` window option；macOS 需要 private API | 可用，但影响 App Store |
| 无边框 | `decorations: false` / `setDecorations(false)` | 可用 |
| 置顶 | `alwaysOnTop` / `setAlwaysOnTop(true)` | 可用 |
| 拖动窗口 | `startDragging()` | 可用 |
| 不抢焦点 | `focus: false`、`focusable`、`setFocusable(false)` | 可用但要实测 |
| 点击穿透/忽略鼠标 | `setIgnoreCursorEvents(true)` | 可用，但与互动点击互斥 |
| 托盘入口 | `tray-icon` feature + Tray API | 可用 |
| 全局快捷键 | `@tauri-apps/plugin-global-shortcut` | 可用 |
| 本地状态服务 | Rust backend 可实现；前端用 events/commands 连接 | 可用 |
| Codex wrapper / sidecar | shell plugin 支持 command/sidecar | 可用 |
| 前后端状态同步 | commands、events、channels | 可用 |
| macOS 分发 | app/dmg 官方分发路径 | 可用 |
| Windows 分发 | msi / NSIS 官方分发路径 | 可用 |

## 推荐架构

```text
Tauri app
  src-tauri/
    state service: workflowState / physicalState / event validation
    local HTTP or IPC bridge: receives CLI/wrapper events
    shell/sidecar integration: Codex wrapper
  frontend/
    transparent partner window
    animation resolver
    bubble/status overlay
    drag/physical interaction capture
```

MVP 可以先把本地事件入口放在 Rust backend 中实现。Renderer 不需要自己开 WebSocket；它可以通过 Tauri events 接收状态更新。外部 CLI / wrapper 需要进程外通信，所以 Rust backend 仍然需要一个只绑定 `127.0.0.1` 的本地入口，或者用 sidecar/IPC 方案承接。

## MVP 技术决策

1. 桌面壳：Tauri。
2. MVP 平台：macOS 本地开发运行。
3. 分发路径：先 direct download / DMG，不承诺 Mac App Store。
4. 窗口策略：
   - `transparent: true`
   - `decorations: false`
   - `alwaysOnTop: true`
   - `focus: false`
   - 优先测试 `focusable: false`
5. 拖动策略：
   - 伴侣可交互区域处理 pointer events。
   - 拖动开始时调用 `startDragging()` 或自管位置更新。
   - 若开启 click-through，只能用于安静展示模式，不用于互动模式。
6. 状态通信：
   - 外部 wrapper/CLI -> local Rust endpoint。
   - Rust state store -> Tauri event -> Renderer。
   - Renderer -> Rust command 用于清除 error、暂停、恢复、退出。

## 必做 spike

Tauri 可行，但实现前需要做一个 1-2 小时窗口 spike：

- 透明窗口在 macOS 上是否符合预期。
- `focusable: false` 时是否还能稳定接收拖动/点击。
- `alwaysOnTop` 是否会覆盖全屏应用、Spaces、Mission Control 等场景。
- `setIgnoreCursorEvents` 是否能用于“安静穿透模式”，并能恢复互动。
- WebView 渲染 Petdex atlas 是否有透明边缘、模糊或帧抖动问题。

## 来源

- Tauri Window API: https://v2.tauri.app/reference/javascript/api/namespacewindow/
- Tauri configuration / window options: https://v2.tauri.app/reference/config/
- Tauri system tray: https://v2.tauri.app/learn/system-tray/
- Tauri shell plugin / sidecar: https://v2.tauri.app/reference/javascript/shell/
- Tauri Rust commands/events: https://v2.tauri.app/develop/calling-rust/
- Tauri distribution: https://v2.tauri.app/distribute/
