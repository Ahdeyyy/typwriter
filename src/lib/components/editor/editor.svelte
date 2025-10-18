<script lang="ts">
    import {
        ayuLight,
        CodeMirror,
        coolGlow,
        hoverTooltip,
        typst,
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

    import { editorStore, previewStore } from "@/store/index.svelte";
    import { getFileType } from "@/utils";
    import {
        barf,
        birdsOfParadise,
        boysAndGirls,
        cobalt,
        dracula,
        noctisLilac,
        solarizedLight,
    } from "thememirror";
    import { keymap } from "@codemirror/view";
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

    let saveKeybind = keymap.of([
        {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
                if (editorStore.file_path) {
                    editorStore.saveFile(true);
                }
                return true;
            },
        },
    ]);

    let currentTheme = $derived.by(() => {
        return mode.current === "dark"
            ? { editor: noctisLilac, syntax: typstMidnightHighlightStyle }
            : { editor: noctisLilac, syntax: typstBlueprintHighlightStyle };
    });

    const syntaxHighlight = $derived.by(() => {
        return {
            highlighter: currentTheme.syntax,
            fallback: false,
        };
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

    const editorLanguage = $derived.by(() => {
        const path = documentExtension.path;
        // console.log("Editor Language for:", path);
        if (documentExtension.ext === "typ") {
            return typst(); // typst();
        } else if (
            documentExtension.ext === "yaml" ||
            documentExtension.ext === "yml"
        ) {
            return yaml();
        }
        return undefined;
    });

    let languageSpecificExtensions = $derived.by(() => {
        const path = documentExtension.path;
        // console.log("Language Extensions for:", path);

        switch (documentExtension.ext) {
            case "typ": {
                return [
                    hoverTooltip(typst_hover_tooltip),
                    typstLinter(editorStore.diagnostics),
                ];
            }
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

    const debouncedCompileAndRender = useThrottle(async () => {
        await compileAndRender();
    }, 90);
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
                // console.log("Editor ready");
                editorStore.editor_view = e;
                // console.log(e);
            }}
            onchange={async (e) => {
                editorStore.is_dirty = true;
                await debouncedCompileAndRender();
            }}
            extensions={[...languageSpecificExtensions, saveKeybind]}
            lineWrapping
            lineNumbers
            foldGutter
            editable={editableDocs.includes(documentExtension.ext)}
            autocompletion={completion}
            theme={currentTheme.editor}
            nodebounce={true}
            closeBrackets
            bracketMatching
            lang={editorLanguage}
            syntaxHighlighting={syntaxHighlight}
        />
    {/key}
{/if}
