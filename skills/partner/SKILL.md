---
name: partner
description: Toggle the AI Partner macOS desktop companion from Codex. Use when the user types /partner or asks to open, show, close, hide, quit, or toggle the AI Partner companion so hooks can send workflow status events to it.
---

# Partner

Use this skill as the slash-command entry for AI Partner.

## Install

Run this once from the repository root when setting up AI Partner for Codex:

```bash
pnpm partner:install
```

Behavior:

- Builds the debug CLI used by the local sender and Codex hook.
- Syncs the repo-local slash-command skill from `skills/partner/` to `.agents/skills/partner/`.
- Installs or updates the global Codex hooks at `${CODEX_HOME:-~/.codex}/hooks.json`.
- Runs the hook check so missing or stale hook configuration fails loudly during setup.

## Toggle

Run this command from the repository root. Execute it directly; do not only describe the command.

```bash
pnpm partner
```

Behavior:

- If AI Partner is not running, the command opens the packaged app at `src-tauri/target/release/bundle/macos/AI Partner.app`.
- If AI Partner is already running, the command sends an authenticated localhost `/control/quit` request to the runtime descriptor endpoint and exits the app.
- After toggling, the command checks whether Codex hooks are installed and prints a clear `pnpm partner:install` prompt if live status updates are not configured.
- The normal toggle does not silently write global Codex config.
- Do not start `pnpm tauri:dev`, build a DMG, run `hdiutil`, or run smoke checks for a normal `/partner` toggle.

## Custom App Path

If the packaged app lives somewhere else, pass:

```bash
pnpm partner -- --app-path "/Applications/AI Partner.app"
```

The command also honors `AI_PARTNER_APP_PATH`.

## Hook Boundary

`/partner` only toggles the companion window. Live workflow states come from hook or wrapper
senders that reuse the existing runtime descriptor flow:

```bash
pnpm debug:send waiting --source claude-hook --message "需要用户确认"
```

For the current Codex Desktop session, use the global Codex hook listener instead of the
subprocess wrapper:

```bash
pnpm partner:install
pnpm codex:hooks:check
```

The hook is global under `${CODEX_HOME:-~/.codex}/hooks.json`, matching the Petdex-style
listener model, because AI Partner is a desktop-level companion and should follow Codex
across projects. The repository only provides the installer and hook sender; installing
the global listener is an explicit user action.

Keep hook payloads to safe workflow metadata only. Do not send prompt text, code, diffs,
clipboard, file contents, or screen text. Use `codex:wrap` only for Codex subprocess status
events that are intentionally launched through that wrapper.
