# AI Partner MVP 内测分发说明

日期：2026-06-18
对象：1-3 位 Apple Silicon macOS 技术内测者。

这份文档是当前内部 DMG 的测试者操作单。Release 身份、范围、ready 证据、已知限制和非 MVP 清单以 [MVP Release Handoff](./mvp-release-handoff.md) 为准；如果本文和 handoff 冲突，以 handoff 为准。

## 制品

- DMG：`/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- 大小：3,169,209 bytes
- SHA256：`e6e27c086916f7e0e3238afe1871b062ee9118597996e06668d046686af9d23e`
- 产品源码 commit：`42b742e04ddd87e303e45dc2a5084926146084c5` (`42b742e fix: follow up interactive workflow card semantics`)
- Release handoff：`docs/mvp-release-handoff.md`
- 本轮制品包含 PR #4 merge 后的 interactive workflow card / authorization card 语义刷新，并保留本地伴侣 selector、runtime descriptor、packaged endpoint 和 stale descriptor smoke 通过状态。

安装前先校验 checksum：

```bash
shasum -a 256 "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
```

预期输出以这段开头：

```text
e6e27c086916f7e0e3238afe1871b062ee9118597996e06668d046686af9d23e
```

## 本轮 smoke 证据摘要

- `pnpm smoke:dmg:preflight` 通过，锁住 Tauri package config、DMG target、透明无边框 520x360 窗口、不抢焦点配置、asset protocol scope 和 CSP。
- `pnpm package:dmg` 通过。普通 sandbox 下 `hdiutil create` 先返回“设备未配置”；按规则提权重跑同一命令后产出 packaged app 和 DMG。本轮没有使用 `pnpm tauri:dev`。
- packaged app 从 `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` 以 `open -g -n` 后台启动。
- packaged app 写出 runtime descriptor：`appInstanceId=app_20260618T002008Z_19066_34bf036baaef20ad`，pid `19066`，port `58481`，`createdAt=2026-06-18T00:20:08.373788+00:00`；目录权限 `0700`，文件权限 `0600`，token 只记录长度 64，不记录明文。
- `pnpm debug:discover` 找到 packaged endpoint `http://127.0.0.1:58481/events`。
- `pnpm debug:send waiting` 携带 PR #4 authorization card 元数据发送成功：`run_id=run_smoke_20260618T002008Z`，`card_title=Install internal beta`，`context_path=docs/mvp-release-handoff.md`，`authorization.id=auth_pr4_internal_beta`，`authorization.status=pending`。
- `pnpm debug:send done --run-id run_smoke_20260618T002008Z` 对同一 run 发送成功，覆盖 interactive workflow card 从 waiting 到 done 的收口。
- 启动、waiting、done 和退出后的前台 app 均保持 `Codex`，未抢焦点。
- release 默认无 M0 debug panel：production build 和 `debugMode.test.ts` 均通过。
- selector/source variant/search empty state 基本可用：`AppProductUiBoundary.test.ts`、`companionSelector.test.ts` 和完整 frontend test run 通过。
- 本机 Artoria/Anya 伴侣路径存在且非空：`~/.petdex/pets/{artoria,anya-2}` 与 `~/.codex/pets/{artoria,anya-2}` 均有 `pet.json` 和 `spritesheet.webp`；相关真实素材 smoke、selector view-model 和 store 测试通过，未复制或提交任何私有宠物素材。
- 退出 packaged app 后，旧 descriptor copy `/private/tmp/ai-partner-pr4-runtime-descriptor-stale.json` 被 `debug:discover --descriptor` 判定为 `descriptor_stale: Runtime descriptor process is not alive.`，旧 port `58481` 不再监听。

## 安装步骤

1. 打开 DMG：

   ```bash
   open "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
   ```

2. 从挂载出来的 `AI Partner` 卷里，把 `AI Partner.app` 复制到 `/Applications` 或一个临时测试目录。
3. 启动复制后的 `AI Partner.app`。本轮内测请测试 DMG 里的 packaged app，不要用 `pnpm tauri:dev`。
4. 如果 macOS 因“无法验证开发者”拦截启动，请先确认上面的 SHA256 一致，再通过 Finder 的“打开”流程或“隐私与安全性”里的提示允许这一个 app。

