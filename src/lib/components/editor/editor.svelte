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

    import {
        compile,
        get_cursor_position,
        render_page,
        render_pages,
        update_file,
    } from "@/commands";
    import { mode } from "mode-watcher";

    import { useDebounce, useInterval, useThrottle, watch } from "runed";

    import {
        editorStore,
        mainSourceStore,
        previewStore,
    } from "@/store/index.svelte";
    import { getFileType, murmurHash3 } from "@/utils";
    import { noctisLilac } from "thememirror";
    import { keymap } from "@codemirror/view";
    import { toast } from "svelte-sonner";
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
            ? { editor: ayuLight, syntax: typstMidnightHighlightStyle }
            : { editor: ayuLight, syntax: typstBlueprintHighlightStyle };
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

    // update the current file source
    // compile and render preview

    const compileAndRender = async () => {
        const res = await update_file(
            editorStore.file_path || "",
            editorStore.content,
        );
        if (res.isErr()) {
            console.error(
                "failed to update the file before rendering",
                res.error.message,
            );
            toast.error("Failed to update the file before rendering");
            return;
        }

        const compile_result = await compile();
        if (compile_result.isErr()) {
            console.error(
                "failed to compile the document",
                compile_result.error.message,
            );
            toast.error("Failed to compile the document");
            return;
        }
        editorStore.diagnostics = compile_result.value;

        const cursor = editorStore.editor_view
            ? editorStore.editor_view.state.selection.main.head
            : 0;
        const position = await get_cursor_position(cursor, editorStore.content);

        if (
            position.isOk() &&
            editorStore.file_path === mainSourceStore.file_path
        ) {
            // use the current page to the render the exact page
            previewStore.current_position = position.value;
            const render_result = await render_page(position.value.page - 1);
            if (render_result.isErr()) {
                console.error("failed to render the page");
                toast.error("Failed to render the page");
            } else {
                const page = render_result.value;
                const page_hash = `${murmurHash3(page.image)}${position.value.page - 1}`;
                const existing_page = previewStore.render_cache.get(page_hash);
                if (existing_page) {
                    // page already exists in cache
                    previewStore.items.splice(
                        position.value.page - 1,
                        1,
                        existing_page,
                    );
                } else {
                    // add page to cache

                    const img = new Image();
                    img.src = `data:image/png;base64,${page.image}`;
                    img.width = page.width;
                    img.height = page.height;
                    previewStore.render_cache.set(page_hash, img);
                    previewStore.items.splice(position.value.page - 1, 1, img);
                }
            }
        } else {
            const render_result = await render_pages();
            //   console.log("Render result:", render_result)
            if (render_result.isErr()) {
                console.error("failed to render the pages");
                toast.error("Failed to render the pages");
            } else {
                const pages = render_result.value;
                for (let idx = 0; idx < pages.length; idx++) {
                    const page = pages[idx];
                    const page_hash = `${murmurHash3(page.image)}${idx}`;
                    const existing_page =
                        previewStore.render_cache.get(page_hash);
                    if (existing_page) {
                        // page already exists in cache
                        previewStore.items.splice(idx, 1, existing_page);
                        continue;
                    } else {
                        // add page to cache
                        const img = new Image();
                        img.src = `data:image/png;base64,${page.image}`;
                        img.width = page.width;
                        img.height = page.height;
                        previewStore.render_cache.set(page_hash, img);
                        previewStore.items.splice(idx, 1, img);
                    }
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
