import type { EditorView } from "@codemirror/view";
import { computeFormatState } from "$lib/typst-codemirror-lang";

/**
 * Reactive mirror of the formatting that applies at the active editor's cursor.
 * The Typst toolbar reads these flags to render its toggle buttons in an active
 * (highlighted) state and to label the heading dropdown, Google-Docs style.
 *
 * `text-editor-tab.svelte` calls `refresh` from an update listener whenever the
 * selection, document, or focus changes, and on tab mount/unmount.
 */
class EditorFormatStore {
  bold = $state(false);
  italic = $state(false);
  rawInline = $state(false);
  headingLevel = $state(0);
  bulletList = $state(false);
  numberedList = $state(false);

  refresh(view: EditorView | null) {
    if (!view) {
      this.reset();
      return;
    }
    const s = computeFormatState(view);
    this.bold = s.bold;
    this.italic = s.italic;
    this.rawInline = s.rawInline;
    this.headingLevel = s.headingLevel;
    this.bulletList = s.bulletList;
    this.numberedList = s.numberedList;
  }

  reset() {
    this.bold = false;
    this.italic = false;
    this.rawInline = false;
    this.headingLevel = 0;
    this.bulletList = false;
    this.numberedList = false;
  }
}

export const editorFormat = new EditorFormatStore();
