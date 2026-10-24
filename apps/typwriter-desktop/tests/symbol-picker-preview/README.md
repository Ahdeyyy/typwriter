# Symbol picker regression checks

Build the real picker and CodeMirror without starting the desktop dev server:

```sh
bunx vite build --config tests/symbol-picker-preview/vite.config.ts
bunx vite preview --config tests/symbol-picker-preview/vite.config.ts --host 127.0.0.1 --port 4183 --strictPort
```

Check at 1200x640 and a smaller viewport, in light and dark mode (`?theme=dark`):

- All 131 symbols appear in a scrollable grid. The search and footer stay visible.
- Search `not equal`: one visible, square `≠` button remains; the dialog shrinks.
- Search nonsense: the empty state stays visible.
- Clear search: the full grid returns and scrolls to its last row.
- Click `≠` in markup: the picker closes and CodeMirror contains `#sym.eq.not`.
- Open in math, search `not equal`, press Enter: CodeMirror contains `$eq.not $`.
- Escape closes the picker and returns focus to the editor.

Run the automated checks against the **system WebKitGTK** webview on Linux:

```sh
sudo apt install python3-gi gir1.2-webkit2-4.1 xvfb xauth fonts-dejavu-core
xvfb-run -a python3 tests/symbol-picker-preview/check-webkit.py
```

This loads the static build in a real GTK webview and runs `checks.js` to check
visible geometry, scrolling, search/empty states, markup/math insertion, and
focus restoration. CI runs it on Ubuntu 22.04. It needs no browser driver or
running development server.

The results scroller must have a computed `flex-basis` of `auto`. Chromium can
hide the old zero-basis collapse, so visible rectangles alone are insufficient
to guard the system WebKitGTK regression. Also repeat the visual checks in the
packaged Linux app; the harness does not test Tauri window integration.
