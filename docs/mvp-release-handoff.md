# AI Partner MVP Release Handoff

Date: 2026-06-18

## Release identity

- Release scope: macOS Codex technical preview / MVP internal beta DMG refresh after PR #4.
- Product source commit: `42b742e04ddd87e303e45dc2a5084926146084c5` (`42b742e fix: follow up interactive workflow card semantics`).
- Artifact binding: the DMG below was rebuilt from packaged release output on `main@42b742e` after PR #4 was merged. This handoff PR is documentation-only relative to the smoke-tested product build, so it records the refreshed artifact without changing packaged runtime behavior.
- DMG path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- DMG size: `3,169,209 bytes` (about `3.0 MiB`).
- DMG SHA256: `e6e27c086916f7e0e3238afe1871b062ee9118597996e06668d046686af9d23e`
- Packaged app path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app`
- Packaged app size: about `8.7 MiB` (`8,864 KiB` by `du -sk`).
- Codex setup after this handoff: run `pnpm partner:install` once to build the debug CLI, sync `.agents/skills/partner`, install/update global Codex hooks, and run the hook check.
- Codex entrypoint after setup: `/partner` should map to `pnpm partner`, which toggles the packaged companion on first run and exits it on the next run through the authenticated local control endpoint.
- Live Codex Desktop workflow states require the global hook listener installed by `pnpm partner:install`; `/partner` only toggles the companion window.

## Install

1. Open or mount the DMG:

   ```bash
   open "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
   ```

2. Copy `AI Partner.app` from the mounted `AI Partner` volume into `/Applications` or a temporary test directory.
3. Launch the copied `AI Partner.app`. For smoke verification, launch the packaged app itself rather than `pnpm tauri:dev`.

## Smoke verification summary

- `pnpm package:dmg` passed after the expected sandbox retry. The first run completed package preflight, frontend production build, Rust release build, and `.app` bundling, then `hdiutil create` returned `设备未配置`; the approved rerun completed `hdiutil create` and produced the DMG.
- `pnpm smoke:dmg:preflight` passed before packaging and confirmed the Tauri config, DMG target, 520x360 transparent/frameless always-on-top window, no-focus launch setting, scoped asset protocol, and CSP constraints.
- The packaged app was launched directly from `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app` with `open -g -n`; this smoke did not use `pnpm tauri:dev`.
- Runtime descriptor discovery succeeded for the packaged app: `schemaVersion=ai-partner.runtime-descriptor.v1`, `appInstanceId=app_20260618T002008Z_19066_34bf036baaef20ad`, `pid=19066`, `port=58481`, `createdAt=2026-06-18T00:20:08.373788+00:00`, and `tokenLength=64`.
- Runtime descriptor permissions passed: descriptor directory `0700`, descriptor file `0600`.
- `lsof` confirmed the packaged `ai-partner` process listened on `127.0.0.1:58481`.
- `pnpm debug:discover` found `http://127.0.0.1:58481/events` for the packaged app after localhost probing was rerun outside the sandbox.
- `pnpm debug:send waiting` succeeded with PR #4 authorization-card metadata: `run_id=run_smoke_20260618T002008Z`, `card_title=Install internal beta`, `context_path=docs/mvp-release-handoff.md`, `authorization.id=auth_pr4_internal_beta`, `authorization.status=pending`.
- `pnpm debug:send done --run-id run_smoke_20260618T002008Z` succeeded against the same packaged endpoint, proving the interactive workflow card can finish the same active run.
- Focus checks passed through launch, waiting, done, and quit: `osascript` reported the frontmost app as `Codex`; AI Partner did not take input focus.
- Release defaults keep the M0 debug panel hidden: `frontend/src/debugMode.test.ts` passed, and the production frontend build completed as part of `pnpm run package:dmg`.
- Selector/source variant/search empty state coverage passed through `frontend/src/AppProductUiBoundary.test.ts`, `frontend/src/companionSelector.test.ts`, and the full frontend test run.
- Local Artoria and Anya companion availability passed without copying or committing private assets: `~/.petdex/pets/{artoria,anya-2}` and `~/.codex/pets/{artoria,anya-2}` all had `pet.json` plus non-empty `spritesheet.webp`; `src-tauri` has a real-asset smoke test for those installed roots; selector view-model tests cover selected local companions without fallback.
- Artoria packaged launch path was exercised through the existing persisted selection `codex:artoria`. Anya was covered by real local asset metadata and selector/store tests rather than a screenshot, because Computer Use screenshot/text extraction was unavailable in this session.
- After exiting the smoke app process, the saved descriptor copy was stale: the old port `58481` no longer listened, and `pnpm debug:discover --descriptor /private/tmp/ai-partner-pr4-runtime-descriptor-stale.json` failed with `descriptor_stale: Runtime descriptor process is not alive.`
- No release blocker was found during the internal beta packaged DMG smoke.

Readiness evidence is complete in:

- `docs/m0-window-spike.md` under `2026-06-18 PR #4 internal beta packaged smoke`.
- `docs/ai-desktop-partner-engineering-implementation-plan.md` under `Release readiness`.

## Known limitations

- This is an ad-hoc/linker-signed internal build.
- Developer ID signing, notarization, stapling, and public Gatekeeper distribution have not been completed.
- This DMG is suitable for this machine and internal testing. It is not a public distribution package.
- External multi-display behavior is a roadmap/risk note, not an MVP guarantee.
- Current Codex Computer Use permissions were still pending for Accessibility and Screen Recording, so this smoke did not rely on automated screenshots or WebView text extraction as proof. The evidence uses package metadata, runtime descriptor permissions, localhost endpoint discovery, authorization-bearing debug event acceptance, focus checks, `lsof` process/port checks, and existing renderer/selector/real-asset tests.
- macOS process/window automation is permission-sensitive in this environment: sandboxed `pgrep`, `ps`, localhost probing, and `hdiutil` operations can fail with permission or device errors unless run with explicit local approval. Treat those as test-harness limits, not product runtime failures.
- `/partner` is a repo-level skill/CLI entrypoint, not a globally installed user skill. Codex discovers repo-local skills from `.agents/skills/<name>` and user skills from `~/.codex/skills/<name>`; the committed source lives in `skills/partner/`. Run `pnpm partner:install` for normal setup, or `pnpm skill:partner:sync` only when you intend to sync that skill root by itself.
- The Codex status listener is intentionally global, not repo-local, matching the Petdex model. The hook config lives in `${CODEX_HOME:-~/.codex}/hooks.json` after explicit install, while this repository only carries the safe `codex-hook` sender and install/check scripts. It sends workflow metadata only and keeps prompt text, code, diffs, clipboard, file contents, and screen text out of the ingress payload.
- Daily `/partner` / `pnpm partner` does not silently write global Codex configuration. If hooks are missing, it prints a `pnpm partner:install` prompt instead.
- The packaged app described above predates the latest `/control/quit` and Codex hook installer source changes; verify those again only after an explicit rebuild/package pass.

## Explicitly non-MVP

- Marketplace or asset marketplace flows.
- Multi-asset management UI.
- External multi-display experience.
