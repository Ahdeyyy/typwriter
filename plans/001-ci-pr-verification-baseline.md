# 001 — CI verification baseline (PR gate)

**Status:** DONE — `.github/workflows/ci.yml` created (rust + frontend jobs) exactly
as specified. Local verification: `cargo check --all-targets` clean, `bun run check`
clean (0 errors), `bun run check-types` passes (currently a no-op — no workspace
defines a `check-types` script yet, but the step is forward-compatible and the diff
must touch only `ci.yml`). Opening a test PR to confirm the two green checks is a
push action left to the maintainer.
**Written against:** commit `9baf8a5`
**Effort:** M · **Risk of change:** Low (additive — a new workflow file only)
**Do this plan first** — plans 002–004 use the gates it establishes as their done
criteria, and every future change benefits.

## Why

The repo has three GitHub Actions workflows (`.github/workflows/publish.yml`,
`android.yml`, `nightly.yml`) and **all of them build artifacts**; none run on pull
requests, and nothing anywhere runs `cargo check`, `cargo test`, `svelte-check`, or
lint as a gate. The existing Rust tests (in
`apps/typwriter-desktop/src-tauri/src/commands/format.rs` and
`src-tauri/src/vcs/restore.rs`) only run when a developer remembers to run them
locally. A full code review this month (`docs/code-review/README.md`, finding #8)
flagged this as the top structural gap.

## Repo facts you need

- Monorepo managed with `bun` (workspaces `apps/*`, `packages/*`), task runner
  `turbo`. Root scripts: `bun run lint`, `bun run check-types`, `bun run format`
  (prettier). The desktop app also has `bun run check` (svelte-check) and
  `bun test` defined in `apps/typwriter-desktop/package.json`.
- The Rust crate lives at `apps/typwriter-desktop/src-tauri/` (package name
  `typwriter`, lib `desktop_lib`).
- Building/checking Tauri on Ubuntu requires system packages. `nightly.yml` (line
  ~66) shows the exact set used by this repo:
  `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.
- Large crates can overflow the default stack during compilation on Windows runners —
  not a concern on `ubuntu-22.04`, which is what this workflow should use. If you do
  add a Windows job later, set `RUST_MIN_STACK: 8388608` in `env`.
- `swatinem/rust-cache@v2` with `workspaces: "./apps/typwriter-desktop/src-tauri -> target"`
  is the caching pattern already used in `nightly.yml` — reuse it (separate `key`).

## Steps

1. Create `.github/workflows/ci.yml`:

   ```yaml
   name: ci

   on:
     pull_request:
     push:
       branches: [master]
     workflow_dispatch:

   concurrency:
     group: ci-${{ github.ref }}
     cancel-in-progress: true

   jobs:
     rust:
       runs-on: ubuntu-22.04
       steps:
         - uses: actions/checkout@v4
         - name: install system dependencies
           run: |
             sudo apt-get update
             sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
         - uses: dtolnay/rust-toolchain@stable
         - uses: swatinem/rust-cache@v2
           with:
             workspaces: "./apps/typwriter-desktop/src-tauri -> target"
             key: ci
         - name: cargo check
           working-directory: apps/typwriter-desktop/src-tauri
           run: cargo check --all-targets
         - name: cargo test
           working-directory: apps/typwriter-desktop/src-tauri
           run: cargo test

     frontend:
       runs-on: ubuntu-22.04
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
         - run: bun install
         - name: svelte-check (desktop app)
           working-directory: apps/typwriter-desktop
           run: bun run check
         - name: typecheck all workspaces
           run: bun run check-types
   ```

2. Verify locally before pushing (each must pass on master today — if one fails,
   see Escape hatches):

   - `cargo check --all-targets` in `apps/typwriter-desktop/src-tauri/`
     (on Windows set `$env:RUST_MIN_STACK = "8388608"` first)
   - `cargo test` in the same directory — expect the existing `format.rs` /
     `vcs/restore.rs` tests to pass
   - `bun run check` in `apps/typwriter-desktop/`
   - `bun run check-types` at the repo root

3. Push the branch, open a PR, and confirm both jobs run and pass on the PR.

## Explicitly out of scope

- `cargo clippy -- -D warnings` — the codebase has known, benign clippy lints
  (`docs/code-review/README.md` item 22). Adding clippy as a *blocking* gate would
  fail immediately. Do not add it in this plan; it can become a follow-up once the
  lints are cleaned.
- `bun test` for the frontend — there are currently **zero** frontend tests; a job
  that runs an empty suite either fails or lies. Add the job when the first test
  lands (plan 002 adds Rust tests only).
- Windows/macOS CI legs, Android builds, release workflows — all exist or are
  deliberate omissions; do not touch `publish.yml`, `android.yml`, `nightly.yml`.
- Branch-protection settings (repo admin action, not a code change).

## Done criteria (machine-checkable)

1. `ci.yml` exists; `gh workflow list` shows `ci`.
2. A test PR shows two green checks: `rust`, `frontend`.
3. The four local commands in step 2 pass.
4. `git diff --stat master` touches only `.github/workflows/ci.yml`.

## Maintenance note

When the `typwriter-mobile` app (`plans/typwriter-mobile/`) lands, add its
`src-tauri` to the rust job (second cargo check/test) and its `bun run check` to the
frontend job. When the first `bun test` suite exists, add a `bun test` step.

## Escape hatches

- If `cargo check` fails **on current master** for a reason unrelated to your change
  (e.g. a platform-gated module), STOP and report the error verbatim instead of
  patching source code — source fixes are other plans' scope.
- If `bun run check-types` fails in `typwriter-web` or `packages/*`, scope the step
  to the desktop app (`bun run check` only) and note the exclusion in the workflow
  with a comment.
