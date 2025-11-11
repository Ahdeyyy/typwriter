<script lang="ts">
    import { EditorState, Compartment } from "@codemirror/state";
    import { EditorView } from "@codemirror/view";
    import { onMount } from "svelte";
    import type { Extension } from "@codemirror/state";
    import { watch } from "runed";

    interface Props {
        value?: string;
        extensions?: Extension[];
        lang?: Extension;
        onchange?: (value: string, view: EditorView) => void;
        onready?: (view: EditorView) => void;
        theme?: Extension;
    }

    let {
        value = $bindable(""),
        extensions = [],
        lang,
        onchange,
        onready,
        theme,
    }: Props = $props();

    let editor: HTMLElement;
    let view: EditorView | undefined = $state();

    // Create compartments for dynamic reconfiguration
    const languageCompartment = new Compartment();
    const extensionsCompartment = new Compartment();
    const themeCompartment = new Compartment();

    onMount(() => {
        const fixedHeight = EditorView.theme({
            "&": { height: "92svh" },
            ".cm-scroller": { overflow: "auto" },
        });

        const editorWidth = EditorView.theme({
            "&": { width: "100%" },
        });

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const text = update.state.doc.toString();
                value = text;
                if (onchange) {
                    onchange(text, update.view);
                }
            }
        });

        const initialExtensions = [
            EditorView.lineWrapping,
            fixedHeight,
            editorWidth,
            updateListener,
            languageCompartment.of(lang || []),
            extensionsCompartment.of(extensions || []),
            themeCompartment.of(theme || []),
        ];

        view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: initialExtensions,
            }),
            parent: editor,
        });

        if (onready) {
            onready(view);
        }

        return () => {
            view?.destroy();
        };
    });

    // Update language when it changes
    $effect(() => {
        if (view && lang !== undefined) {
            view.dispatch({
                effects: languageCompartment.reconfigure(lang || []),
            });
        }
    });

    // Update extensions when they change
    $effect(() => {
        if (view && extensions) {
            view.dispatch({
                effects: extensionsCompartment.reconfigure(extensions || []),
            });
        }
    });

    // Update document content when value changes externally
    $effect(() => {
        if (view && value !== undefined) {
            const currentValue = view.state.doc.toString();
            if (value !== currentValue) {
                const transaction = view.state.update({
                    changes: {
                        from: 0,
                        to: currentValue.length,
                        insert: value,
                    },
                });
                view.dispatch(transaction);
            }
        }
    });
</script>

<div bind:this={editor} id="editor"></div>

<style>
    #editor {
        width: 100%;
        height: 100%;
    }
</style>
