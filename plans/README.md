# Plans index

Implementation plans written for executor agents (or humans) with no other context.
Each plan is self-contained: read the plan, not this repo's history. Update the
Status column as work proceeds (`TODO` → `IN PROGRESS` → `DONE`, or `BLOCKED: why`).

Written against commit `9baf8a5` (2026-06). Plans stamp the same commit; if the
cited code has moved, re-verify before executing.

**Status as of 2026-07-11: every plan below is DONE** — the four desktop-audit
plans (001–004), all eight typwriter-mobile phases (00–08), and 005 (remove
legacy mobile code from the desktop app).

## Desktop app — remove legacy mobile code (2026-07)

Now that `apps/typwriter-mobile/` is the mobile app, the Android/SAF code paths
still living inside `apps/typwriter-desktop/` are dead weight. Plan 005 removes
them; it is written for an executor with no other context and stamped against
`e4bf10d`.

| # | Plan | What | Effort | Status |
|---|------|------|--------|--------|
| 005 | [005-remove-mobile-from-desktop.md](005-remove-mobile-from-desktop.md) | Strip all mobile/Android/SAF code from typwriter-desktop (CI, frontend, Rust, manifests) | M | DONE |

## Desktop app (`apps/typwriter-desktop`) — from the June 2026 audit

Source findings: `docs/code-review/README.md` (full audit, vetted 2026-06-12).
Recommended order: 001 first (it gates everything after), then 002–004 in any order.

| # | Plan | What | Effort | Status |
|---|------|------|--------|--------|
| 001 | [001-ci-pr-verification-baseline.md](001-ci-pr-verification-baseline.md) | PR CI gate: cargo check/test + svelte-check + typecheck | M | DONE |
| 002 | [002-fix-world-today-utc-offset.md](002-fix-world-today-utc-offset.md) | `World::today` treats UTC-hour offset as days — wrong dates in documents | S | DONE |
| 003 | [003-unify-file-type-detection.md](003-unify-file-type-detection.md) | Drifted text/image extension allowlists; backend response becomes the single authority | S–M | DONE |
| 004 | [004-gate-workspace-diagnostics.md](004-gate-workspace-diagnostics.md) | Whole-workspace recompile on every keystroke → refresh only on Save/Watcher/Explicit/MainFile | M | DONE |

Selection note: this run was non-interactive; per the advisor default, the top 4
findings by leverage were planned. Remaining vetted findings worth planning next
(in rough leverage order — see `docs/code-review/README.md` for detail):

- Make heavy `#[tauri::command]`s async (audit Phase-2 item 6) — high impact, but
  touches ~50 commands; plan it after 001 gives a safety net.
- Route `collect_workspace_diagnostics`'s file walk through `WorkingTreeFs` so SAF
  workspaces get cross-file diagnostics (audit Phase-1 item 3; deliberately split
  out of 004).
- Typed errors via `thiserror` (audit Phase 3).
- ~~Stale `generate-parser` script + `typst.grammar` references~~ **DONE (2026-06-13)**:
  removed the `generate-parser` script and the unused `@lezer/generator` devDependency
  from `apps/typwriter-desktop/package.json`, and corrected the CLAUDE.md / AGENTS.md
  descriptions — the parser is hand-written at
  `src/lib/typst-codemirror-lang/lezer-typst/parser.ts` (no grammar, no codegen).

## Mobile app (new, standalone) — `typwriter-mobile/`

A phased build plan for the new `apps/typwriter-mobile/` app. **All phases
completed** (the app now lives at `apps/typwriter-mobile/`). Start at
[typwriter-mobile/00-overview.md](typwriter-mobile/00-overview.md); phases are
strictly ordered and the overview holds the status table.

Reviewed and corrected 2026-06-12 against desktop `9baf8a5`:

- **04-editor §4.1 rewritten** — it instructed copying `typst.grammar` + a generated
  `parser/` dir that do not exist; the real parser is hand-written TypeScript. File
  list now matches the actual tree.
- **01-scaffold** — dropped the `generate-parser` script, `@lezer/generator`, and
  `@lezer/lr` (not needed by the hand-written parser); added the missing
  `android-fs:default` capability.
- **02-rust-core** — added a correct `World::today` spec (the desktop version has
  the bug plan 002 fixes; "model on desktop" would have copied it) and a
  `cargo test` unit-test section (UTF-16 helpers, path-traversal guard, URL parse).
- **05-completions** — added `bun test` specs for `flattenSnippet` and the
  auto-trigger predicate.
- **00-overview** — snapshot anchor + drift instructions, per-phase status column,
  reconciled the `tauri-plugin-android-fs` phase note with 01.

## Considered and rejected (do not re-audit)

- `Box::leak` on font reload, unbounded in-memory source/file caches, the
  `previewimg://` immutable-cache design — reviewed in `docs/code-review/README.md`
  ("deliberate trade-offs to keep"); by design.
- Honoring the desktop's 8 ms typing-IPC throttle as a "bug" — it's a deliberate
  throttle; the *payload size* is the issue (audit Phase-2 item 8), not the timer.
- Re-auditing categories already covered by `docs/code-review/` (correctness, perf,
  tech debt, tests for the desktop app) — that audit is current as of this commit;
  reconcile against it instead of re-running.