## Codex `/partner` 入口

本轮也支持把 AI Partner 当作 Codex 里的显式开关使用。首次设置时在仓库根目录运行：

```bash
pnpm partner:install
```

之后用户输入 `/partner` 时，skill 应在仓库根目录运行 `pnpm partner`；也可以直接运行 `pnpm partner` 做同样的日常开关。

- Codex 当前从 repo-local `.agents/skills/<name>` 或用户级 `~/.codex/skills/<name>` 发现 slash-command skill；本仓库把可提交源文件放在 `skills/partner/`。
- `pnpm partner:install` 会构建 debug CLI、把 `skills/partner/` 同步到 `.agents/skills/partner/`、安装/更新全局 Codex hooks，并运行 hook check。
- 第一次运行：后台打开 packaged `AI Partner.app`，写出 runtime descriptor，之后 hook/wrapper 可以向本机 endpoint 发送 workflow 状态。
- 再运行一次：读取同一个 runtime descriptor，向 `127.0.0.1` 的 `/control/quit` 发送 bearer-token 保护的退出请求，让 companion 退出。
- 日常 `/partner` / `pnpm partner` 不跑 `pnpm tauri:dev`、不重新打包、不运行 `hdiutil`，只负责显示/退出 companion。
- 日常 `pnpm partner` 不会静默写全局 Codex 配置；如果 hooks 缺失，它只会提示运行 `pnpm partner:install`。
- 如果 app 已复制到其它位置，可用 `pnpm partner -- --app-path "/Applications/AI Partner.app"` 或 `AI_PARTNER_APP_PATH` 指定。

## Codex 全局状态 hook

`/partner` 只负责显示或退出 companion；如果要让当前 Codex Desktop 会话自动从 idle 进入 running/reading/editing/waiting/done，需要安装全局 Codex hook：

首次设置优先运行 `pnpm partner:install`。只想单独检查或重装 hooks 时，也可以运行 `pnpm codex:hooks:check` 或 `pnpm codex:hooks:install`。

- hook 安装到 `${CODEX_HOME:-~/.codex}/hooks.json`，采用 Petdex 风格的全局监听；AI Partner 是桌面级伴侣，应跟随 Codex 的所有项目和线程，而不是只在本仓库工作树里生效。
- 项目内只提交 hook sender 和安装/检查脚本；不会在日常 `/partner` / `pnpm partner` 时自动写全局配置。
- `codex-hook` 事件源只发送安全 workflow 元数据：事件名、状态、run id、短消息和 `code_context_allowed=false`；不发送 prompt、code、diff、clipboard、file content 或 screen text。
- `codex:wrap` 仍保留给明确通过 wrapper 启动的 Codex 子进程；它不能覆盖当前 Codex Desktop 会话本身。

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
2. 如需验证真实 Codex slash command，先运行 `pnpm partner:install`，再在 Codex 中输入 `/partner`；也可在仓库根目录直接运行 `pnpm partner`，确认第一次能打开 companion，再运行一次会退出 companion。
3. 确认首次启动不会抢走当前前台 app 的输入焦点。
4. 在仓库根目录运行 `pnpm debug:discover`，确认能找到 packaged app 的本机 `127.0.0.1` endpoint。
5. 运行 `pnpm debug:send waiting`，确认 UI 显示 waiting 状态、source/status 信息，以及可见的消息或气泡。
6. 运行 `pnpm debug:send done`，确认同一个 run 完成，并在短暂延迟后回到 idle。
7. 在另一个 app 里打字时，再运行一次 `pnpm debug:send waiting`，确认 AI Partner 保持可见但不会变成 focused app。
8. 按你的日常桌面环境试一下 M0 窗口交互：拖动窗口、如果可见则试 click-through/quiet 行为、切换 Spaces 或 fullscreen app，再回到普通桌面确认 app 仍可用。
9. 退出并重新启动 packaged app。再次运行 `pnpm debug:discover`，确认事件仍能打到新的运行实例。

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
