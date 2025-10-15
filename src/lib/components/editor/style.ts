import { tags } from "@lezer/highlight";
import { HighlightStyle } from "@codemirror/language";

export const typstBlueprintHighlightStyle = HighlightStyle.define([
  // Headings
  { tag: tags.heading, color: "#1E40AF", fontWeight: "bold" }, // Deep Blue
  { tag: tags.heading1, color: "#1E40AF", fontWeight: "bold" }, // Deep Blue
  { tag: tags.heading2, color: "#047857", fontWeight: "bold" }, // Emerald
  { tag: tags.heading3, color: "#16A34A", fontWeight: "bold" }, // Green
  { tag: tags.heading4, color: "#65A30D", fontWeight: "bold" }, // Lime
  { tag: tags.heading5, color: "#C2410C", fontWeight: "bold" }, // Orange
  { tag: tags.heading6, color: "#BE185D", fontWeight: "bold" }, // Pink

  // General Syntax
  { tag: tags.comment, color: "#6B7280", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold", color: "#047857" },
  { tag: tags.emphasis, fontStyle: "italic", color: "#65A30D" },

  // Keywords
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: "#7C3AED", // Violet
  },

  // Literals (strings, numbers, etc.)
  { tag: [tags.string, tags.docString], color: "#D97706" }, // Amber
  { tag: [tags.number, tags.bool, tags.literal], color: "#DB2777" }, // Fuchsia

  // Names & Variables
  { tag: tags.name, color: "#4338CA" }, // Indigo
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#059669" }, // Green

  // Punctuation
  { tag: [tags.paren, tags.brace, tags.bracket], color: "#4B5563" },

  // Special
  { tag: tags.escape, color: "#9333EA", fontWeight: "bold" },
  { tag: tags.link, color: "#2563EB", textDecoration: "underline" },
]);

export const typstMidnightHighlightStyle = HighlightStyle.define([
  // Headings
  { tag: tags.heading, color: "#67E8F9", fontWeight: "bold" }, // Bright Cyan
  { tag: tags.heading1, color: "#67E8F9", fontWeight: "bold" }, // Bright Cyan
  { tag: tags.heading2, color: "#A3E635", fontWeight: "bold" }, // Bright Lime
  { tag: tags.heading3, color: "#FDE047", fontWeight: "bold" }, // Bright Yellow
  { tag: tags.heading4, color: "#F9A8D4", fontWeight: "bold" }, // Light Pink
  { tag: tags.heading5, color: "#A5B4FC", fontWeight: "bold" }, // Light Indigo
  { tag: tags.heading6, color: "#9CA3AF", fontWeight: "bold" }, // Gray

  // General Syntax
  { tag: tags.comment, color: "gray", fontStyle: "italic" }, // Muted slate
  { tag: tags.strong, fontWeight: "bold", color: "#A3E635" },
  { tag: tags.emphasis, fontStyle: "italic", color: "#F9A8D4" },

  // Keywords
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: "#F472B6", // Bright Pink
  },

  // Literals (strings, numbers, etc.)
  { tag: [tags.string, tags.docString], color: "#FBBF24" }, // Amber/Gold
  { tag: [tags.number, tags.bool, tags.literal], color: "#FB923C" }, // Orange

  // Names & Variables
  { tag: tags.name, color: "#C4B5FD" }, // Violet
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#34D399" }, // Mint Green

  // Punctuation
  { tag: [tags.paren, tags.brace, tags.bracket], color: "#34D399" },

  // Special
  { tag: tags.escape, color: "#A78BFA", fontWeight: "bold" },
  { tag: tags.link, color: "#7DD3FC", textDecoration: "underline" },
]);
