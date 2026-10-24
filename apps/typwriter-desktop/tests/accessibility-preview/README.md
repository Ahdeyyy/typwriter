# Editor accessibility checks

This harness exercises the production CodeMirror accessibility extension in a
browser without starting the Tauri app or its development server.

From `apps/typwriter-desktop`:

```sh
bunx vite build --config tests/accessibility-preview/vite.config.ts
bunx vite preview --config tests/accessibility-preview/vite.config.ts --host 127.0.0.1 --port 4182 --strictPort
```

Open `http://127.0.0.1:4182/`. The page reports twelve regression assertions.
It finishes with screen reader mode enabled and focus on “Before editor”.
Press Tab twice to enter the editor, Tab again to reach “After editor”, and
Shift+Tab to return. Uncheck the mode to verify the existing indentation behavior.

The assertions cover accessible naming/instructions, default indentation,
releasing both Tab directions, preserving source text, reserving Control+Alt
navigation, keeping printable international keyboard chords, restoring normal
behavior, Escape then Tab, and repeated live reconfiguration.

This browser harness does not validate NVDA speech or the native WebView2
accessibility tree. Follow [the native checklist](../../ACCESSIBILITY.md) for those.
