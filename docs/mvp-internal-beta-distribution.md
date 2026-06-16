# AI Partner MVP 内测分发说明

日期：2026-06-16
对象：1-3 位 Apple Silicon macOS 技术内测者。

这份文档是当前内部 DMG 的测试者操作单。Release 身份、范围、ready 证据、已知限制和非 MVP 清单以 [MVP Release Handoff](./mvp-release-handoff.md) 为准；如果本文和 handoff 冲突，以 handoff 为准。

## 制品

- DMG：`/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- 大小：3,144,504 bytes
- SHA256：`26ad69629e4ead31c29340a3763f97a928a123b8143f9817c9284f398a536cd4`
- 产品源码 commit：`0098ec2901e244aa16cac00a324d3c440fc42762` (`0098ec2 Merge pull request #2 from aloha66/codex/selector-v1`)
- Release handoff：`docs/mvp-release-handoff.md`
- 本轮制品包含 PR #2 merge 后的本地伴侣 selector/source variant/search empty state 刷新，并保留 MVP 本机事件流 smoke 通过状态。

安装前先校验 checksum：

```bash
shasum -a 256 "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
```

预期输出以这段开头：

```text
26ad69629e4ead31c29340a3763f97a928a123b8143f9817c9284f398a536cd4
```

## 本轮 smoke 证据摘要

- `pnpm run package:dmg` 通过，产出 packaged app 和 DMG；本轮没有使用 `pnpm tauri:dev`。
- DMG 以 read-only 方式挂载并通过 image CRC 校验；卷内包含 `AI Partner.app` 和 `Applications -> /Applications` symlink。
- 从 DMG 复制到 `/private/tmp/ai-partner-dmg-smoke.p8WjQ0/install/AI Partner.app` 后以后台方式启动 packaged app。
- packaged app 写出 runtime descriptor；目录权限 `0700`，文件权限 `0600`，token 只记录长度 64，不记录明文。
- `pnpm debug:discover` 找到 packaged endpoint `http://127.0.0.1:54083/events`。
- `pnpm debug:send running/reading/waiting/done` 均发送成功，run id 为 `run_smoke_20260616T130915Z`。
- release 默认无 M0 debug panel：production build 和 `debugMode.test.ts` 均通过。
- selector/source variant/search empty state 基本可用：`AppProductUiBoundary.test.ts`、`companionSelector.test.ts` 和完整 frontend test run 通过。
- 本机 Artoria/Anya 伴侣路径存在且非空：`~/.petdex/pets/{artoria,anya-2}` 与 `~/.codex/pets/{artoria,anya-2}` 均有 `pet.json` 和 `spritesheet.webp`；相关真实素材 smoke、selector view-model 和 store 测试通过，未复制或提交任何私有宠物素材。
- 退出 packaged app 后，旧 descriptor 被 `debug:discover --descriptor` 判定为 `descriptor_stale`，旧 port 不再监听。

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

## 自动化限制

- Codex Computer Use 的 Accessibility / Screen Recording 权限在本轮 smoke 时仍处于 pending 状态，所以没有把自动截图或 WebView 文本抽取作为通过依据。
- 当前 macOS 自动化命令受权限和沙箱影响明显：`pgrep`、`ps`、System Events、localhost probing、`hdiutil` mount/create 在受限环境中可能失败。本轮用 package metadata、runtime descriptor、debug endpoint、`lsof`、前端/ Rust 测试和 stale descriptor 验证作为证据。
- 测试者如果手动截图反馈，请注意不要包含私有代码、聊天内容或桌面敏感信息。

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
