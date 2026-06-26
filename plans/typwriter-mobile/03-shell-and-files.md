# Phase 3 — App shell, home screen, file tree sheet, back gesture

Goal: navigate the app like a real mobile app. Home screen lists workspaces; opening
one lands on the editor screen (with a placeholder where CodeMirror will go in phase 4);
the file tree slides in from the left as a sheet; the Android back gesture closes
overlays before it exits screens.

Depends on: phase 2 commands (`list_workspaces`, `open_workspace`, file ops, `read_file`).

## Screen model — `stores/app.svelte.ts`

```ts
type Screen = "home" | "editor";
type Overlay = "none" | "filetree" | "preview" | "diagnostics" | "settings";

class AppStore {
  screen = $state<Screen>("home");
  overlay = $state<Overlay>("none");
  // open/close methods push/pop history entries — see Back gesture below
}
export const app = new AppStore();
```

`+page.svelte` is a switcher:

```svelte
{#if app.screen === "home"}
  <HomeScreen />
{:else}
  <EditorScreen />
{/if}
```

No SvelteKit route navigation — a single page with store-driven screens (same approach
as desktop) keeps state alive across screen switches.

## Back gesture / hardware back

On Android, the system back gesture triggers `history.back()` in the WebView (and
closes the activity when history is empty). Integrate overlays with the history stack
so back behaves natively:

- `AppStore.openOverlay(o)`: sets `overlay = o` **and** `history.pushState({ overlay: o }, "")`.
- `AppStore.closeOverlay()`: calls `history.back()` (the popstate handler does the
  state change — single code path).
- On `window.addEventListener("popstate", ...)`: set `overlay` from `event.state?.overlay ?? "none"`.
- Entering the editor screen pushes `{ screen: "editor" }`; popstate with no screen
  state returns to home (after flushing unsaved content — call `editor.flush()` first,
  defined in phase 4; it's synchronous-fire-and-forget here).
- Result: back closes file tree/preview/diagnostics → then exits editor to home → then
  leaves the app. Test all three levels on-device.

Implement this once, in `app.svelte.ts`, and have every overlay component use
`app.openOverlay` / `app.closeOverlay` — never set `overlay` directly.

## `stores/workspace.svelte.ts`

```ts
interface FileNode { name: string; relPath: string; isDir: boolean; children: FileNode[] }

class WorkspaceStore {
  workspaces = $state<WorkspaceMeta[]>([]);
  name = $state<string | null>(null);
  tree = $state<FileNode | null>(null);
  mainFile = $state<string | null>(null);

  refreshList(): ResultAsync<void, string>;     // list_workspaces
  create(name: string): ResultAsync<void, string>;
  open(name: string): ResultAsync<WorkspaceInfo, string>; // open_workspace; sets state; app.screen = "editor"
  // every file op below calls the IPC command and replaces `tree` with the returned root
  createFile(relPath: string): ResultAsync<void, string>;
  createFolder(relPath: string): ResultAsync<void, string>;
  renameEntry(relPath: string, newName: string): ResultAsync<void, string>;
  moveEntry(relPath: string, newParentRel: string): ResultAsync<void, string>;
  deleteEntry(relPath: string): ResultAsync<void, string>;
  setMain(relPath: string): ResultAsync<void, string>;
}
export const workspace = new WorkspaceStore();
```

After `open()` resolves: if `info.lastFile` (or `mainFile`) exists, ask the editor
store to load it (phase 4; until then just store it).

## Home screen — `components/screens/home.svelte`

- App title + settings gear (opens settings overlay — stub until phase 7).
- Workspace list: card per workspace (name, relative "opened X ago" from
  `lastOpenedMs`), tap → `workspace.open(name)`.
- Prominent "New workspace" button → `Dialog` with a name input
  (validate: non-empty, no `/ \ : * ? " < > |`, not already taken) → `workspace.create`
  then `workspace.open`.
- Long-press a card (see Long-press below) → `Drawer` (bottom sheet) with
  Rename (stretch — skip if `rename_workspace` cmd doesn't exist; it's not in the v1
  contract) and Delete (confirm dialog, then `delete_workspace` + `refreshList`).
- Empty state: friendly illustration text + the New workspace button.

## Editor screen scaffold — `components/screens/editor.svelte`

Layout (flex column, `height: 100dvh`):

```
┌──────────────────────────────────────────────┐
│ [List icon]  main.typ        [●][Eye][DotsThree] │  top bar, h-12
├──────────────────────────────────────────────┤
│            (editor host — phase 4)           │  flex-1, min-h-0
├──────────────────────────────────────────────┤
│            (toolbar — phase 4)               │
└──────────────────────────────────────────────┘
```

Top bar contents:
- Left: `List` icon button → `app.openOverlay("filetree")`.
- Center: current file name (truncate middle), small "unsaved" dot when dirty
  (phase 4 wires it; render from a placeholder `editor.dirty` for now).
- Right: `Eye` icon → preview overlay (phase 6; stub = toast "not yet"), `DotsThree` →
  `DropdownMenu` with: Export PDF (phase 7 stub), Diagnostics (phase 7 stub, shows
  count badge when there are errors), Settings, Close workspace (→ back to home).

Use `safe-area` padding (`env(safe-area-inset-top/bottom)`) on the bar and toolbar —
the app runs edge-to-edge with `viewport-fit=cover`.

## File tree — `components/file-tree/`

`tree-sheet.svelte`: shadcn `Sheet` with `side="left"`, width ~85vw max 320px, open
when `app.overlay === "filetree"`; `onOpenChange(false)` → `app.closeOverlay()`.

Header: workspace name + `X` close + "new file" / "new folder" icon buttons (operate on
the root). Body: `ScrollArea` with the recursive tree.

`tree-node.svelte` (recursive):
- Dir row: chevron (rotates when expanded) + `Folder` icon + name. Tap toggles expand.
  Expanded-state lives in a local `Set<string>` in the sheet component (`$state`),
  default: root expanded, rest collapsed.
- File row: icon by extension (`FileText` for .typ, `Image` for images, `File` other) +
  name. The main file gets a subtle `Star` badge. Tap → open in editor
  (`editor.loadFile(relPath)` in phase 4; for now toast the path), then
  `app.closeOverlay()`.
- Touch target ≥ 44px tall. No hover states; use `active:` styles.

### Long-press context menu (no right-click on touch)

Implement a small Svelte attachment/action `longpress` (pointerdown → 450 ms timer →
cancel on pointerup/move > 8px → fire). On long-press of a row, open a `Drawer`
(bottom sheet) with actions for that node:

- File: Open, Rename, Move to…, Set as main file, Delete (destructive style).
- Folder: New file inside, New folder inside, Rename, Move to…, Delete.

Rename / New file / New folder: `Dialog` with a single input (pre-filled, extension
preserved on rename selection). Move to…: simple folder picker = a flat list of all
directories from the tree. Delete: confirm dialog. All call the corresponding
`workspace` store method; errors toast.

Inline-rename-in-tree (desktop behavior) is intentionally **not** replicated — dialogs
are more reliable with soft keyboards.

## Acceptance criteria

1. Create, open, and delete workspaces from the home screen on Android.
2. Opening a workspace shows the editor shell with the file tree sheet listing real
   files; `.typwriter/` and dot-files are hidden.
3. Create file/folder, rename, move, delete all work from long-press menus and the tree
   refreshes from the command's returned tree (no client-side patching).
4. Back gesture: closes the sheet if open; otherwise exits to home; from home, leaves
   the app. Verified on-device.
5. `bun run check` passes; no `invoke` calls outside `lib/ipc/commands.ts`.
