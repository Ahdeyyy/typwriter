<script lang="ts">
  import { app } from "@/states.svelte"
  import { saveTextToFile, compile } from "@/utils"
  import { EditorState } from "@codemirror/state"
  import { EditorView } from "@codemirror/view"
  import { basicSetup } from "codemirror"
  import { useDebounce } from "runed"
  import { onMount } from "svelte"

  let editor: HTMLElement

  const debouncedCompile = useDebounce(async (text: string) => {
    await compile(text)
  }, 500)
  const debouncedSave = useDebounce(async (text: string) => {
    await saveTextToFile(text)
  }, 1000)

  onMount(() => {
    const fixedHeight = EditorView.theme({
      "&": { height: "92svh" },
      ".cm-scroller": { overflow: "auto" },
    })

    const editorWidth = EditorView.theme({
      "&": { width: "100%" },
    })
    let view = $state<EditorView>(
      new EditorView({
        state: EditorState.create({
          doc: app.text,
          extensions: [
            EditorView.lineWrapping,
            fixedHeight,
            editorWidth,
            basicSetup,
            EditorView.updateListener.of(async (v) => {
              if (v.docChanged) {
                const text = v.state.doc.toString()
                await debouncedCompile(text)
                await debouncedSave(text)
              }
            }),
          ],
        }),
        parent: editor,
      })
    )
    app.loadEditor(view)
  })
</script>

<div bind:this={editor} id="editor"></div>
