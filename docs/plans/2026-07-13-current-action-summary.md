# Current Action Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a compact, privacy-safe description of Codex's current tool action in the desktop companion.

**Architecture:** Keep the existing workflow `message` contract and interaction-card rendering path. Extend the Codex hook sender's `PreToolUse` classification to derive a basename-only file label or redacted command summary from a small allowlist of hook-input fields; unknown inputs retain the current generic message.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing workflow event contract.

---

### Task 1: Add focused failing coverage for activity summaries

**Files:**
- Modify: `packages/debug-cli/tests/debugCli.test.ts:772-819`
- Test: `packages/debug-cli/tests/debugCli.test.ts`

**Step 1: Write the failing tests**

Add `createCodexHookSignal` expectations for:

```ts
expect(createCodexHookSignal({
  hook_event_name: "PreToolUse",
  tool_name: "Read",
  tool_input: { file_path: "/Users/example/project/src/App.tsx" }
})).toMatchObject({ message: "正在读取 App.tsx" });

expect(createCodexHookSignal({
  hook_event_name: "PreToolUse",
  tool_name: "exec_command",
  tool_input: { command: "pnpm test" }
})).toMatchObject({ message: "正在运行 pnpm test" });

expect(createCodexHookSignal({
  hook_event_name: "PreToolUse",
  tool_name: "web_search",
  tool_input: { query: "private query" }
})).toMatchObject({ message: "正在进行网络搜索" });
```

Add a command test that proves secret-bearing environment assignments are not present in
the message, and a file-path test that proves parent directories are not present.

**Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @ai-partner/debug-cli test -- --runInBand`

Expected: The new filename and command expectations fail because the sender only reports
generic operation categories.

### Task 2: Derive safe status text in the Codex Hook sender

**Files:**
- Modify: `packages/debug-cli/src/codexHook.ts:250-327`
- Test: `packages/debug-cli/tests/debugCli.test.ts`

**Step 1: Implement the smallest safe helpers**

Change `messageForCodexHookEvent` to pass the full hook record to the activity formatter.
Add helpers which:

```ts
function activityMessageForTool(input: Record<string, unknown>): string {
  // classify the known tool family, then use only that family's allowlisted metadata
}

function safeFileBasename(input: Record<string, unknown>): string | undefined {
  // read only tool_input/toolInput fields such as file_path/path/filePath;
  // reject line breaks and return only the trailing filename
}

function safeCommandSummary(input: Record<string, unknown>): string | undefined {
  // read only tool_input/toolInput command/cmd fields;
  // remove secret-bearing assignments and flag values, then truncate
}
```

Use `正在读取 <basename>` and `正在更新 <basename>` when the basename is available.
Use `正在运行 <summary>` only when the summary is safe; otherwise fall back to
`正在运行本地命令`. Keep web/search text fixed at `正在进行网络搜索` regardless of the
search query.

**Step 2: Run the focused test to verify it passes**

Run: `pnpm --filter @ai-partner/debug-cli test`

Expected: PASS.

### Task 3: Verify integration boundaries

**Files:**
- Inspect: `packages/contracts/src/workflow.ts`
- Inspect: `frontend/src/partnerStateView.ts`
- Test: `frontend/src/partnerStateView.test.ts`

**Step 1: Confirm no transport or renderer change is required**

The workflow contract already permits a one-line `message`, and the interaction-card
view renders `message` as `statusText`. Keep the existing status-text layout untouched.

**Step 2: Run regression checks**

Run: `pnpm --filter @ai-partner/debug-cli test && pnpm --filter @ai-partner/frontend test && pnpm test:typecheck`

Expected: all tests and TypeScript checks pass.

### Task 4: Review and commit

**Files:**
- Review: `packages/debug-cli/src/codexHook.ts`
- Review: `packages/debug-cli/tests/debugCli.test.ts`

**Step 1: Inspect the final diff**

Run: `git diff --check && git diff -- packages/debug-cli/src/codexHook.ts packages/debug-cli/tests/debugCli.test.ts`

Expected: only the action-summary behavior and its tests are present; unrelated pending
Codex turn watcher changes remain untouched.

**Step 2: Commit the scoped change**

```bash
git add packages/debug-cli/src/codexHook.ts packages/debug-cli/tests/debugCli.test.ts docs/plans/2026-07-13-current-action-summary.md
git commit -m "feat: show current Codex action"
```
