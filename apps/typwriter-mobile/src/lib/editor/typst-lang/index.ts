// Typst language support for CodeMirror. The parser and language come from
// the shared `codemirror-typst` npm package (the same one desktop uses), plus
// the two design-system-matched editor themes. Nested raw-block languages are
// passed in by `create-editor.ts` (see `../langs.ts`).

export { typst, typstLanguage } from "codemirror-typst";
export { light } from "./themes/light";
export { dark } from "./themes/dark";
