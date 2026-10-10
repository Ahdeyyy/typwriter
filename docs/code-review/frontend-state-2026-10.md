# Desktop and mobile Svelte state review

Reviewed on 10 October 2026. Scope: both apps' frontend stores, rune modules,
component effects, CodeMirror integration, and asynchronous state transitions.
This is a focused follow-up to the older desktop review; Rust and native device
behavior were not audited in this pass.

The class-singleton architecture is appropriate for these client-only Tauri
apps. The main correctness problems were request ownership, save ordering,
effect dependencies, and cleanup after asynchronous listener registration.
The changes accompanying this report keep that architecture.

## Findings fixed

### High: mobile saves could acknowledge text that had not been saved

In [mobile editor state](../../apps/typwriter-mobile/src/lib/stores/editor.svelte.ts),
`flush()` captured one version of the text, then unconditionally cleared `dirty`
when its write completed. Typing during the write could therefore leave newer
text marked clean. Empty-tab transitions also cleared the buffer without waiting
for the save. Leaving the editor could destroy the view before a follow-up write.

Saves now acknowledge only the bytes they sent, drain newer edits before resolving,
and retain the latest buffer independently of the view. Empty-tab transitions wait
for the drain. Workspace opening flushes and resets the previous editor before the
backend changes roots, including reopening from home.

### High: an automatic disk reload could overwrite new typing

The same editor checked whether the buffer was clean before starting a read, but
not whether it had changed while that read was pending. Automatic reloads now
check an edit version and preserve new typing, displaying the existing external
change warning instead. Explicit reloads also preserve typing that occurs after
the user starts the read.

### Medium: effects subscribed to incidental CodeMirror/plugin reads

[Desktop editor mounting](../../apps/typwriter-desktop/src/lib/components/editor/text-editor-tab.svelte)
called editor construction, focus, grammar, and buffer synchronization inside a
tracking effect. Reactive reads inside those calls became mount dependencies,
allowing content/settings changes to rerun lifecycle work. Mobile configuration
effects could similarly track keyboard state read inside plugins.

These boundaries now use Runed `watch` with explicit sources. Its callback is
untracked, so plugin implementation details cannot silently expand the subscription.
External-content synchronization includes the mounted view as a retry trigger.
Cursor jump animation frames are canceled on cleanup and verify request identity.

In [mobile editor hosting](../../apps/typwriter-mobile/src/lib/components/editor/editor-host.svelte),
the `loadedText` effect also performed a second whole-document reset after the
store had already applied a minimal disk change. It could undo caret mapping and
reset undo history. Disk synchronization now has one owner: the editor store.
The host creates/destroys the view and restores the initial caret on mount.

### Medium: late requests could revive obsolete UI state

| Area | Failure before the change | Guard added |
| --- | --- | --- |
| [Mobile file loading](../../apps/typwriter-mobile/src/lib/stores/editor.svelte.ts) | An older file read could replace a newer selection or repopulate reset tabs. | Request generation checked before applying results and errors. |
| [Mobile compilation](../../apps/typwriter-mobile/src/lib/stores/compile.svelte.ts) | A cleared document could receive an old compile; transport failure left `compiling` active. | Request generation alongside backend generation; errors settle status. |
| [Mobile completions](../../apps/typwriter-mobile/src/lib/editor/completion-controller.svelte.ts) | Clearing or rescheduling left queued/in-flight work able to restore suggestions. | Immediate invalidation, timer cancellation, and view/path/text/cursor checks. |
| [Desktop grammar](../../apps/typwriter-desktop/src/lib/stores/grammar.svelte.ts) | Disabled/forgotten reports could return; an old request could clear a newer busy indicator. | Monotonic tokens across file lifetimes; only the current request finishes checking. |
| [Desktop VCS](../../apps/typwriter-desktop/src/lib/stores/vcs.svelte.ts) | Older history/diff/page-registration results could replace a newer selection or teardown. | Separate generations for history, text diff, and page registration. |
| [Desktop search](../../apps/typwriter-desktop/src/lib/components/sidebar/search-pane.svelte) | Old hits could return after clearing the query or changing workspace, including during debounce. | Watch query/options/root; invalidate immediately and on cleanup. |
| [Desktop page zoom](../../apps/typwriter-desktop/src/lib/components/vcs/page-zoom-dialog.svelte) | A closed/replaced dialog could receive a late render. | Effect cleanup invalidates its render generation. |
| [Desktop snippets](../../apps/typwriter-desktop/src/lib/stores/snippets.svelte.ts) | A project read could restore snippets after reset or root change. | Request/root checks; reset invalidates reads and clears the settings pane. |
| [Desktop scope cache](../../apps/typwriter-desktop/src/lib/stores/document-scope.svelte.ts) | A stale scan could refill the cleared cache even though published results were guarded. | Validate generation before writing cache entries. |

