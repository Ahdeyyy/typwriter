// Typst language support for CodeMirror — a snapshot copy of the desktop app's
// hand-written incremental parser (lezer-typst/). Mobile uses only the plain
// `typst()` support (no nested code-block languages) plus the two
// design-system-matched editor themes.

export { typst, typstLanguage } from "./typst";
export { light } from "./themes/light";
export { dark } from "./themes/dark";
