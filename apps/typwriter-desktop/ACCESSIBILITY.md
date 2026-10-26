# Desktop accessibility

Screen reader semantics are always enabled. Settings → Accessibility → Screen
reader mode opts into different editor keyboard behavior. The default remains
off, preserving existing indentation and editing shortcuts.

First-run onboarding asks whether to enable screen reader mode before preparing
the tutorial editor. Both enabling and declining are remembered immediately,
even if the app closes before the tutorial is completed. Replaying a completed
tutorial does not repeat the question, and existing enabled preferences count
as an answer. Resetting preferences retains this onboarding decision record.

The setting persists locally and syncs to open windows. It applies immediately
to existing source editors and the tutorial. It is also available through the
command palette and the rebindable `global.toggleScreenReaderMode` command
(Ctrl+Shift+F12 on Windows/Linux, Command+Shift+F12 on macOS).

When enabled, Tab and Shift+Tab move between controls. Control+Alt navigation
keys bypass CodeMirror without canceling browser defaults. Printable chords and
AltGr input continue to reach the editor. When disabled, CodeMirror's existing
Escape, then Tab escape hatch remains available; dismiss an open popup first.

With NVDA, use NVDA+Space to switch between editing and browse mode. In browse
mode, D navigates landmarks, H navigates headings, 1–6 select a heading level,
and Shift reverses navigation. NVDA+F7 opens the elements list. See the
[NVDA user guide](https://api.nvaccess.org/documentation/userGuide.html).

Each screen has one h1 and one main landmark. Workspace and settings navigation
have a navigation landmark; individual panes use h2 headings. Subsections use
h3 under their corresponding h2. A setting's description does not create a
landmark: `aria-describedby` associates explanatory text with a control. Avoid
named sections or `region` roles for every pane. See
[WAI landmark guidance](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/).

The live document preview and presentation slides are raster images. Page
labels identify their position; they do not expose the rendered text, equations,
or image contents. The source editor remains the text editing and reading path.
A semantic rendered preview is still needed for equivalent access to the
typeset output. Do not announce each compilation or every cursor/statistics
update: that would interrupt reading and typing.

## Native NVDA checklist

Run this in the Windows Tauri app with NVDA. Browser assertions, compilation,
and Svelte checks cannot establish the quality of native speech output.

- Start with existing settings that predate screen reader mode. Verify the mode
  is off and the familiar editing shortcuts, mouse actions, and drag/drop work.
- On a fresh first run, confirm the screen reader mode question receives focus
  before the editor appears. Test both answers with Tab and Enter. Restart before
  completing the tutorial and verify the choice persists without asking again.
- On Home, Workspace, Tutorial, Settings, Preview, Version Diff, and Presenter,
  check D/Shift+D and the elements list. Confirm one main and one h1 per screen,
  a short landmark list, and a meaningful heading order.
- Check the web document and native window titles on launch, navigation, and
  switching files. They should identify the screen or active document and
  Typwriter, including in standalone Settings, Preview, and Version Diff windows.
- Enable the mode from Settings and from its global shortcut. Verify Tab and
  Shift+Tab leave both the workspace and tutorial editors, including while
  completion/snippet UI is active. Turn it off and verify indentation returns.
- Edit prose, markup, math, long documents, and non-ASCII text. Read by character,
  word, and line; select and replace text; undo/redo; try AltGr input.
- Switch files, close active/inactive files, and close the final file. Verify
  document names, unsaved/external-change state, close-button names, visible
  keyboard focus, and a sensible focus destination after closing.
- Use the command palette with arrows and Enter. Confirm the selected result is
  spoken, Escape restores focus, and Tab cannot reach the background. Repeat for
  the symbol picker and the presenter’s All Slides dialog. On a focused symbol,
  Enter must insert that symbol rather than the first search result.
- Navigate sidebar controls and settings switches, sliders, and font pickers.
  Confirm names, state, units, and descriptions are announced. Search settings
  for “NVDA”, “accessibility”, and “tab focus”.
- Change the mode in Settings while several files and a tutorial are open;
  verify the live update, then close and reopen the app to verify persistence.
- Confirm the preview's image-only limitation is announced without repeatedly
  reading page statistics or compilation activity while typing.

The isolated keyboard regression harness is documented in
[`tests/accessibility-preview`](tests/accessibility-preview/README.md).
