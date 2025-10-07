<script lang="ts">
  import { appContext } from "@/app-context.svelte"
  import {
    typst_completion,
    typst_hover_tooltip,
    typstLinter,
  } from "@/editor/typst"
  import { render_page } from "@/ipc"
  import { saveTextToFile, compile, getFileType } from "@/utils"
  import { yaml } from "@codemirror/lang-yaml"
  import { Compartment, EditorState } from "@codemirror/state"
  import { EditorView, hoverTooltip } from "@codemirror/view"
  import { typst } from "codemirror-lang-typst"

  import { useDebounce, useThrottle } from "runed"
  import { onMount } from "svelte"
  import CodeMirror from "svelte-codemirror-editor"
  import {
    ayuLight,
    espresso,
    amy,
    solarizedLight,
    rosePineDawn,
  } from "thememirror"

  // let editor: HTMLElement

  let extensions = $state(new Compartment())

  let documentExtension = $derived.by(() => {
    if (appContext.workspace && appContext.workspace.document) {
      return { ext: getFileType(appContext.workspace.document.path) }
    }
    return { ext: "" }
  })

  let lang = $derived.by(() => {
    switch (documentExtension.ext) {
      case "typ":
        return [typst()]
      case "yaml":
        return [yaml()]
      case "yml":
        return [yaml()]
      default:
        return undefined
    }
  })

  let completion = $derived.by(() => {
    if (documentExtension.ext === "typ") {
      return {
        override: [typst_completion],
        activateOnTyping: true,
      }
    }
    return true
  })

  let languageSpecificExtensions = $derived.by(() => {
    switch (documentExtension.ext) {
      case "typ":
        return [
          hoverTooltip(typst_hover_tooltip),
          typstLinter(appContext.workspace?.document?.diagnostics || []),
        ]
      case "yaml":
        return []
      default:
        return []
    }
  })

  const compileAndRender = async () => {
    if (appContext.workspace && appContext.workspace.document) {
      if (documentExtension.ext === "typ") {
        await appContext.workspace.document.compile()
        const view = appContext.editorView
        if (view) {
          const cursor = view.state.selection.main.head
          await appContext.workspace.document.getPreviewPosition(cursor)
        }
        let page = appContext.workspace.document.previewPosition.page
        if (page < 1) page = 1

        let render_response = await render_page(page)
        console.log("render response: ", render_response)
        if (render_response) {
          let img = new Image(render_response.width, render_response.height)
          img.src = `data:image/png;base64,${render_response.image}`
          appContext.workspace.renderedContent.set(page - 1, img)

          // console.log($state.snapshot(appContext.workspace.renderedContent))
        }
      }
    }
  }

  const debouncedCompileAndRender = useDebounce(async () => {
    await compileAndRender()
  }, 10)

  const throttledSave = useDebounce(async () => {
    if (appContext.workspace && appContext.workspace.document) {
      console.log("Auto-saving document...")
      await appContext.workspace.document.save()
    }
  }, 1200)

  const throttledPos = useThrottle(async () => {
    if (appContext.workspace && appContext.workspace.document) {
      const view = appContext.editorView
      if (view) {
        const cursor = view.state.selection.main.head
        await appContext.workspace.document.getPreviewPosition(cursor)
      }
    }
  }, 500)
</script>

{#if appContext.workspace && appContext.workspace.document}
  <CodeMirror
    bind:value={appContext.workspace.document.content}
    styles={{
      "&": { height: "95svh", width: "100%" },
      ".cm-scroller": { overflow: "auto" },
    }}
    onready={(e) => {
      appContext.editorView = e
    }}
    onchange={async () => {
      await debouncedCompileAndRender()
      const res = await Promise.allSettled([throttledSave()])
      // console.log("promise result:", res)
    }}
    extensions={languageSpecificExtensions}
    lang={lang ? lang[0] : undefined}
    theme={rosePineDawn}
    lineWrapping
    lineNumbers
    autocompletion={completion}
    foldGutter
  />
{/if}
