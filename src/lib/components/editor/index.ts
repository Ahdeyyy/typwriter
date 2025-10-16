import { typst_completion, typst_hover_tooltip, typstLinter } from "./typst";

import { yaml } from "@codemirror/lang-yaml";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { typst } from "codemirror-lang-typst";
import CodeMirror from "svelte-codemirror-editor";
import { ayuLight, coolGlow } from "thememirror";

import {
  typstBlueprintHighlightStyle,
  typstMidnightHighlightStyle,
} from "./style";

export {
  CodeMirror,
  typst,
  typst_completion,
  ayuLight,
  coolGlow,
  typstMidnightHighlightStyle,
  typstBlueprintHighlightStyle,
  typstLinter,
  yaml,
  EditorView,
  hoverTooltip,
  typst_hover_tooltip,
};
