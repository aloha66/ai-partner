# Current Action Summary Design

## Goal

Replace the generic active-work message in the desktop companion with one compact,
live description of the operation Codex is performing.

## User Experience

The interaction card continues to show one active workflow snapshot. Its status line
reports the most recent action only; it does not show a history, an expandable list,
or file contents.

Examples:

- `正在读取 package.json`
- `正在更新 App.tsx`
- `正在运行 pnpm test`
- `正在进行网络搜索`

The existing project/worktree metadata stays compact and must not expose full paths in
the card body.

## Data Flow

`PreToolUse` already reaches `packages/debug-cli/src/codexHook.ts` before an operation
executes. The sender will classify the tool and produce a short message from safe
metadata in the hook input. The existing workflow event and `interactiveCardView` then
render that message without adding a new transport field or UI expansion state.

## Privacy And Safety

- Never send or render file contents, diffs, prompt text, clipboard data, screen text,
  or full filesystem paths.
- For file operations, use only the basename when the hook input exposes a path.
- For command operations, show a short normalized command summary after removing
  values for common secret-bearing flags and environment assignments. If a safe summary
  cannot be derived, show the operation category only.
- For web/search operations, show that a search is underway but not the query text or
  fetched page content.
- Keep the existing workflow message limit and single-line contract.

## Operation Mapping

| Tool family | Workflow state | Status message |
| --- | --- | --- |
| Read/list/find/view | `reading` | `正在读取 <basename>` or `正在读取项目文件` |
| Web/search/fetch/browse | `reading` | `正在进行网络搜索` |
| Write/edit/patch | `editing` | `正在更新 <basename>` or `正在写入项目内容` |
| Exec/shell/terminal | `running` | `正在运行 <safe command>` or `正在运行本地命令` |
| Other tools | `running` | `正在处理任务` |

## Validation

Unit tests will cover hook payloads with multiple possible input shapes, basename-only
file labels, secret-safe command fallback, network-search privacy, and the existing
current-card rendering path. The focused debug CLI and frontend test suites, followed
by workspace type checks, are the completion bar.
