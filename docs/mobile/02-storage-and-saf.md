# 02 — Storage and the Storage Access Framework

Android scoped storage is the single biggest difference between desktop and
mobile Typwriter. This doc explains the two workspace classes, the
`WorkingTreeFs` abstraction that hides them, and every place SAF leaks into
the design on purpose.

## Two classes of workspace

### 1. App-managed workspaces (the default)

- Live under `<Documents>/Typwriter/` in **app-private external storage**
  (resolved via Tauri's `path().document_dir()`).
- Fully reachable with plain `std::fs` — no permissions needed.
- Created/listed by the `create_workspace`, `get_mobile_workspaces_dir`, and
  `list_mobile_workspaces` commands.
- Deleted when the app is uninstalled (hence `export_workspace_to_dir_uri`,
  which copies a whole workspace out to a user-picked SAF folder).

### 2. SAF workspaces (user-picked external folders)

- The user picks a folder with android-fs's directory picker; the frontend
  receives a **tree URI**, not a path.
- The app holds **no broad storage permission** — `std::fs` cannot see these
  folders at all. Every byte must go through the android-fs plugin (which
  talks to the SAF `DocumentsProvider` over Binder).
- Registration flow (frontend → backend):
  1. `AndroidFs.showOpenDirPicker()` → tree URI
  2. `saf_tree_uri_to_path(uri)` → a stable pseudo-path the rest of the app
     can use as the workspace root key
  3. `register_saf_workspace_root(dirUri)` → `VcsState::remember_saf_root`
     stores `path → FileUri` in the `saf_roots` registry
  4. normal `open_folder(path)` proceeds; every layer resolves the right
     accessor from the registry

## `WorkingTreeFs` — the one abstraction to rule them all

Defined in `src-tauri/src/vcs/fs.rs`; produced by
`VcsState::working_tree_fs_for(&root)`:

- Returns `AndroidWorkingTreeFs` when `root` is in the SAF registry
  (Android only), otherwise `LocalWorkingTreeFs` (std::fs).
- Interface: `read_file`, `write_file`, `read_dir`, `create_dir_all`,
  `rename`, `remove_file`, `remove_dir_all`, `exists`.

Consumers (this list is the checklist for "did I miss a path?"):

| Consumer | Where |
|----------|-------|
| Compiler file reads (`World::source` / `World::file`) | `world/mod.rs::read_file_bytes` |
| Editor open/save | `commands/editor.rs::read_file` / `save_file` |
| File tree listing | `workspace/mod.rs::get_file_tree` → `read_dir_recursive` |
| Structural file ops (create/delete/rename/move/import) | `workspace/mod.rs` via `working_fs()` |
| Version history (snapshot, diff, restore) | `vcs/*` modules |

Known gap: `compiler/compile.rs::collect_workspace_diagnostics` still walks
with `std::fs` — cross-file diagnostics are silently empty on SAF roots. (See
the code review, finding R2.) Fix by reusing the SAF-aware walker.

### `std::fs` exemptions (correct as-is)

- **Typst package cache** — `<Documents>/Typwriter/Packages` on mobile
  (`world/mod.rs::packages_dir`), app-private, always std::fs-reachable. The
  typst_kit defaults point at OS dirs that scoped storage blocks, hence the
  override on `any(android, ios)`.
- **Import sources** — files arriving from the system file picker
  (`import_files`) are read with std::fs; only the *destination* may be SAF.
  Note: imports of files picked by android-fs use `import_files_from_uris`
  instead, which reads through the plugin.
- App data: settings store, logs, thumbnails inside managed dirs.

## Images in the webview

Desktop / managed-dir: `read_file` returns `FileContentResponse::Image { path,
mime, data: None }` and the frontend uses `convertFileSrc(path)` — the asset
protocol streams the file, zero IPC payload.

SAF root: the asset protocol is std::fs-backed and **cannot** reach the file.
`read_file` detects this via `vcs.is_saf_root(&root)` and returns
`data: Some("data:image/png;base64,…")` — the bytes ride the IPC channel once
and render directly. The frontend helper `imageSrcFromResponse` prefers `data`
when present. Cost: base64 inflates by ~33% and large images block the (sync)
command — one of the reasons to make `read_file` an async command.

## Exports

Desktop commands (`export_pdf`, `export_png`, `export_svg`) take filesystem
paths and write with std::fs. Mobile cannot: the destination is user-picked
via SAF. Hence the parallel `*_to_uri` commands:

- `export_pdf_to_uri(fileUri, config)` — `AndroidFs.showSaveFilePicker` first
- `export_png_to_dir_uri(dirUri, config)` / `export_svg_to_dir_uri` —
  `AndroidFs.showOpenDirPicker` first
- `export_workspace_to_dir_uri(dirUri)` — workspace backup/escape hatch

The split is intentional: `PreviewPipeline::export_pdf_bytes` /
`export_png_pages` / `export_svg_pages` produce bytes and `(filename, bytes)`
pairs with **no destination knowledge**; the thin command layer decides
std::fs vs android-fs. Keep new export formats on this pattern.

## Fonts

`FontSearcher` (typst-kit / fontdb) scans directories with std::fs and cannot
see SAF folders. The workaround is `import_font_directory_uri`: copy the
user-picked SAF font folder into app-private storage, return the destination
path, then `set_typst_font_directories([thatPath])` — so the scanner reads a
directory it can actually access. Re-importing is required if the user adds
fonts to the original folder; surfacing that in Settings UI is an open
improvement.

## Version history on SAF

Snapshots live in `<workspace>/.typwriter/history/` as a content-addressed
blob store (sha2 ids, zstd blobs, JSON manifests — no git). Because all store
IO goes through `WorkingTreeFs`, history works identically on SAF roots and
travels with the folder when synced or moved. Two mobile-specific notes:

- Initial attach runs on a background thread on Android (Binder round-trips
  per file make a synchronous attach too slow for workspace open).
- Per-file SAF IO is slow in general; large workspaces make `commit_if_changed`
  (full-tree hash) expensive. The dirty-set optimization in the code review
  (R4) matters *most* here.

## Adding a new file-touching feature: the checklist

1. Get the accessor: `let fs = vcs.working_tree_fs_for(&root);` — never
   `std::fs` for workspace paths.
2. Does the webview need to display the file? Check `is_saf_root` and ship
   bytes inline if so.
3. Does the user pick the location? Desktop: `tauri-plugin-dialog`. Android:
   android-fs picker + a `_to_uri` command variant.
4. Does it write? Remember a `snapshot_file_op` (structural ops) or rely on
   the save/compile auto-snapshot.
5. Test on: desktop, Android managed dir, Android SAF folder. The three
   behave differently in exactly the ways listed above.
