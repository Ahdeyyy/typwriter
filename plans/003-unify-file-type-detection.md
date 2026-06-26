# 003 — Single source of truth for file-type detection (backend drives `viewMode`)

**Status:** DONE — deleted `TEXT_EXTS`/`IMAGE_EXTS`/`extOf` from
`editor.svelte.ts`; tabs now open in a provisional loading state (`viewMode:'text'`,
`isEditable:false`, `isLoading:true`) and `_loadTabContent` sets the final
`viewMode`/`isEditable`/`content`/`imageSrc` from the `read_file` response tag.
`_openFile` and `restoreTabs` share two new helpers (`_createLoadingTab`,
`_seedUnsavedText`); the hot-exit unsaved branch is preserved (unsaved buffers are
only ever captured for editable text tabs). Verified every `viewMode` consumer gates
on `isLoading` first (editor-pane shows a "Loading…" skeleton; text-editor-tab's
`ensureView`/`mountActiveView` refuse to mount while loading), so the provisional
value never flashes the wrong viewer. `rg "TEXT_EXTS|IMAGE_EXTS"` → no matches;
`bun run check` clean (0 errors). The 4-file runtime matrix (text/.png/.log/.xyz)
needs the Tauri app running and is left for a manual smoke test.
**Written against:** commit `9baf8a5`
**Effort:** S–M · **Risk of change:** Medium (touches tab-open and tab-restore paths)
**Depends on:** nothing (001 recommended first)

## Why

The Rust backend and the TypeScript editor store each keep their **own** allowlist of
text/image extensions, and they have drifted. The backend
(`apps/typwriter-desktop/src-tauri/src/commands/editor.rs`, `read_file`) treats
`.log` and `.cfg` as text and `.tif` as an image; the frontend
(`apps/typwriter-desktop/src/lib/stores/editor.svelte.ts:20`) knows none of these, so
it classifies such files as `unsupported`, **never calls `read_file` at all**, and
renders "Binary format" for files the backend would happily serve. Every future
extension addition has to be made twice or the lists drift further. Confirmed in this
month's code review (`docs/code-review/README.md`, finding #3) and re-verified.

## Current state

Frontend — `src/lib/stores/editor.svelte.ts:20-28`:

```ts
const TEXT_EXTS = new Set([
    '.typ', '.txt', '.md', '.markdown', '.json', '.toml',
    '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',
    '.xml', '.csv', '.ini', '.env', '.sh', '.rs', '.bib',
]);
const IMAGE_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif', '.tiff',
]);
```

Used in two places (~line 111 in `_openFile`, ~line 191 in `restoreTabs`) to compute
`viewMode` **before** the `read_file` IPC call; when the result is `'unsupported'`
the store returns early without calling the backend (`_openFile`, the
`if (viewMode === 'unsupported') return;` branch around line 134).

Backend — `src-tauri/src/commands/editor.rs:137-151`, the tagged response the
frontend already receives:

```rust
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileContentResponse {
    Text { content: String },
    Image { path: String, mime: String, data: Option<String> },
    Unsupported,
}
```

`read_file` classifies by extension itself (image MIME match at ~line 187, text
allowlist at ~line 246) and returns `Unsupported` **without reading any bytes** for
unknown extensions — so calling it for every file is cheap.

Frontend conventions to preserve: class-singleton stores, `neverthrow`
`ResultAsync<void, string>` for IPC methods, `imageSrcFromResponse(res)` (line 44)
for resolving the `<img>` src (SAF roots ship `data:` URLs).

## Steps

1. In `editor.svelte.ts`, delete `TEXT_EXTS`, `IMAGE_EXTS`, and `extOf` (check first
   that nothing else imports them — they are module-private consts at `9baf8a5`,
   but re-grep: `rg "TEXT_EXTS|IMAGE_EXTS|extOf" apps/typwriter-desktop/src`).

2. Rework `_openFile` (line ~96): create the tab in a loading state with
   `viewMode: 'text'` as a provisional value and `isLoading: true`, **always** call
   `readFile`, then set `viewMode` / `isEditable` / `content` / `imageSrc` from the
   response tag:

   - `type === 'text'` → `viewMode = 'text'`, `isEditable = true`,
     `content = res.content`
   - `type === 'image'` → `viewMode = 'image'`, `imageSrc = imageSrcFromResponse(res)`
   - `type === 'unsupported'` → `viewMode = 'unsupported'`, `isEditable = false`
   - finally `isLoading = false`

   Keep the early-return shape for errors exactly as the current code handles
   `readFile` failures (toast + remove or mark the tab — match whatever the current
   error branch does; do not invent new error UX).

3. Rework the same classification in `restoreTabs` (line ~191) identically. The
   duplicated `TabInfo` construction between `_openFile` and `restoreTabs` is a known
   smell (`docs/code-review/README.md` item 17) — if extracting a shared
   `_createTab` helper makes this change *smaller*, do it; otherwise leave the
   dedup for its own change.

4. Check every consumer of `tab.viewMode` renders sanely during the new
   loading window (`rg "viewMode" apps/typwriter-desktop/src` — editor pane, tab
   bar). The pane must show its loading skeleton while `isLoading`, not flash a text
   editor for what turns out to be an image. If a component branches on `viewMode`
   without checking `isLoading`, gate it.

5. Verify:
   - `bun run check` in `apps/typwriter-desktop/` — clean.
   - Run the app (`bun tauri dev`): open a workspace containing `main.typ`, a
     `.png`, a `.log` file, and a file with a junk extension (`.xyz`).
     Expect: text editor, image viewer, **text editor** (the fix — previously
     "Binary format"), "Binary format" notice respectively.
   - Restart the app with those tabs open — `restoreTabs` path produces the same
     result.

## Explicitly out of scope

- Changing the backend's extension lists (e.g. adding `.bib` to Rust if missing) —
  after this change the backend list is the single authority; auditing its contents
  is a separate decision.
- The desktop `read_file` SAF/data-URL mechanics, `save_file`, shadow-buffer logic.
- The mobile plan set — `plans/typwriter-mobile/02-rust-core.md` already specifies
  backend-driven `FileContent` from day one.

## Done criteria

1. `rg "TEXT_EXTS|IMAGE_EXTS" apps/typwriter-desktop/src` → no matches.
2. `bun run check` clean.
3. The four-file manual matrix in step 5 behaves as listed, including after restart.

## Maintenance note

Adding a new supported extension is now a one-line backend change in
`commands/editor.rs` (`read_file`'s MIME map or text `matches!`). The frontend
renders whatever tag arrives. Review any future PR that re-introduces extension
sniffing in TS.

## Escape hatches

- If some component turns out to *need* a synchronous pre-IPC type guess (e.g. tab
  icons chosen before load), give the tab a nullable `viewMode: ViewMode | null`
  while loading rather than resurrecting an extension list — and if that cascades
  into more than ~3 component changes, STOP and report the blast radius.
- If `restoreTabs` restores unsaved content for a file the backend now reports as
  `unsupported` (corrupted persistence edge), prefer keeping the unsaved text
  visible (text mode) and report the case rather than silently discarding content.
