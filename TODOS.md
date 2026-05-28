# TODOs

## macOS signing, notarization, and releases

- **What:** Add signing, notarization, GitHub Releases, and update strategy for Tauri macOS builds.
- **Why:** Phase 0/1 are dev-build only; external users need an installable, trusted, updateable app.
- **Pros:** Makes the app testable by real users and reduces Gatekeeper/security friction.
- **Cons:** Requires Apple Developer account, certificates, CI secrets, release packaging, and updater policy.
- **Context:** The engineering review explicitly deferred distribution from the first slice. The plan should stay honest: local dev build first, signed downloadable release later.
- **Depends on / blocked by:** Phase 1 Tauri app must run reliably before this is worth doing.

## Multi-session aggregation

- **What:** Design and implement aggregation across multiple Codex sessions, including conflict rules when one session is running and another needs user attention.
- **Why:** The target user is likely a long-running or multi-session Codex power user; single-session support proves the attention model but does not cover the full real workflow.
- **Pros:** Reduces missed confirmations across workspaces and makes the product materially more useful for heavy Codex users.
- **Cons:** Requires reliable session identity, aggregation UI, conflict policy, and stronger state semantics.
- **Context:** The review narrowed Phase 0/1 to one active session, but outside voice flagged that this may under-serve the target user if left unresolved.
- **Depends on / blocked by:** Phase 0 must prove session identity can be detected; Phase 1 must prove the single-session attention model.

## Desktop UI interaction E2E

- **What:** Add full desktop E2E coverage for dragging, position memory, context menu, pause/resume, hide bubbles, restart recovery, multi-display behavior, and macOS Spaces/fullscreen interactions.
- **Why:** Phase 1 should only smoke-test the window; the real desktop overlay risk is in platform interaction details.
- **Pros:** Catches white screens, focus stealing, broken menus, position drift, and overlay behavior that users notice immediately.
- **Cons:** Desktop E2E is slower, more fragile, and more environment-dependent than core logic tests.
- **Context:** The engineering review chose core state-chain coverage plus a minimal Tauri smoke test for the first slice.
- **Depends on / blocked by:** Phase 1 minimal Tauri window must be stable first.

## Companion mode, touch interaction, and memory

- **What:** Design companion mode, touch regions, personality/emotion behavior, optional model integration, and memory permission controls.
- **Why:** These are long-term product differentiators, but they are not the foundation of the Codex attention radar.
- **Pros:** Can turn the app from a status layer into a richer desktop companion once the attention signal proves value.
- **Cons:** Adds privacy, memory editing/deletion, model-provider disclosure, interaction design, and permission-boundary complexity.
- **Context:** The business requirements describe these capabilities, while the engineering review explicitly kept them out of V1.
- **Depends on / blocked by:** Codex attention radar must first prove that users trust and keep the pet running.
