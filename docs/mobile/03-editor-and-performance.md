# 03 — Editor behavior and the mobile performance budget

## Why mobile has no live typing preview

Desktop refreshes the preview while typing: every ~8 ms tick the whole buffer
is shipped over IPC (`update_file_content`) and a `Typing` compile is queued.
On Android this froze typing outright, for two compounding reasons:

1. The WebView IPC bridge serializes on the main thread — shipping a full
   document per keystroke starves input handling.
2. The compile worker, renderer, and the keyboard/IME all compete for a much
   smaller CPU budget.

So `EditorStore.handleTabContentChange` guards the typing-preview schedule
with `!platform.isMobile`. On mobile the shadow buffer and the preview are
refreshed by paths that already save the file (and `save_file` requests a
`Save` compile):

| Trigger | Mechanism |
|---------|-----------|
| Idle while editing | idle-save timer, capped at `min(autoSaveDelayMs, 600)` on mobile |
| Leaving the editor (blur) | mobile save-on-blur handler |
| Toggling editor → preview | the view switch flushes, then the compiled result is shown |
| Navigating away (Settings/Home) | `editor-pane.svelte` `onDestroy` → `flushAllTabs()` |

**Do not** "fix" the missing live preview by re-enabling the typing path on
mobile. The correct long-term path is incremental: send CodeMirror deltas
instead of full documents (code review S3/R-roadmap #8), then re-evaluate
whether a low-frequency (500 ms+) typing compile is affordable on-device.

## The idle-save cap

```ts
const delay = platform.isMobile
    ? Math.min(settings.autoSaveDelayMs, 600)
    : settings.autoSaveDelayMs;
```

Rationale: Android can suspend or kill the app at any moment (low memory,
battery, user swipe). Capping the delay shrinks the window where edits exist
only in WebView memory. If you tune this, remember the second safety net:

## Hot-exit restore

The OS killing the process is *normal* on Android, so unsaved buffers are
treated as durable state:

1. While typing, `workspace.schedulePersistTabs()` (300 ms debounce)
   serializes `{ tabs, activeTabId, unsaved: { relPath → content } }` through
   `save_workspace_tabs` into the tauri store.
2. On the next workspace open, `get_workspace_tabs` returns that state;
   `EditorStore.restoreTabs` seeds dirty tabs from the `unsaved` map instead
   of the (stale) disk copy, marks them dirty, and re-seeds the Rust shadow
   buffer (`updateFileContent`) so the next compile renders the restored text.
3. A successful save re-persists so the entry drops out of the unsaved map —
   a later restore can't resurrect stale edits.

Caveat worth knowing: persistence is debounced 300 ms, so a kill inside that
window loses at most the last burst of keystrokes. That is the accepted
trade-off; tightening it means more IPC churn (see code review S4 for the
recommended risk-point-based persistence instead).

## Workspace open on mobile

IPC latency dominates mobile workspace open, so the open path is built around
batching and deferral:

- **Tabs restore concurrently** — `restoreTabs` creates all tab descriptors
  synchronously (order preserved), then loads every file in parallel
  (`Promise.all`), instead of the old serial per-tab loop.
- **Preview restores from disk before compiling** —
  `PreviewPipeline::restore_preview` replays the persisted page manifest from
  `.typwriter/cache/previews/`, so the user sees the last-rendered pages
  immediately while fonts load and the real compile runs behind.
- **Fonts load lazily** in a background thread (`ensure_fonts_loading`),
  overlapping the rest of the open path. The compile worker blocks on
  `wait_until_fonts_loaded` so it never renders font-less pages into the
  cache.
- **VCS attach is backgrounded on Android** (doc 01).

When adding work to the open path, attach it to one of these patterns (defer,
parallelize, or restore-from-cache) rather than extending the critical chain.

## IPC budget rules

- Events carry **keys, not payloads** — page updates are
  `{ index, fingerprint }`; the PNG travels over `previewimg://` and hits the
  WebView HTTP cache.
- File bytes go over IPC only when there's no alternative (SAF images as
  `data:` URLs).
- Per-keystroke IPC is desktop-only, and even there it's flagged for dieting
  (deltas).
- Anything that scales with workspace size (tree walks, diagnostics, VCS
  hashing) belongs on a Rust background thread, never in a command the UI
  awaits.

## Known mobile performance gaps (prioritized)

1. **Sync commands run on the main thread** — on Android this is the WebView's
   own process main thread; a slow `read_file` (base64 image) or `save_file`
   (VCS hash) stalls everything. Make heavy commands `async`. *(code review R3)*
2. **`collect_workspace_diagnostics`** compiles every non-main `.typ` per
   cycle and is std::fs-only (broken on SAF anyway). Gate + fix. *(R2)*
3. **Full-tree snapshot hashing** after compile/save — most painful over SAF
   Binder IO. Dirty-set tracking. *(R4)*
4. **Tab persistence churn** while typing. *(S4)*
