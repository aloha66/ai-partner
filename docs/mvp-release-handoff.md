# AI Partner MVP Release Handoff

Date: 2026-06-16

## Release identity

- Release scope: macOS Codex technical preview / MVP internal beta DMG refresh after PR #2.
- Product source commit: `0098ec2901e244aa16cac00a324d3c440fc42762` (`0098ec2 Merge pull request #2 from aloha66/codex/selector-v1`).
- Artifact binding: the DMG below was rebuilt from packaged release output on `0098ec2`. This handoff PR is documentation-only relative to the smoke-tested product build, so it records the refreshed artifact without changing packaged runtime behavior.
- DMG path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- DMG size: `3,144,504 bytes` (about `3.0 MiB`).
- DMG SHA256: `26ad69629e4ead31c29340a3763f97a928a123b8143f9817c9284f398a536cd4`
- Packaged app path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app`
- Packaged app size: about `8.6 MiB` (`8,824 KiB` by `du -sk`).

## Install

1. Open or mount the DMG:

   ```bash
   open "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
   ```

2. Copy `AI Partner.app` from the mounted `AI Partner` volume into `/Applications` or a temporary test directory.
3. Launch the copied `AI Partner.app`. For smoke verification, launch the packaged app itself rather than `pnpm tauri:dev`.

## Smoke verification summary

- `pnpm run package:dmg` passed. It ran the macOS package preflight, `tauri build --bundles app`, frontend production build, Rust release build, app bundling, and `hdiutil create`.
- The DMG mounted read-only at `/private/tmp/ai-partner-dmg-smoke.p8WjQ0/mount` with image CRC verification. The mounted volume contained `AI Partner.app` and an `Applications -> /Applications` symlink.
- A temporary install copied from the DMG with `ditto` launched via `open -g -n "/private/tmp/ai-partner-dmg-smoke.p8WjQ0/install/AI Partner.app"`.
- Runtime descriptor discovery succeeded for the packaged app: `schemaVersion=ai-partner.runtime-descriptor.v1`, `appInstanceId=app_20260616T130915Z_615_e165aa403295565f`, `pid=615`, `port=54083`, `createdAt=2026-06-16T13:09:15.205778+00:00`, and `tokenLength=64`.
- Runtime descriptor permissions passed: descriptor directory `0700`, descriptor file `0600`.
- `lsof` confirmed the running process came from the temporary DMG install path and listened on `127.0.0.1:54083`.
- `pnpm debug:discover` found `http://127.0.0.1:54083/events` for the packaged app.
- `pnpm debug:send running`, `reading`, `waiting`, and `done` all succeeded against the packaged endpoint using run id `run_smoke_20260616T130915Z`.
- Release defaults keep the M0 debug panel hidden: `frontend/src/debugMode.test.ts` passed, and the production frontend build completed as part of `pnpm run package:dmg`.
- Selector/source variant/search empty state coverage passed through `frontend/src/AppProductUiBoundary.test.ts`, `frontend/src/companionSelector.test.ts`, and the full frontend test run.
- Local Artoria and Anya companion availability passed without copying or committing private assets: `~/.petdex/pets/{artoria,anya-2}` and `~/.codex/pets/{artoria,anya-2}` all had `pet.json` plus non-empty `spritesheet.webp`; `src-tauri` has a real-asset smoke test for those installed roots; selector view-model tests cover selected local companions without fallback.
- Artoria packaged launch path was exercised through the existing persisted selection `codex:artoria`. Anya was covered by real local asset metadata and selector/store tests rather than a screenshot, because Computer Use screenshot/text extraction was unavailable in this session.
- After exiting the smoke app process, the descriptor file remained present but was stale: the old port no longer listened, `lsof -p 615` was empty, and `pnpm debug:discover --descriptor /private/tmp/ai-partner-dmg-smoke.p8WjQ0/runtime-descriptor-active.json` failed with `descriptor_stale: Runtime descriptor process is not alive.`
- No release blocker was found during the internal beta packaged DMG smoke.

Readiness evidence is complete in:

- `docs/m0-window-spike.md` under `2026-06-11 MVP DMG readiness smoke`.
- `docs/ai-desktop-partner-engineering-implementation-plan.md` under `Release readiness`.

## Known limitations

- This is an ad-hoc/linker-signed internal build.
- Developer ID signing, notarization, stapling, and public Gatekeeper distribution have not been completed.
- This DMG is suitable for this machine and internal testing. It is not a public distribution package.
- External multi-display behavior is a roadmap/risk note, not an MVP guarantee.
- Current Codex Computer Use permissions were still pending for Accessibility and Screen Recording, so this smoke could not rely on automated screenshots or WebView text extraction as proof. The evidence uses package metadata, runtime descriptor permissions, localhost endpoint discovery, debug event acceptance, `lsof` process/port checks, and existing renderer/selector/real-asset tests.
- macOS process/window automation is permission-sensitive in this environment: sandboxed `pgrep`, `ps`, localhost probing, and `hdiutil` operations can fail with permission or device errors unless run with explicit local approval. Treat those as test-harness limits, not product runtime failures.

## Explicitly non-MVP

- Marketplace or asset marketplace flows.
- Multi-asset management UI.
- External multi-display experience.
