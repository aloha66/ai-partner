# AI Partner MVP Release Handoff

Date: 2026-06-11

## Release identity

- Release scope: macOS Codex technical preview / MVP internal DMG handoff.
- Git commit: `a6561be557f747ef6080f79a0e9a64d1bd0bc036` (`a6561be docs(release): record mvp dmg readiness smoke`).
- Artifact binding: the DMG below is the MVP readiness artifact recorded and handed off against commit `a6561be`. Commit `a6561be` is documentation-only relative to the smoke-tested product build, so it does not change packaged runtime behavior.
- DMG path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg`
- DMG size: `3,059,708 bytes` (about `2.9 MiB`).
- DMG SHA256: `b1c0ac42f766f1e6c2eb62bebdbe69e9283fe75c2098ba925d060b270207cd8f`
- Packaged app path: `/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/macos/AI Partner.app`
- Packaged app size: about `8.4 MiB`.

## Install

1. Open or mount the DMG:

   ```bash
   open "/Users/aloha66/code/ai-partner/src-tauri/target/release/bundle/dmg/AI Partner_0.1.0_aarch64.dmg"
   ```

2. Copy `AI Partner.app` from the mounted `AI Partner` volume into `/Applications` or a temporary test directory.
3. Launch the copied `AI Partner.app`. For smoke verification, launch the packaged app itself rather than `pnpm tauri:dev`.

## Smoke verification summary

- `pnpm package:dmg` passed and produced the DMG above.
- The DMG mounted read-only at `/Volumes/AI Partner`.
- The mounted volume contained `AI Partner.app` and an `Applications -> /Applications` symlink.
- A temporary install from the DMG launched successfully.
- The default `AI Partner M0` window was visible.
- `pnpm debug:discover` found the packaged app runtime descriptor endpoint.
- `pnpm debug:send waiting` and `pnpm debug:send done` both succeeded; `done` reused the active waiting run id.
- Launching the packaged app and sending debug events did not steal focus from the foreground app.
- No release blocker was found during the MVP DMG readiness smoke.

Readiness evidence is complete in:

- `docs/m0-window-spike.md` under `2026-06-11 MVP DMG readiness smoke`.
- `docs/ai-desktop-partner-engineering-implementation-plan.md` under `Release readiness`.

## Known limitations

- This is an ad-hoc/linker-signed internal build.
- Developer ID signing, notarization, stapling, and public Gatekeeper distribution have not been completed.
- This DMG is suitable for this machine and internal testing. It is not a public distribution package.
- External multi-display behavior is a roadmap/risk note, not an MVP guarantee.

## Explicitly non-MVP

- Partner search or partner switching.
- Marketplace or asset marketplace flows.
- Multi-asset management UI.
- External multi-display experience.
