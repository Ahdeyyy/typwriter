// Typst language support for CodeMirror. The parser and language come from
// the shared `codemirror-typst` npm package (the same one desktop uses);
// mobile uses only the plain `typst()` support (no nested code-block
// languages) plus the two design-system-matched editor themes.

export { typst, typstLanguage } from "codemirror-typst";
export { light } from "./themes/light";
export { dark } from "./themes/dark";
