# First-run accessibility choice

This harness uses the actual onboarding page and settings store. Native services,
the editor, the preview, and window chrome are stubbed. It does not start Tauri
or the app's development server.

From `apps/typwriter-desktop`:

```sh
bunx vite build --config tests/onboarding-preview/vite.config.ts
bunx vite preview --config tests/onboarding-preview/vite.config.ts --host 127.0.0.1 --port 4183 --strictPort
```

Open `http://127.0.0.1:4183/` for a fresh run. Confirm:

- Exactly one h1 exists and receives focus: “Turn on screen reader mode?”
- The tutorial editor is absent until an answer is chosen.
- Tab reaches the enable button, and a second Tab reaches the decline button.
- Either answer opens the tutorial and focuses “Welcome to Typst”.
- `[data-tutorial-editor]` reports the selected mode in `data-screen-reader-mode`.
- `typwriter:settings:v1` in localStorage records both `screenReaderMode` and
  `screenReaderModeChosen`. Declining stores `false` and `true`, respectively.

Then use these scenarios:

- `/?resume=1` preserves storage and simulates restarting before tutorial
  completion. The question must not repeat after either answer.
- `/?completed=1` simulates replaying a completed tutorial with legacy settings.
  The question must not appear.
- `/?enabled=1` seeds the old enabled preference without a decision marker.
  The mode must remain enabled, and the question must not appear.

Other URLs clear this harness's settings on load. Only the loopback test origin
is affected. Native NVDA speech still needs validation in the Tauri app.
