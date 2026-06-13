# 04 — Mobile UI patterns

## The `.mobile.svelte` convention

When mobile needs a structurally different component (not just responsive
CSS), a sibling file with the `.mobile.svelte` suffix lives next to the
desktop one, and the parent chooses at render time:

```
lib/components/editor/tab-bar.svelte          ← desktop
lib/components/editor/tab-bar.mobile.svelte   ← mobile
lib/components/sidebar/filetree.svelte / filetree.mobile.svelte
lib/components/sidebar/preview.svelte  / preview.mobile.svelte
```

```svelte
{#if editor.tabs.length > 0 && !platform.isMobile}
  <TabBar />
{/if}
…
{#if editor.tabs.length > 0 && platform.isMobile}
  <TabBarMobile />
{/if}
```

Shared logic that both variants need lives in a `*-controller.svelte.ts`
module next to them (`tab-bar-controller.svelte.ts`,
`filetree-controller.svelte.ts`, `preview-controller.svelte.ts`) — Svelte 5
runes in a plain `.svelte.ts` file, so the two views stay thin and never
duplicate state logic.

**When to fork vs. when to style:** fork (`.mobile.svelte`) when the
interaction model differs — bottom tab bar vs. top tab strip, sheet vs.
sidebar, toggled preview vs. split pane. Stay in one file with Tailwind
breakpoints/`platform.isMobile` classes when only spacing/sizing differ
(e.g. `editor-pane.svelte` adds `pb-2` and extra CodeMirror scroller padding
on mobile but keeps one component).

## Layout differences that matter

- **No window chrome:** `titlebar/`, window controls, and the preview
  pop-out window are desktop-only (`platform.hasDesktopWindowControls`).
  Mobile is single-window; the preview is a view you toggle into, not a pane.
- **No resizable split panes on mobile** — the editor and preview don't share
  the screen.
- **TabBar position:** desktop renders tabs above the editor; mobile renders
  `TabBarMobile` *below* it (thumb reach).

## Keyboard handling

`lib/hooks/mobile-keyboard.ts` (`installKeyboardAvoider`) is the single place
that deals with the on-screen keyboard. How it works:

- AndroidManifest sets `windowSoftInputMode="adjustResize"`, so the WebView
  layout viewport shrinks when the keyboard opens — fixed chrome (the bottom
  tab bar) repositions automatically.
- The hook watches `visualViewport.resize` (delta > 80 px ⇒ keyboard) and
  `focusin`, then `scrollIntoView`s the focused text field if it overlaps the
  keyboard area. Double-rAF so layout commits first.
- It publishes the keyboard height as a CSS custom property:
  `--keyboard-inset` — use this in popovers/dialogs/sheets that need to cap
  their `max-height` while the keyboard is up.
- **CodeMirror is deliberately exempt** (`closest('.cm-editor')`): CM manages
  its own viewport and cursor scrolling; a global `scrollIntoView` fights its
  measurement loop and causes visible jitter. Never add keyboard-scrolling
  behavior that targets `.cm-content`.

It's a no-op on desktop and returns a teardown function — install it from a
root component's `$effect`/`onMount`.

## Paths shown to users

Always run user-visible paths through `platform.displayPath(path)` on mobile.
It strips the `<Documents>/` prefix so the user sees `Typwriter/Thesis`
instead of `/storage/emulated/0/Android/data/com…/files/Documents/Typwriter/Thesis`.

## Pickers

Never use `tauri-plugin-dialog` file/folder pickers on Android — they can't
grant SAF access. Use the android-fs pickers and the URI-based commands:

| Need | Android API | Backend command |
|------|-------------|-----------------|
| Open external workspace | `AndroidFs.showOpenDirPicker` | `saf_tree_uri_to_path` + `register_saf_workspace_root` |
| Import files | `AndroidFs.showOpenFilePicker` | `import_files_from_uris` |
| Export single file | `AndroidFs.showSaveFilePicker` | `export_pdf_to_uri` |
| Export to folder | `AndroidFs.showOpenDirPicker` | `export_png_to_dir_uri` / `export_svg_to_dir_uri` / `export_workspace_to_dir_uri` |
| Import fonts | `AndroidFs.showOpenDirPicker` | `import_font_directory_uri` |

Gate the call sites on `platform.isMobile` (today effectively
`platform.os === 'android'`).

## Touch-target and gesture guidelines (for new mobile UI)

The existing mobile components follow these; keep them:

- Minimum 44×44 px touch targets for tappable controls.
- Destructive actions (delete file/folder) get a confirmation step — no
  hover states exist to telegraph danger.
- Long-press replaces right-click context menus.
- Avoid hover-only affordances entirely (`tooltipContent`, hover reveals);
  every action needs a visible or long-press path on mobile.
- Respect `--keyboard-inset` in anything anchored to the bottom.
