# Onboarding Screen — Design

Status: **proposal / for review** · Scope: desktop only (first pass) · Author: design draft

A first-launch, multi-step onboarding that teaches the **core Typst markup basics**
(the material on <https://typst.app/docs/tutorial/writing-in-typst/>) using a live,
editable example with a mini preview. Whether the user finishes or skips, we record
that onboarding has been **shown** so it never auto-appears again. It stays replayable
from the Home screen.

---

## 1. Goals & non-goals

**Goals**

- Teach Typst essentials interactively: markup, headings, emphasis, lists, math, the
  `#` function syntax — each step with an editable snippet and a rendered preview.
- Persist a single "onboarding shown" flag on the Rust side. Skip counts as shown.
- Auto-show exactly once on first launch; expose a manual **replay** entry afterwards.
- Reuse the existing editor + preview machinery rather than building a parallel renderer.

**Non-goals (this pass)**

- Mobile/Android layout. Onboarding is gated **off** on Android for now (`platform.isMobile`
  short-circuits the auto-show and hides the replay entry). The flag still exists everywhere.
- Teaching set/show rules, templates, scripting depth. We end by pointing to
  <https://typst.app/docs/> for "read more".
- Multi-file examples, packages, bibliography.

---

## 2. Preview strategy — scratch workspace (chosen)

The live preview is **workspace-bound**: there is one `WorkspaceState` and one
`PreviewPipeline` managed as Tauri state ([lib.rs:143](apps/typwriter-desktop/src-tauri/src/lib.rs#L143)),
keyed to a single main `.typ` file, streamed to the webview over `previewimg://` by
content fingerprint. It cannot render an arbitrary in-memory string directly.

Rather than add a second renderer, onboarding **drives those same singletons** through a
disposable "scratch" workspace:

- On first launch the app sits on the Home page — **no workspace is open**, so commandeering
  the singletons for onboarding is safe.
- Onboarding opens a scratch workspace under app data (e.g.
  `app_data_dir/onboarding/`), with one main file `main.typ`.
- Each step **writes its example** into `main.typ`, opens it in the editor, and lets the
  normal flow render it: keystroke → shadow write (`update_file_content`) →
  `trigger_preview('typing')` → pipeline compiles → `previewimg://` → preview pane.
  This is exactly the path in [editor.svelte.ts](apps/typwriter-desktop/src/lib/stores/editor.svelte.ts)
  (`handleTabContentChange` → `_fireTypingPreview`).
- The "mini editor" and "mini preview" are the **existing** editor + preview components,
  rendered in a constrained two-pane layout — not new widgets.

**Why this over a `compile_snippet` command:** zero new Rust compile path, identical
typing/diagnostics/zoom behaviour to the real editor, and the user practises in the actual
tool. **Cost / risks** (see §8): the singletons are global, so we must guarantee the user
isn't mid-workspace, and we must tear the scratch workspace down cleanly on exit.

### 2.1 Lifecycle of the scratch workspace

```
enter onboarding
  └─ guard: if a real workspace is open, confirm before hijacking it (see §8)
  └─ ensure scratch dir exists (Rust: get/create onboarding dir)
  └─ workspace.init(scratchPath)          // reuses existing init: opens folder, sets up watcher
  └─ for each step: write example → editor.openFile("main.typ") → triggerPreview
exit (finish OR skip)
  └─ editor.flushAllTabs() is NOT needed (scratch content is throwaway)
  └─ workspace.leave()                     // existing teardown: disposes watcher, clears preview
  └─ mark onboarding shown (Rust)
  └─ page.navigate("home")
```

`workspace.init` / `workspace.leave` already exist and already reset the editor + preview
stores ([workspace.svelte.ts:186](apps/typwriter-desktop/src/lib/stores/workspace.svelte.ts#L186),
[:250](apps/typwriter-desktop/src/lib/stores/workspace.svelte.ts#L250)). We lean on them
instead of inventing teardown.

---

## 3. Rust side — the "shown" flag

### 3.1 Storage

Add one field to the existing persisted settings
([settings.rs:32](apps/typwriter-desktop/src-tauri/src/commands/settings.rs#L32)):

```rust
pub struct AppSettings {
    // …existing fields…
    /// Set to true once the onboarding flow has been shown (completed OR skipped).
    pub onboarding_completed: bool,
}
```

**Decided:** default `false` in `impl Default`, so existing users on upgrade also see
onboarding once (it's opt-out via Skip).

This piggybacks on `app_data.json` via `tauri-plugin-store` — the same mechanism the rest
of settings use, persisted under `settings.ui`. No new store, no VCS involvement.

### 3.2 Commands

**Decided:** use two thin, dedicated commands (over reusing `get/set_app_settings`) so the
frontend doesn't round-trip the whole settings blob just to read a bool, and intent is clear:

```rust
#[tauri::command]
pub fn get_onboarding_completed(handle: AppHandle) -> bool { read_settings(&handle).onboarding_completed }

#[tauri::command]
pub fn set_onboarding_completed(handle: AppHandle, completed: bool) {
    let mut s = read_settings(&handle);
    s.onboarding_completed = completed;
    write_settings(&handle, &s);
}
```

Register both in the `invoke_handler!` list in
[lib.rs:184](apps/typwriter-desktop/src-tauri/src/lib.rs#L184) and add the `settings` module
re-export.

A "scratch onboarding workspace directory" helper is also needed Rust-side (resolve
`app_data_dir().join("onboarding")`, create if missing, return the path), so the frontend
doesn't hardcode platform paths. Can live next to the workspace commands.

---

## 4. Frontend architecture

### 4.1 New page

Onboarding becomes a first-class page in the page store
([page.svelte.ts:8](apps/typwriter-desktop/src/lib/stores/page.svelte.ts#L8)):

```ts
type PageName = "home" | "workspace" | "keymaps" | "settings" | "onboarding";
// pages["onboarding"] = { name, component: Onboarding }
```

New component: `src/lib/components/pages/onboarding.svelte`.

### 4.2 Auto-show on first launch

In `home.svelte`'s `onMount` (it already gates on font readiness — the natural place):

```ts
// after fonts are confirmed ready, desktop only
if (!platform.isMobile) {
  const shown = await getOnboardingCompleted();
  if (shown.isOk() && !shown.value) page.navigate("onboarding");
}
```

Why here rather than `+page.svelte`: Home is the default landing page, fonts must be loaded
before any compile/preview can succeed, and Home already owns that readiness handshake.
Onboarding needs fonts too (it compiles examples), so gating behind `fontsReady` is correct.

### 4.3 Replay entry

Add a link button to Home's footer row alongside "Typst Docs"
([home.svelte:437](apps/typwriter-desktop/src/lib/components/pages/home.svelte#L437)):

```
[ Tutorial ]  →  page.navigate("onboarding")   // desktop only
```

Replaying does **not** clear the flag — it just re-enters the page. (Optional: also surface
it in Settings later.)

### 4.4 Onboarding store

`src/lib/stores/onboarding.svelte.ts` — a class singleton (per repo convention; module-level
`$state` loses reactivity):

```ts
class OnboardingStore {
  stepIndex = $state(0);
  steps = STEPS;                       // static content array, §6
  current = $derived(this.steps[this.stepIndex]);
  isFirst = $derived(this.stepIndex === 0);
  isLast  = $derived(this.stepIndex === this.steps.length - 1);
  scratchReady = $state(false);

  async enter(): ResultAsync<void,string> // ensure scratch ws, init workspace, load step 0
  next() / prev() / goTo(i)              // writes step.example into main.typ, opens it
  async finish()                         // set flag true, leave workspace, nav home
  async skip()                           // identical to finish() (skip == shown)
}
```

`next`/`prev` **preserve the user's edits**: each step keeps its own buffer in the store,
seeded from the starter example on first visit and never overwritten on revisit. A per-step
**"Reset example"** button restores the pristine snippet on demand. IPC methods return
`ResultAsync<void,string>` per the neverthrow convention.

### 4.5 Component layout (desktop)

```
┌─ onboarding.svelte ────────────────────────────────────────────────┐
│  Titlebar (minimal, "Typwriter — Tutorial")          [Skip ✕]       │
│  ┌────────────────────────┐  ┌──────────────────────────────────┐  │
│  │  EXPLANATION (left)     │  │  EDITOR (top)                    │  │
│  │  • step title           │  │   existing editor component on   │  │
│  │  • prose explaining the │  │   scratch main.typ               │  │
│  │    concept + how it maps │  ├──────────────────────────────────┤  │
│  │    to the editor        │  │  MINI PREVIEW (bottom)           │  │
│  │  • "try this" callout   │  │   existing preview component     │  │
│  └────────────────────────┘  └──────────────────────────────────┘  │
│  ●●●○○○○  step 4 / 7      [ Back ]                 [ Next → ]        │
└─────────────────────────────────────────────────────────────────────┘
```

- Left/right split via the existing `Resizable.PaneGroup`; editor/preview split vertically
  (mirrors the real workspace so the layout itself is part of the lesson).
- Reuse the **editor pane** and **preview pane** components rather than CodeMirror raw —
  they already wire content-sync, diagnostics, zoom, and the `previewimg://` fetch.
- Footer: dot stepper + Back/Next; Next becomes **"Finish"** on the last step.
- Skip (top-right ✕) available on every step → `onboarding.skip()`.
- Keyboard: `Esc` = skip (with confirm), `←/→` = prev/next when focus isn't in the editor.

---

## 5. State / flag flow (summary)

| Event                        | Action                                                            |
|------------------------------|-------------------------------------------------------------------|
| First launch, fonts ready    | `get_onboarding_completed` → `false` → auto `navigate("onboarding")` |
| User clicks **Finish**       | `set_onboarding_completed(true)` → leave scratch ws → Home        |
| User clicks **Skip** / `Esc` | identical to Finish (skip = shown)                                 |
| Later launches               | flag `true` → no auto-show                                         |
| Home → **Tutorial** button   | `navigate("onboarding")`, flag untouched                          |

---

## 6. Step content (Typst basics)

Seven steps, tracking the "Writing in Typst" tutorial. Each step = `{ id, title, blurb,
example, tryThis }`. Examples are short and self-contained so they compile instantly.

1. **Welcome** — what Typst is (markup compiles to a typeset PDF), what the two panes are.
   Example: a one-line `= Hello, Typst!` so the user sees text → rendered page immediately.
2. **Headings & paragraphs** — `=`, `==`, `===` for heading levels; blank line = new
   paragraph. *Try:* add a `==` subheading.
3. **Emphasis** — `*bold*` and `_italic_`. *Try:* make a word bold.
4. **Lists** — `-` bullet lists and `+` numbered lists; nesting by indentation. *Try:* add
   a third item.
5. **Math** — inline `$a^2 + b^2$` and block `$ ... $` equations. *Try:* change the exponent.
6. **Functions & the `#`** — markup vs. code; calling a function with `#`
   (`#lorem(20)`, `#image("...")` mentioned but not run since scratch has no asset),
   `#text(fill: red)[...]`. *Try:* wrap text in `#text(fill: blue)[...]`.
7. **You're ready** — recap; primary button **"Open the docs"** →
   `openUrl("https://typst.app/docs/")`; secondary **"Start writing"** → Finish → Home.

Exact prose to be written during implementation; the skeleton above defines structure and
the editable snippet per step. (Content review welcome — happy to expand to 8 steps if we
want a dedicated "set rules" teaser.)

---

## 7. Files touched

**Rust**
- `src-tauri/src/commands/settings.rs` — add `onboarding_completed` field + `get/set_onboarding_completed`.
- `src-tauri/src/commands/workspace.rs` (or `app.rs`) — scratch onboarding dir helper command.
- `src-tauri/src/lib.rs` — register the new commands.

**Frontend**
- `src/lib/components/pages/onboarding.svelte` — new page (layout in §4.5).
- `src/lib/components/onboarding/` — small pieces: `step-explanation.svelte`, `stepper.svelte`
  (keep `onboarding.svelte` thin).
- `src/lib/stores/onboarding.svelte.ts` — new store singleton.
- `src/lib/stores/page.svelte.ts` — register `onboarding` page.
- `src/lib/ipc/commands.ts` — `getOnboardingCompleted`, `setOnboardingCompleted`,
  `getOnboardingDir` wrappers (neverthrow `ResultAsync`).
- `src/lib/components/pages/home.svelte` — first-launch auto-show in `onMount`; "Tutorial"
  link in footer (desktop only).

---

## 8. Resolved decisions

1. **Existing-user behaviour on upgrade — DECIDED: show once to everyone.**
   `onboarding_completed` defaults to `false`, so users upgrading to this build also see
   onboarding a single time (opt-out via Skip).
2. **Per-step buffer — DECIDED: preserve edits.** Each step owns its buffer, seeded from the
   starter example on first visit and never auto-overwritten on revisit. A per-step
   "Reset example" button restores the pristine snippet on demand.
3. **Scratch workspace cleanup — DECIDED: leave on disk between runs.** Lives in a
   Tauri-provided app directory (`app_data_dir/onboarding/`); kept so replay is instant.
4. **Flag commands — DECIDED: dedicated `get/set_onboarding_completed`** rather than reusing
   `get/set_app_settings`.

Remaining guardrails (no decision needed, just noted):

- **Singleton hijack guard.** Onboarding is only reachable from Home, where no workspace is
  open; `enter()` asserts `workspace.rootPath === null` before commandeering the singletons.
- **Fonts.** Onboarding compiles, so auto-show is sequenced after Home's `fontsReady`
  handshake (§4.2).

---

## 8b. Implementation notes (as built)

Deviations from the draft above, all for correctness:

- **Flag lives under its own store key, not in `AppSettings`.** The Settings page
  round-trips the whole `AppSettings` struct through `set_app_settings`; a payload missing
  the field would let serde reset it to `false`. The flag is stored under
  `settings.onboarding_completed` via `get/set_onboarding_completed`, fully decoupled.
- **One file per step, not a single re-seeded `main.typ`.** `prepare_onboarding_workspace`
  takes `Vec<{name, content}>` and seeds one `*.typ` per step (named by step id), via plain
  `std::fs` (it runs *before* the world is bound to the dir, so `save_file` isn't usable).
  Navigating to a step makes that step's file the **main file**, so every step compiles a
  genuinely distinct document. This is the fix for the stale-preview bug: with a single
  swapped `main.typ`, the per-workspace preview cache + `last_emitted` page list (both
  intentionally persistent across opens of the *same* dir, which the scratch workspace
  reuses) could serve a previous step's — or previous session's — render for the current
  step. Distinct main files make that impossible.
- **Tab-less minimal editor, decoupled from the `editor`/`workspace` stores.**
  `onboarding-editor.svelte` is a single controlled CodeMirror (`value` + monotonic
  `seedVersion` in, `onchange` out) with Typst highlighting, theme, and font — no tabs, no
  IPC, no shared-store coupling. The onboarding store drives the world directly via
  `open_folder` → `set_main_file` → `update_file_content` (shadow) → `trigger_preview`,
  bypassing the tabbed-editor machinery entirely. Typing debounces a shadow-write +
  `trigger_preview('typing')`; step change / "Reset example" bump `seedVersion` (reseeding
  the editor) and force an `explicit` recompile after `preview.clear()`.
- **Recents exclusion.** `add_recent_workspace` skips `<app_data>/onboarding`, so the
  scratch workspace never appears in Home's "Recent Workspaces" list (crash-safe — handled
  at the source rather than cleaned up after).

## 9. Suggested implementation order

1. Rust: add field + commands + scratch-dir helper; `cargo check`.
2. Frontend plumbing: IPC wrappers, page-store entry, empty `onboarding.svelte` that just
   enters/leaves a scratch workspace and renders editor+preview.
3. Step model + content array + stepper/explanation UI + navigation.
4. First-launch auto-show + Home "Tutorial" link.
5. Polish: keyboard shortcuts, reset-example, Esc-confirm, copy pass.
