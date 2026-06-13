# AI Partner MVP 内测分发说明

日期：2026-06-13
对象：1-3 位 Apple Silicon macOS 技术内测者。

这份文档是当前内部 DMG 的测试者操作单。Release 身份、范围、ready 证据、已知限制和非 MVP 清单以 [MVP Release Handoff](./mvp-release-handoff.md) 为准；如果本文和 handoff 冲突，以 handoff 为准。

## 制品

- DMG：`/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- 大小：3,059,201 bytes
- SHA256：`3a24a423cf8371eeaa9a891eca8ec1489aa2d3d2e1b7dac667fcaa0b6e8ac2eb`
- Release handoff：`docs/mvp-release-handoff.md`
- 本轮制品包含 MVP 内测本机事件流 HTTP 400 边缘问题修复。

安装前先校验 checksum：

```bash
shasum -a 256 "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
```

预期输出以这段开头：

```text
3a24a423cf8371eeaa9a891eca8ec1489aa2d3d2e1b7dac667fcaa0b6e8ac2eb
```

## 安装步骤

1. 打开 DMG：

   ```bash
   open "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
   ```

2. 从挂载出来的 `AI Partner` 卷里，把 `AI Partner.app` 复制到 `/Applications` 或一个临时测试目录。
3. 启动复制后的 `AI Partner.app`。本轮内测请测试 DMG 里的 packaged app，不要用 `pnpm tauri:dev`。
4. 如果 macOS 因“无法验证开发者”拦截启动，请先确认上面的 SHA256 一致，再通过 Finder 的“打开”流程或“隐私与安全性”里的提示允许这一个 app。

## macOS 签名限制

这个构建只适合小范围技术内测：

- 当前是 ad-hoc/linker-signed build。
- 未做 Developer ID signing。
- 未做 notarization。
- 未做 stapling。
- Gatekeeper 可能警告、拦截首次启动，或要求用户手动允许。
- 不要公开分发，也不要发给非技术用户。

## 内测任务

请按下面任务记录结果。通过项可以简短写；失败项请写清楚步骤、macOS 版本、Apple Silicon 机型，并附上有帮助的截图或终端输出。

1. 挂载 DMG，复制 app，启动复制后的 packaged app，确认默认 `AI Partner M0` 窗口出现。
2. 确认首次启动不会抢走当前前台 app 的输入焦点。
3. 在仓库根目录运行 `pnpm debug:discover`，确认能找到 packaged app 的本机 `127.0.0.1` endpoint。
4. 运行 `pnpm debug:send waiting`，确认 UI 显示 waiting 状态、source/status 信息，以及可见的消息或气泡。
5. 运行 `pnpm debug:send done`，确认同一个 run 完成，并在短暂延迟后回到 idle。
6. 在另一个 app 里打字时，再运行一次 `pnpm debug:send waiting`，确认 AI Partner 保持可见但不会变成 focused app。
7. 按你的日常桌面环境试一下 M0 窗口交互：拖动窗口、如果可见则试 click-through/quiet 行为、切换 Spaces 或 fullscreen app，再回到普通桌面确认 app 仍可用。
8. 退出并重新启动 packaged app。再次运行 `pnpm debug:discover`，确认事件仍能打到新的运行实例。

## 反馈模板

```markdown
## 测试者

- 姓名：
- 日期：
- Mac 型号 / 芯片：
- macOS 版本：
- 安装位置：
- DMG checksum 是否一致：是/否

## 安装

- DMG 是否可挂载：
- App 是否可复制：
- 是否看到 Gatekeeper 或安全提示：
- 是否需要手动允许启动：

## 启动

- App 是否可启动：
- 默认 AI Partner M0 窗口是否可见：
- 首次启动是否抢焦点：是/否
- 备注：

## M0 窗口

- 透明 / 无边框 / 置顶行为：
- 拖动行为：
- Click-through 或 quiet 行为：
- Spaces / fullscreen 行为：
- 是否有视觉问题、裁切、重叠或帧模糊：

## 事件状态

- `pnpm debug:discover` 结果：
- `pnpm debug:send waiting` 结果：
- `pnpm debug:send done` 结果：
- 状态是否回到 idle：是/否
- 终端是否有错误：

## 焦点行为

- 启动时的前台 app：
- waiting/done 事件后的前台 app：
- AI Partner 是否意外抢焦点：
- 如果抢焦点，复现步骤：

## 主观感受

- 伴侣是否“看得见但不打扰”：
- 状态和气泡是否容易理解：
- 有什么困惑或烦人的地方：

## 阻塞问题

- 阻塞问题：
- 严重程度：
- 精确复现步骤：
- 截图或日志路径：
- workaround 后是否还能继续测试：
```
