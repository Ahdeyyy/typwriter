// Templates the insert ("slash") menu writes as new blocks.
//
// Each is plain Typst source — the block surface has no special node types, so
// inserting one is just splicing text and letting segmentation classify it.

export interface BlockTemplate {
  id: string;
  label: string;
  /** Short glyph shown in the menu's leading column. */
  glyph: string;
  /** Words the menu filters on, beyond the label. */
  keywords: string;
  text: string;
}

export const TEMPLATES: BlockTemplate[] = [
  { id: "h1", label: "Heading 1", glyph: "H1", keywords: "title", text: "= " },
  {
    id: "h2",
    label: "Heading 2",
    glyph: "H2",
    keywords: "subtitle section",
    text: "== ",
  },
  {
    id: "h3",
    label: "Heading 3",
    glyph: "H3",
    keywords: "subsection",
    text: "=== ",
  },
  {
    id: "text",
    label: "Text",
    glyph: "¶",
    keywords: "paragraph prose",
    text: "",
  },
  {
    id: "bullet",
    label: "Bulleted list",
    glyph: "•",
    keywords: "unordered item",
    text: "- ",
  },
  {
    id: "numbered",
    label: "Numbered list",
    glyph: "1.",
    keywords: "ordered enum",
    text: "+ ",
  },
  {
    id: "math",
    label: "Equation",
    glyph: "∑",
    keywords: "math formula",
    text: "$  $",
  },
  {
    id: "raw",
    label: "Code block",
    glyph: "</>",
    keywords: "raw fence snippet",
    text: "```\n\n```",
  },
  {
    id: "quote",
    label: "Quote",
    glyph: "❝",
    keywords: "blockquote citation",
    text: "#quote(block: true)[\n\n]",
  },
  {
    id: "image",
    label: "Image",
    glyph: "▣",
    keywords: "picture figure photo",
    text: '#image("")',
  },
  {
    id: "table",
    label: "Table",
    glyph: "▦",
    keywords: "grid rows columns",
    text: "#table(\n  columns: 2,\n  [], [],\n  [], [],\n)",
  },
  {
    id: "figure",
    label: "Figure",
    glyph: "⌸",
    keywords: "caption float",
    text: '#figure(\n  image(""),\n  caption: [],\n)',
  },
  {
    id: "code",
    label: "Code expression",
    glyph: "#",
    keywords: "script let set",
    text: "#",
  },
  {
    id: "divider",
    label: "Divider",
    glyph: "—",
    keywords: "line rule separator",
    text: "#line(length: 100%)",
  },
];

/** Filter templates by a slash-menu query (matches label or keywords). */
export function filterTemplates(query: string): BlockTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return TEMPLATES;
  return TEMPLATES.filter(
    (t) => t.label.toLowerCase().includes(q) || t.keywords.includes(q),
  );
}