The [desktop editor store](../../apps/typwriter-desktop/src/lib/stores/editor.svelte.ts)
also now verifies the tab object's identity, preventing a closed tab's read from
updating a reopened tab with the same path. Newly created loading tabs are explicit
`$state` proxies: retained aliases and array consumers mutate the same reactive
object rather than mixing a raw object with its array-created proxy.

### Medium: async listener registration outlived cleanup

[Diagnostics](../../apps/typwriter-desktop/src/lib/stores/diagnostics.svelte.ts),
[cross-window holders](../../apps/typwriter-desktop/src/lib/ipc/cross-window-state.svelte.ts),
and [window controls](../../apps/typwriter-desktop/src/lib/components/titlebar/window-controls.svelte)
could register a native listener after their teardown had already run. Listener
results now dispose themselves if their owner is obsolete. Window controls use a
synchronous `onMount` callback returning cleanup; an async `onMount` callback
cannot return a cleanup function that Svelte will use.

The [CrossWindow wrapper](../../apps/typwriter-desktop/src/lib/components/util/CrossWindow.svelte)
now tracks each direction separately. Previously both effects read both values,
allowing a remote change to trigger local-to-remote synchronization first and
overwrite the incoming value. This wrapper is currently unused by application
components; it remains a replacement/scalar synchronization interface, not a
deep-mutation replication mechanism.

### Medium: navigation and template loading had effect/lifecycle traps

[Page navigation](../../apps/typwriter-desktop/src/lib/stores/page.svelte.ts)
now commits history only when a page actually becomes visible. Failed or superseded
chunk loads no longer leave ghost entries; requesting the visible page cancels
pending navigation.

[Home template loading](../../apps/typwriter-desktop/src/lib/components/pages/home.svelte)
now watches only dialog visibility and template mode. Reading `templatesLoading`
inside the original effect made its own completion/error reset a potential retry
trigger.

### Low: persisted defaults were captured before hydration

[Mobile export drafts](../../apps/typwriter-mobile/src/lib/components/export/export-drawer.svelte)
and the [preview scale bucket](../../apps/typwriter-mobile/src/lib/components/preview/preview-overlay.svelte)
used `$state(settings.value)`, capturing the startup default once. Writable
`$derived` values now follow settings hydration while supporting local edits.

## Patterns to keep and idiom corrections

- Use `$derived` for computed UI values; effects are justified when synchronizing
  CodeMirror, native events, or other external systems. An effect assigning state
  is a prompt to review ownership, not proof of a bug by itself.
- Only UI-observed values need runes. Timers, request counters, callbacks, and
  private caches can remain ordinary fields. Mobile `EditorView` identity does
  need reactivity, so it is now `$state.raw`; its internals belong to CodeMirror.
- Plain `Map`/`Set` caches are valid. `$state(new Map())` does not make `.set()`
  reactive. Use `SvelteMap`/`SvelteSet` when consumers must observe mutations, or
  replace the collection when its value changes. Do not convert every private
  cache into a reactive collection.
- Desktop's raw tree plus explicit top-level reassignment is valid. Retaining a
  raw object and mutating it outside its deep proxy is a different hazard.
- Module/closure runes do **not** inherently lose reactivity. A getter that reads
  closure state remains reactive; returning its current primitive value is a
  snapshot. The class convention remains useful, but the broader claim in the app
  guidance is inaccurate. The cross-window source comment now explains this.
