<script lang="ts">
  // The active block's source editor: the surface's one shared CodeMirror,
  // moved into this block's slot and seeded with the block's span.
  //
  // Edits stay local until the block is committed (tapping another block, the
  // Done button, toggling surface, leaving the screen). The editor store gets
  // a `liveText` reader so an autosave mid-edit still persists the whole
  // document with this block's live text spliced in — nothing is ever lost
  // waiting for a commit.

  import { onMount } from "svelte";
  import { EditorView } from "@codemirror/view";
  import type { Block } from "$lib/blocks/segment";
  import { mount, unmount, focusEnd } from "$lib/blocks/mini-editor";
  import { editor } from "$lib/stores/editor.svelte";
  import { blocks } from "$lib/stores/blocks.svelte";
  import { setInlineDiagnostics, type InlineDiagnostic } from "$lib/editor/inline-diagnostics";
  import { compileStore } from "$lib/stores/compile.svelte";

  let { block }: { block: Block } = $props();

  let host = $state<HTMLElement | null>(null);

  onMount(() => {
    if (!host) return;
    // Snapshot the span: the surface never re-segments while a block is
    // active, so these stay the coordinates this editor's text belongs at.
    const doc = blocks.doc;
    const from = block.from;
    const contentTo = block.contentTo;

    // Typing `/` on its own opens the insert menu, Notion-style; the query
    // filters it until the block holds something else.
    const slashWatcher = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const text = u.state.doc.toString();
      blocks.slashQuery = /^\/[\w-]*$/.test(text) ? text.slice(1) : null;
    });

    const { view, token } = mount(host, doc.slice(from, contentTo), editor.relPath ?? "", [
      slashWatcher,
    ]);
    const liveText = () => doc.slice(0, from) + view.state.doc.toString() + doc.slice(contentTo);

    editor.subView = view;
    editor.subOffset = from;
    editor.liveText = liveText;
    blocks.bindActiveText(() => view.state.doc.toString());

    // Diagnostics for lines inside this block, rebased to block-local lines.
    const startLine = doc.slice(0, from).split("\n").length - 1;
    const local: InlineDiagnostic[] = [...compileStore.errors, ...compileStore.warnings]
      .filter((d) => d.filePath === editor.relPath && d.range !== null)
      .map((d) => ({ line: d.range!.startLine - startLine, severity: d.severity, message: d.message }))
      .filter((d) => d.line >= 0 && d.line < view.state.doc.lines);
    view.dispatch({ effects: setInlineDiagnostics.of(local) });

    focusEnd();

    return () => {
      unmount(token);
      blocks.slashQuery = null;
      if (editor.subView === view) {
        editor.subView = null;
        editor.liveText = null;
        editor.subOffset = 0;
      }
    };
  });
</script>

<div bind:this={host} class="w-full"></div>
