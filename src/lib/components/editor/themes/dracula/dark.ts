import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Using Hex codes from the image
const background = "#282A36";
const foreground = "#F8F8F2";
const selection = "#44475A";
const comment = "#6272A4";
const cyan = "#8BE9FD";
const green = "#50FA7B";
const orange = "#FFB86C";
const pink = "#FF79C6";
const purple = "#BD93F9";
const red = "#FF5555";
const yellow = "#F1FA8C";

/**
 * The UI theme for the editor.
 */
export const draculaTheme = EditorView.theme(
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
      color: "#6D8A88",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: selection,
    },
    ".cm-activeLine": {
      backgroundColor: selection,
    },
  },
  { dark: true },
);

/**
 * The highlighting style for code in the editor.
 */
export const draculaHighlightStyle = HighlightStyle.define([
  // Keywords, operators, storage types
  {
    tag: [tags.keyword, tags.operator, tags.variableName],
    color: pink,
  },
  // Comments
  {
    tag: tags.comment,
    color: comment,
    fontStyle: "italic",
  },
  // Classes, types, variables
  {
    tag: [
      tags.name,
      tags.typeName,
      tags.className,
      tags.propertyName,
      tags.variableName,
    ],
    color: purple,
  },
  // Functions, methods
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
    color: yellow,
  },
  // Strings, inherited classes
  {
    tag: [tags.string, tags.inserted],
    color: green,
  },
  // Numbers, constants, booleans
  {
    tag: [tags.number, tags.bool, tags.literal],
    color: orange,
  },
  // Support functions, regex
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    color: cyan,
  },
  // Errors, warnings, deletion
  {
    tag: [tags.invalid, tags.deleted],
    color: red,
  },
  // Punctuation (brackets, braces) can use the foreground color to be neutral
  {
    tag: [tags.punctuation, tags.bracket],
    color: foreground,
  },
  // Emphasized text
  {
    tag: tags.emphasis,
    fontStyle: "italic",
  },
  // Bold text
  {
    tag: tags.strong,
    fontWeight: "bold",
  },
]);
