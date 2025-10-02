<script lang="ts">
  import { appState } from "@/states.svelte"
  import { saveTextToFile, compile } from "@/utils"
  import { EditorState } from "@codemirror/state"
  import { EditorView } from "@codemirror/view"
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
    let view = $state<EditorView>(
      new EditorView({
        state: EditorState.create({
          doc: appState.text,
          extensions: [
            appState.editorExtensions.of([]),
            EditorView.updateListener.of(async (v) => {
              if (v.docChanged) {
                const text = v.state.doc.toString()
                if (appState.canCompileFile) {
                  await debouncedCompile(text)
                }
                await debouncedSave(text)
              }
            }),
          ],
        }),
        parent: editor,
      })
    )
    appState.loadEditor(view)
  })
</script>

<div bind:this={editor} id="editor"></div>
