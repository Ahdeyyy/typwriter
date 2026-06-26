# 002 — Fix `World::today`: offset is hours from UTC, not days

**Status:** DONE — added the pure `today_with_offset(utc_now, offset)` helper (offset
= UTC hours via `FixedOffset::east_opt`), rewired `EditorWorld::today` to call it, and
added a `#[cfg(test)] mod tests` covering the hours-not-days fix (Some(0)/Some(1)/
Some(-1) at 2026-06-11T23:30Z), the absurd-offset → `None` guard, and the local-time
`None` path. `cargo check --all-targets` clean (type-checks the test module too).
Local `cargo test` execution is blocked by this Windows machine's link-time
memory/PDB limits (the heavy Tauri cdylib won't link here — see root memory); the
tests run in CI on `ubuntu-22.04` via plan 001. Diff limited to `src/world/mod.rs`.
**Written against:** commit `9baf8a5`
**Effort:** S · **Risk of change:** Low (one function + new unit tests)
**Depends on:** nothing (001 recommended first so CI runs the new tests)

## Why

Typst's `World::today(offset)` contract defines `offset` as **the UTC offset in
hours** — it backs the user-facing `datetime.today(offset: ..)` function. The
desktop app's implementation treats it as a number of **days to add to the current
date**, so `#datetime.today(offset: 1)` in a document renders *tomorrow's date*
instead of the date in UTC+1. Confirmed in this month's code review
(`docs/code-review/README.md`, finding #1) and re-verified against source.

## Current state

`apps/typwriter-desktop/src-tauri/src/world/mod.rs:468` (inside
`impl typst::World for EditorWorld`):

```rust
fn today(&self, offset: Option<i64>) -> Option<Datetime> {
    let now = chrono::Local::now();
    let date = if let Some(days) = offset {
        now + chrono::Duration::days(days)
    } else {
        now
    };
    Some(Datetime::from_ymd(
        date.year(),
        date.month() as u8,
        date.day() as u8,
    )?)
}
```

`chrono = "0.4.44"` is already a dependency. The file's existing style: `///` doc
comments explaining *why*, no `unwrap` in trait impls (use `?` on `Option`).

## Steps

1. In `world/mod.rs`, add a **pure, testable helper** near `today` (free function in
   the same module, not a method — it must be callable without constructing
   `EditorWorld`, which requires a Tauri runtime):

   ```rust
   /// Resolve "today" for `World::today`. Typst defines `offset` as the UTC
   /// offset in whole hours (backing `datetime.today(offset: ..)`); `None`
   /// means local time.
   fn today_with_offset(utc_now: chrono::DateTime<chrono::Utc>, offset: Option<i64>) -> Option<Datetime> {
       use chrono::{Datelike, FixedOffset, Local};
       let (year, month, day) = match offset {
           None => {
               let now = utc_now.with_timezone(&Local);
               (now.year(), now.month(), now.day())
           }
           Some(hours) => {
               let secs = i32::try_from(hours).ok()?.checked_mul(3600)?;
               let now = utc_now.with_timezone(&FixedOffset::east_opt(secs)?);
               (now.year(), now.month(), now.day())
           }
       };
       Datetime::from_ymd(year, month as u8, day as u8)
   }
   ```

2. Replace the body of `EditorWorld::today` with:

   ```rust
   fn today(&self, offset: Option<i64>) -> Option<Datetime> {
       today_with_offset(chrono::Utc::now(), offset)
   }
   ```

   Keep whatever imports the file already has; add only what's missing. Note the
   existing code imports `Datelike` traits — check the file's `use` block first.

3. Add unit tests in the same file (follow the existing test-module pattern in
   `src-tauri/src/commands/format.rs` — `#[cfg(test)] mod tests` at the bottom):

   - At `utc_now = 2026-06-11T23:30:00Z`: `offset: Some(0)` → June 11;
     `offset: Some(1)` → June 12 (crosses midnight east);
     `offset: Some(-1)` → June 11.
   - `offset: Some(24 * 365)` (absurd hour count) must not panic — returns `None`
     (rejected by `FixedOffset::east_opt`, which caps at ±24h… verify: `east_opt`
     accepts up to ±86_400 secs exclusive; the multiply guard plus `east_opt`
     handles it).
   - `offset: None` returns `Some` (can't assert the exact date — it's
     local-time-dependent; assert it's not `None`).

4. Verify:
   - `cargo check` in `apps/typwriter-desktop/src-tauri/`
     (Windows: `$env:RUST_MIN_STACK = "8388608"` first) — expect clean.
   - `cargo test today` — expect the new tests to pass.
   - Manual (optional, requires running the app): a workspace `main.typ` containing
     `#datetime.today(offset: 0).display()` and
     `#datetime.today(offset: 12).display()` shows the UTC date and the UTC+12 date
     (these differ for half of every day).

## Explicitly out of scope

- The mobile plan set (`plans/typwriter-mobile/02-rust-core.md`) already specifies
  the correct implementation for the new app — no change needed there.
- Caching "now" per compile (the desktop reads the clock per call; that's
  pre-existing behavior, leave it).
- Any other method of `impl World for EditorWorld`.

## Done criteria

1. `cargo test today` passes with ≥3 new assertions.
2. `cargo check` clean.
3. `git diff --stat` touches only `src-tauri/src/world/mod.rs`.

## Maintenance note

If typst is upgraded past 0.14, re-read the `World::today` doc — the contract is
stable but worth re-confirming. The pure helper makes the behavior visible to tests,
so a regression would fail CI (plan 001).

## Escape hatches

- If `Datetime::from_ymd`'s signature differs from what the current code shows
  (it returns `Option<Datetime>` at 0.14.2), adapt mechanically but STOP if the
  return type changed to a `Result` — that signals a typst version drift this plan
  wasn't written for.
- If the file has no obvious place for a free function + tests, put the helper in a
  `mod date` submodule — do not create a new top-level module for one function.
