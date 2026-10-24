import { mount } from "svelte";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import SymbolPicker from "../../src/lib/components/editor/symbol-picker.svelte";
import { editorSearch } from "../../src/lib/stores/editor-search.svelte";
import { ui } from "../../src/lib/stores/ui.svelte";
import "./preview.css";

const editor = new EditorView({
  state: EditorState.create({ doc: "" }),
  parent: document.getElementById("editor")!,
});
editorSearch.setActiveView(editor);
mount(SymbolPicker, { target: document.getElementById("app")! });
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");

function open(inMath: boolean) {
  const doc = inMath ? "$ $" : "";
  editor.setState(EditorState.create({ doc, selection: { anchor: inMath ? 1 : 0 } }));
  editor.focus();
  ui.symbolPickerOpen = true;
}

document.getElementById("markup")!.onclick = () => open(false);
document.getElementById("math")!.onclick = () => open(true);
open(false);
