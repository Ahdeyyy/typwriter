<script lang="ts">
    import {
        ayuLight,
        CodeMirror,
        coolGlow,
        hoverTooltip,
        typst_completion,
        typst_hover_tooltip,
        typstBlueprintHighlightStyle,
        typstLinter,
        typstMidnightHighlightStyle,
        yaml,
    } from "./index";

    import { get_cursor_position } from "@/ipc";
    import { mode } from "mode-watcher";

    import { useDebounce, useInterval, useThrottle, watch } from "runed";

    // import { syntaxHighlighting } from "@codemirror/language";

    import { editorStore, previewStore } from "@/store/index.svelte";
    import { getFileType } from "@/utils";
    // import { toast } from "svelte-sonner";

    const editableDocs = ["typ", "yaml", "yml", "txt", "md", "json", "bib"];

    let documentExtension = $derived.by(() => {
        if (editorStore.file_path) {
            return {
                path: editorStore.file_path,
                ext: getFileType(editorStore.file_path),
            };
        }
        return { ext: "" };
    });

    let currentTheme = $derived.by(() => {
        return mode.current === "dark"
            ? { editor: coolGlow, syntax: typstMidnightHighlightStyle }
            : { editor: ayuLight, syntax: typstBlueprintHighlightStyle };
    });

    const syntaxHighlight = $derived.by(() => {
        if (documentExtension.ext === "typ") {
            return {
                highlighter: currentTheme.syntax,
                fallback: false,
            };
        }
        return undefined;
    });

    let completion = $derived.by(() => {
        const path = documentExtension.path;
        if (documentExtension.ext === "typ") {
            return {
                override: [typst_completion],
                activateOnTyping: true,
            };
        }
        return true;
    });

    let languageSpecificExtensions = $derived.by(async () => {
        const path = documentExtension.path;
        console.log("Language Extensions for:", path);

        switch (documentExtension.ext) {
            case "typ": {
                const { typst } = await import("codemirror-lang-typst"); // dynamic import
                return [
                    hoverTooltip(typst_hover_tooltip),
                    typstLinter(editorStore.diagnostics),
                    // typst(),
                ];
            }
            case "yaml":
                return [yaml()];
            default:
                return [];
        }
    });

    let resolvedLanguageExtensions: Awaited<typeof languageSpecificExtensions> =
        $state([]);

    $effect(() => {
        languageSpecificExtensions.then((extensions) => {
            resolvedLanguageExtensions = extensions;
        });
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
    {#key editorStore.file_path}
        <CodeMirror
            bind:value={editorStore.content}
            styles={{
                "&": { height: "95svh", width: "100%" },
                ".cm-scroller": { overflow: "auto" },
            }}
            onready={async (e) => {
                console.log("Editor ready");
                editorStore.editor_view = e;
            }}
            onchange={async (e) => {
                editorStore.is_dirty = true;
                await debouncedCompileAndRender();
            }}
            extensions={resolvedLanguageExtensions}
            lineWrapping
            lineNumbers
            foldGutter
            editable={editableDocs.includes(documentExtension.ext)}
            autocompletion={completion}
            theme={currentTheme.editor}
            syntaxHighlighting={syntaxHighlight}
        />
        <!-- {lang} -->
    {/key}
{/if}
