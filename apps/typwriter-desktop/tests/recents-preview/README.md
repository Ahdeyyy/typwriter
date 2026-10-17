# Recent history layout preview

From `apps/typwriter-desktop`, run `bun run preview:recents` and open
http://localhost:4178. This builds a standalone visual harness, then serves the
static output; it does not start the desktop app or its development server.

The harness renders the actual Home, titlebar, and shared UI using the app's CSS.
Only service/store boundaries and native window operations are mocked. It never
reads or writes your real app history, documents, or workspaces. Opening entries
and native pickers are inert; remove and Clear All operate on in-memory fixtures.
Reset fixture restores them.

Use the controls to compare full, single, empty, and one-section histories at
different window sizes, in both themes and with either titlebar style. Full
history contains ten documents and ten workspaces (the persistence limit); Home
currently renders only the first six of each. Fixtures cover long unbroken
names, deep paths, duplicate basenames, CJK and Arabic, plus portrait, landscape,
and missing thumbnails.

The desktop window's configured minimum is 1200 × 640. Smaller presets deliberately
test beyond that supported size; at 480 × 400, the document list leaves only a
small sliver of workspace thumbnails visible. Use 1200 × 640 to check the
smallest supported desktop layout.

For an exact viewport without harness controls, open
`http://localhost:4178/canvas.html?scenario=full&theme=dark&platform=windows`.
Re-run the command after changing UI code to rebuild the preview.