- Both apps disable SSR, so singleton stores do not introduce cross-user SSR
  state leakage here. Reconsider context ownership if that deployment changes.

These distinctions follow Svelte's official [$state](https://svelte.dev/docs/svelte/$state),
[$derived](https://svelte.dev/docs/svelte/$derived), and
[$effect](https://svelte.dev/docs/svelte/$effect) documentation.

## Runed usage

Desktop already depended on Runed. Mobile now declares the same `^0.37.1` direct
dependency. [Runed `watch`](https://runed.dev/docs/utilities/watch) is used at
CodeMirror boundaries and for search, template loading, and cross-window syncing,
where explicit dependency lists clarify ownership.

Existing save queues and IPC request generations remain explicit. Replacing them
with debounce/resource utilities would not, by itself, establish disk-write order
or cancel native work, and would add a second abstraction without removing those
requirements. Large replacement-only result arrays are candidates for
`$state.raw` if profiling shows proxy overhead; no blanket conversion was made.

## Follow-up findings and their resolution

1. **Fixed: mobile tree refreshes lacked workspace ownership.** In
   [workspace state](../../apps/typwriter-mobile/src/lib/stores/workspace.svelte.ts),
   `watchForeground()` and `refreshTree()` could apply an old tree after a workspace
   switch. Refreshes, foreground rescans, and delayed file operations now validate
   the workspace generation/root; tree replacements invalidate older snapshots.
   Operations waiting on a save verify ownership before dispatch, and stale
   mutation results return errors so success callbacks cannot open the wrong file.
   Native opens are serialized and obsolete results are rejected across teardown.
2. **Fixed: mobile settings initialization was not awaitable single-flight.**
   [Settings `init()`](../../apps/typwriter-mobile/src/lib/stores/settings.svelte.ts)
   set `loaded` before its await. A second caller returned before hydration, and a
   failed load could not retry. Concurrent callers now share a promise that resolves
   after hydration; `loaded` and the writable store are committed only on success.
   Failed store loads and settings reads can retry.
3. **Fixed for mobile: application listeners lacked explicit ownership.** The
   mobile root now returns synchronous cleanup. App/workspace listeners, temporary
   history waits, body-lock recovery timers, and the body mutation observer have
   disposers. Late native listener registrations release themselves; initialization
   is idempotent and failed subscriptions can retry. Startup auto-restore checks
   its component lifetime and workspace version after awaits. Reinitializing app
   listeners preserves navigation history.

   **Desktop follow-up completed:** the
   [October 10 adversarial review](./frontend-adversarial-2026-10-10.md) replaces
   the root layout's async mount with a shared listener scope and synchronous
   cleanup, including late-registration disposal.

## Validation

- Both apps: `bun run check` reports **0 errors and 0 warnings**.
- Existing tests: desktop **466 passed**; mobile **86 passed**.
- New state regressions: desktop **12 passed**; mobile **29 passed**. Run
  `bun run test:state` in either app. The preload compiles real rune modules against
  that app's Svelte version; Tauri IPC is mocked. Separate processes keep the apps'
  mocks and dependencies isolated.
- Mobile's follow-up added **19** workspace/hydration/lifecycle regressions,
  including remount during native registration/open, retry after hydration
  failure, stale mutation callbacks, and canceled body-lock recovery timers.
- Baseline checks against the original stores reproduced the desktop failures
  then covered and mobile save/empty-tab failures. The final suites pass against
  the changed stores.
- Both frontend production builds pass. Nonblocking existing warnings include
  desktop scrollbar CSS and icon-barrel/plugin warnings, mobile unused imports,
  and bundle-size warnings.
- Edited components were analyzed with the Svelte autofixer. Its DOM-ownership
  warnings for the desktop editor's empty CodeMirror host are intentional:
  CodeMirror owns those child nodes, and Svelte renders none there.
- `git diff --check` passes.

No native Tauri or Android interaction testing was performed. Device keyboard,
gesture/caret behavior, multiwindow event delivery, and backend command/event
ordering still need native QA; the store tests do not establish those guarantees.
