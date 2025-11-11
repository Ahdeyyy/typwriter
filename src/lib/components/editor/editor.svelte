<script lang="ts">
    import CodeMirror from "svelte-codemirror-editor";

    import {
        ayuLight,
        hoverTooltip,
        throttledCompileAndRender,
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
        get_cursor_position_extern,
        get_pages_len,
        render_page,
        render_pages,
        update_file,
    } from "@/commands";
    import { mode } from "mode-watcher";

    import { useThrottle } from "runed";

    import {
        editorStore,
        mainSourceStore,
        previewStore,
    } from "@/store/index.svelte";
    import { getFileType, murmurHash3 } from "@/utils";
    import { cobalt } from "thememirror";
    import { keymap, lineNumbers, EditorView } from "@codemirror/view";
    import { toast } from "svelte-sonner";
    import { bibtex } from "@citedrive/codemirror-lang-bibtex";
    import { indentationMarkers } from "@replit/codemirror-indentation-markers";
    import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
    import type { Extension } from "@codemirror/state";
    import {
        syntaxHighlighting,
        defaultHighlightStyle,
        bracketMatching,
        foldGutter,
        indentOnInput,
    } from "@codemirror/language";
    import { closeBrackets } from "@codemirror/autocomplete";
    import { autocompletion } from "@codemirror/autocomplete";

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

    const remountEditor = $derived.by(() => {
        // remount the editor when the file path changes, the mode changes, or the file type changes

        if (
            editorStore.file_path &&
            (editorStore.file_path !== mainSourceStore.file_path ||
                documentExtension.ext !== getFileType(editorStore.file_path) ||
                mode.current)
        ) {
            return true;
        }
        // console.log("Not remounting editor for file:", editorStore.file_path);
        // console.log("Current mode:", mode.current, "Previous mode:", mode.previous);
        // console.log("Current file path:", editorStore.file_path);
        // console.log("Current file type:", documentExtension.ext);
        // console.log("Main source file path:", mainSourceStore.file_path);
        // console.log("Document extension:", documentExtension);
        // console.log("Editable docs:", editableDocs);
        // console.log("Editor view:", editorStore.editor_view);
        // console.log("Editor content:", editorStore.content);
        // console.log("Editor diagnostics:", editorStore.diagnostics);
        // console.log("Editor is dirty:", editorStore.is_dirty);
        // console.log("Editor file path:", editorStore.file_path);
        // console.log("Editor file type:", getFileType(editorStore.file_path));
        return "";
    });

    let currentTheme = $derived.by(() => {
        return mode.current === "dark"
            ? { editor: cobalt, syntax: typstMidnightHighlightStyle }
            : { editor: ayuLight, syntax: typstBlueprintHighlightStyle };
    });

    const syntaxHighlightExtension = $derived.by(() => {
        return syntaxHighlighting(currentTheme.syntax, { fallback: false });
    });

    let completionExtension = $derived.by(() => {
        const path = documentExtension.path;
        if (documentExtension.ext === "typ") {
            return autocompletion({
                override: [typst_completion],
                activateOnTyping: true,
            });
        }
        return autocompletion();
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
        } else if (documentExtension.ext === "bib") {
            return bibtex();
        }
        return undefined;
    });

    let allExtensions = $derived.by(() => {
        const path = documentExtension.path;
        const extensions: Extension[] = [
            lineNumbers(),
            foldGutter(),
            EditorView.lineWrapping,
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            indentationMarkers(),
            syntaxHighlightExtension,
            completionExtension,
            saveKeybind,
            keymap.of(vscodeKeymap),
        ];

        // Add language-specific extensions
        switch (documentExtension.ext) {
            case "typ": {
                extensions.push(hoverTooltip(typst_hover_tooltip));

                if (editorStore.file_path === mainSourceStore.file_path) {
                    extensions.push(typstLinter(editorStore.diagnostics));
                }
                break;
            }
            case "yaml":
                break;
            default:
        }

        // Add readonly if not editable
        if (!editableDocs.includes(documentExtension.ext)) {
            extensions.push(EditorView.editable.of(false));
        }

        return extensions;
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
            editorStore.diagnostics = compile_result.error;
            toast.error("Failed to compile the document");
            return;
        }
        editorStore.diagnostics = compile_result.value;

        await render();
    };

    async function render() {
        const cursor = editorStore.editor_view
            ? editorStore.editor_view.state.selection.main.head
            : 0;
        const position = await get_cursor_position_extern(
            cursor,
            editorStore.content,
            editorStore.file_path || "",
        );
        const pages = await get_pages_len();

        if (pages.isOk()) {
            console.log(
                "Pages length:",
                pages.value,
                "Current preview items:",
                previewStore.items.length,
            );
            if (pages.value !== previewStore.items.length) {
                // rerender all the pages and return
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
                            previewStore.items.splice(idx, 1, existing_page);
                            continue;
                        } else {
                            const img = new Image();
                            img.src = `data:image/png;base64,${page.image}`;
                            img.width = page.width;
                            img.height = page.height;
                            previewStore.render_cache.set(page_hash, img);
                            previewStore.items.splice(idx, 1, img);
                        }
                    }
                }
                return;
            }
        }

        if (position.isOk()) {
            // render single page
            //
            //
            //    // use the current page to the render the exact page
            previewStore.current_position = position.value;
            console.log(position.value);
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
            if (position.isErr()) {
                console.error(
                    "failed to get cursor position:",
                    position.error.message,
                );
            }
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
                        previewStore.items.splice(idx, 1, existing_page);
                        continue;
                    } else {
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
    }

    const debouncedCompileAndRender = useThrottle(async () => {
        await compileAndRender();
    }, 90);
</script>

{#key remountEditor}
    <CodeMirror
        styles={{
            "&": {
                height: "95vh",
                width: "100%",
            },
            ".cm-scroller": { overflow: "auto" },
        }}
        bind:value={editorStore.content}
        lang={editorLanguage}
        extensions={allExtensions}
        onready={(view) => {
            editorStore.editor_view = view;
        }}
        onchange={async (text) => {
            editorStore.is_dirty = true;
            await throttledCompileAndRender();
        }}
        syntaxHighlighting={{
            highlighter: currentTheme.syntax,
            fallback: false,
        }}
        theme={currentTheme.editor}
    />
{/key}

<style>
    :global {
        .codemirror-wrapper {
            width: 100%;
        }
    }
</style>
