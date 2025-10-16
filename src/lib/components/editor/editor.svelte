<script lang="ts">
    import { appContext } from "@/app-context.svelte";
    import {
        typst_completion,
        typst_hover_tooltip,
        typstLinter,
    } from "./typst";
    import { compile, get_cursor_position, render, render_page } from "@/ipc";
    import { theme } from "mode-watcher";

    import { yaml } from "@codemirror/lang-yaml";
    import { EditorView, hoverTooltip } from "@codemirror/view";
    import { typst } from "codemirror-lang-typst";
    import { useDebounce, useInterval, useThrottle, watch } from "runed";
    import CodeMirror from "svelte-codemirror-editor";
    import { ayuLight, dracula } from "thememirror";
    import { syntaxHighlighting } from "@codemirror/language";
    import {
        typstBlueprintHighlightStyle,
        typstMidnightHighlightStyle,
    } from "./style";
    import {
        alucardHighlightStyle,
        alucardTheme,
    } from "./themes/dracula/light";
    import { editorStore, previewStore } from "@/store/index.svelte";
    import { getFileType, murmurHash3 } from "@/utils";
    import { toast } from "svelte-sonner";

    const editableDocs = ["typ", "yaml", "yml", "txt", "md", "json", "bib"];

    let documentExtension = $derived.by(() => {
        if (editorStore.file_path) {
            return { ext: getFileType(editorStore.file_path) };
        }
        return { ext: "" };
    });

    let lang = $derived.by(() => {
        switch (documentExtension.ext) {
            case "typ":
                return [typst()];
            case "yaml":
                return [yaml()];
            case "yml":
                return [yaml()];
            default:
                return undefined;
        }
    });

    let syntaxHighlight = $derived.by(() => {
        if (documentExtension.ext === "typ") {
            return typstBlueprintHighlightStyle;
        }
        return undefined;
    });

    let completion = $derived.by(() => {
        if (documentExtension.ext === "typ") {
            return {
                override: [typst_completion],
                activateOnTyping: true,
            };
        }
        return true;
    });

    let languageSpecificExtensions = $derived.by(() => {
        switch (documentExtension.ext) {
            case "typ":
                return [
                    hoverTooltip(typst_hover_tooltip),
                    typstLinter(editorStore.diagnostics),
                    typst(),
                ];
            case "yaml":
                return [];
            default:
                return [];
        }
    });

    const compileAndRender = async () => {
        if (editorStore.file_path && documentExtension.ext === "typ") {
            await editorStore.compile_document();
            const view = editorStore.editor_view;
            if (view) {
                const cursor = view.state.selection.main.head;
                // get preview position
                const position = await get_cursor_position(cursor);
                if (position.isOk()) {
                    // use the current page to the render the exact page
                    previewStore.current_position = position.value;
                    await editorStore.render_page(position.value.page - 1);
                } else {
                    await editorStore.render();
                }
            }
        }
    };

    const debouncedCompileAndRender = useDebounce(async () => {
        await compileAndRender();
    }, 50);
</script>

{#if editorStore.file_path}
    <CodeMirror
        bind:value={editorStore.content}
        styles={{
            "&": { height: "95svh", width: "100%" },
            ".cm-scroller": { overflow: "auto" },
        }}
        onready={(e) => {
            editorStore.editor_view = e;
        }}
        onchange={async (e) => {
            editorStore.is_dirty = true;
            await debouncedCompileAndRender();
        }}
        extensions={languageSpecificExtensions}
        theme={ayuLight}
        lineWrapping
        lineNumbers
        autocompletion={completion}
        foldGutter
        syntaxHighlighting={{
            highlighter: typstBlueprintHighlightStyle,
            fallback: false,
        }}
        editable={editableDocs.includes(documentExtension.ext)}
    />
{/if}
