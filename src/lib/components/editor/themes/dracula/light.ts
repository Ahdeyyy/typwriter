import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Using Hex codes from the image
const background = "#FFFBEB"; // Main background
const currentLine = "#6C664B"; // Used for active line highlight
const selection = "#CFCFDE"; // Text selection
const foreground = "#1F1F1F"; // Default text
const comment = "#6C664B"; // Comments, disabled code
const red = "#CB3A2A"; // Errors, warnings, deletion
const orange = "#A34D14"; // Numbers, constants, booleans
const yellow = "#846E15"; // Functions, methods
const green = "#14710A"; // Strings, inherited classes
const cyan = "#036A96"; // Support functions, regex
const purple = "#644AC9"; // Classes, types, variables
const pink = "#A3144D"; // Keywords, storage types

/**
 * The UI theme for the editor (Alucard Classic Light).
 */
export const alucardTheme = EditorView.theme(
  {
    "&": {
      color: foreground,
      backgroundColor: background,
    },
    ".cm-content": {
      caretColor: foreground,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: foreground,
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: selection,
      },
    ".cm-gutters": {
      backgroundColor: background,
      color: comment, // Use comment color for gutter text
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: selection, // Use currentLine for active line gutter
    },
    ".cm-activeLine": {
      backgroundColor: selection, // Using selection color for the active line highlight
    },
    // Optionally, to match the original Alucard Classic current line,
    // you might want to adjust the `.cm-activeLine` background to be `currentLine`
    // and the selection color to be something else, or keep selection separate.
    // For this implementation, I've used `selection` for activeLine for better visibility.
  },
  { dark: false },
); // Explicitly mark as a light theme

/**
 * The highlighting style for code in the editor (Alucard Classic Light).
 */
export const alucardHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    color: orange,
    fontWeight: "bold",
    textDecoration: "underline",
  },
  { tag: tags.comment, color: comment },
  { tag: tags.processingInstruction, color: purple },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.literal, color: green, fontWeight: "bold" },
  { tag: tags.controlKeyword, color: pink, fontWeight: "bold" },
  { tag: tags.moduleKeyword, color: pink, fontWeight: "bold" },
  { tag: tags.operatorKeyword, color: yellow, fontWeight: "bold" },
  { tag: tags.definitionKeyword, color: pink, fontWeight: "bold" },
  { tag: tags.name, color: purple },
  { tag: tags.brace, color: yellow },
  { tag: tags.bracket, color: cyan },
  { tag: tags.paren, color: red },
  { tag: tags.labelName, color: purple },
  { tag: tags.monospace, fontFamily: "monospace" },
]);
