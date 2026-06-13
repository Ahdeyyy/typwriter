# Svelte / TypeScript findings — `src/`

File references are relative to `apps/typwriter-desktop/src/`.
`lib/components/ui/**` (vendored shadcn-svelte) is excluded from review.

## Correctness

### S1. File-type lists drifted from the backend (bug)

`lib/stores/editor.svelte.ts` keeps its own `TEXT_EXTS` / `IMAGE_EXTS`, and
`commands/editor.rs::read_file` keeps another pair. They have already
diverged:

| Extension | Rust `read_file` | TS store | User-visible result |
|-----------|------------------|----------|---------------------|
| `.log`    | text             | missing  | tab shows "Binary format — preview not available" |
| `.cfg`    | text             | missing  | same |
| `.tif`    | image            | missing (only `.tiff`) | same |

The frontend decides `viewMode` from its local list *before* calling
`readFile`, and skips the read entirely for "unsupported" — so the backend's
opinion never gets a chance. Fix by deleting the TS lists: open the tab in a
loading state, call `readFile`, and derive `viewMode` from the
`FileContentResponse` variant (`text` / `image` / `unsupported`). One source
of truth, no drift, and adding a new extension becomes a one-line Rust change.

### S2. `SerialQueue` guards too little

`workspace.svelte.ts` runs `_init` / `_leave` through `_opQueue`, but the
mutating actions (`createFileAction`, `renameAction`, `moveAction`,
`deleteFolderAction`, …) run unqueued. Two rapid drag-drop moves, or a delete
racing a rename, can interleave their backend calls and `refreshTree`
round-trips, ending with a tree that reflects neither op. Route all mutating
actions through the same queue (they're milliseconds each; serialization is
invisible).

## Performance

### S3. Whole-document IPC per keystroke (desktop)

`handleTabContentChange` → `_scheduleTypingPreview` (8 ms throttle) →
`updateFileContent(absPath, tab.content)` ships the **entire buffer** across
the WebView bridge, then triggers a compile. On a 200 KB document that's
~25 MB/s of IPC while typing. The mobile path already disables this for
exactly that reason — desktop just has more headroom, not a different problem.

Improvement: send CodeMirror change deltas (`{from, to, insert}` in UTF-16
units) to a new `apply_file_edit` command that patches the shadow string
in-place (the UTF-16↔byte helpers already exist in `commands/editor.rs`).
Keep full-content sync for open/restore/format as the resync path.

### S4. Tab persistence serializes dirty buffers every 300 ms

`schedulePersistTabs` is called from `handleTabContentChange`, so while typing
the full unsaved content of every dirty tab is JSON-serialized over IPC and
written to the store file every 300 ms. The hot-exit guarantee only needs
durability at *risk points*: idle (the idle-save timer already fires then),
blur/visibility-change, and tab/workspace lifecycle events. Persisting on
those, and not per keystroke burst, keeps the guarantee and drops the churn.

### S5. `closeOtherTabs` / `closeTabsToLeft/Right` close serially

Each `closeTab` awaits a flush round-trip before the next starts. Closing 20
tabs = 20 sequential IPC waits. Flush dirty tabs concurrently
(`Promise.all`) and then splice the array once.

## Structure / maintainability

### S6. Duplicated tab construction

The `TabInfo` literal + viewMode derivation + hot-exit (`unsavedContent`)
branch is duplicated verbatim between `_openFile` and `restoreTabs`
(~40 lines each). Extract:

```ts
private _createTab(relPath: string, unsavedContent?: string): { tab: TabInfo; needsLoad: boolean }
```

### S7. `editor` ↔ `workspace` store import cycle

`editor.svelte.ts` imports `workspace` (for `toAbs`, `schedulePersistTabs`)
and `workspace.svelte.ts` imports `editor` (for tab lifecycle). It works
because all uses are deferred to method bodies, but it's the kind of cycle
that breaks silently when someone adds a module-level use. Options:

- Move tab persistence + path resolution into a small third module both
  depend on, or
- Have `workspace` inject callbacks into `editor` at init.

### S8. Mixed error-handling paradigms

The stores use three styles side by side:

1. `ResultAsync` chains (`createFileAction`)
2. Private `async` methods that `throw`, re-wrapped with
   `ResultAsync.fromPromise` (`_deleteFile`, `_renameAction`, `_moveAction`)
3. The awkward `ResultAsync.fromPromise(Promise.reject(onlyTypError.error), …)`
   in `setMainFileAction` — this is just `errAsync(message)` from neverthrow.

Style 2 means errors travel as thrown `Error`s internally and Results
externally, and `String(err)` re-stringifies an already-stringified message
("Error: Error: …" risk). Pick one: either commit to neverthrow throughout
the private helpers, or keep neverthrow strictly at the IPC boundary and use
plain async/throw inside. Either is fine; the mix is the cost.

### S9. `toErrString` flattens everything

`const toErrString = (e: unknown): string => String(e)` yields
`"[object Object]"` the moment the backend returns a structured error (see
Rust finding R8). When typed command errors land, replace this with a mapper
that switches on the error `kind` and produces user-facing copy.

## Smaller notes

- **S10.** `workspace.toAbs` detects absolute paths with
  `/^([A-Za-z]:\/|\/)/` — fine for Windows/POSIX, but Android SAF-derived
  paths and `content://` URIs pass through other layers; keep an eye on it if
  URI-shaped strings ever reach tabs.
- **S11.** `filterTree` / `collectExpandedPaths` / `rewritePath` are pure and
  ideal first targets for `bun test` — zero mocking needed. There are
  currently no frontend tests at all.
- **S12.** `EditorStore` timer/version machinery
  (`_shadowWriteVersions`, `_moveTimerKey`, rename-while-pending behavior —
  see the load-bearing comment above `_scheduleTypingPreview`) encodes subtle
  invariants with no test coverage. A fake-timer test that renames a tab with
  a pending idle-save and asserts the save still lands would lock in the
  documented behavior.
- **S13.** `editor-pane.svelte`'s `onDestroy` flush + the store-driven
  CodeMirror sync (`contentSyncRequest` with versioning) is a good pattern —
  document it in the app CLAUDE.md so future editors keep routing
  programmatic content changes through it rather than poking CM directly.
- **S14.** `platform.svelte.ts` calls `tauriPlatform()` in the constructor at
  module import time; under SvelteKit SSR/prerender this would throw if not
  for the `typeof window` guard — guard is present, just don't remove it.
