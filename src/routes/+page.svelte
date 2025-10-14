<script lang="ts">
    // import { appState } from "@/states.svelte"
    import PreviewPane from "@/components/preview-pane.svelte";

    import type { LayoutData } from "./$types";

    import Editor from "@/components/editor.svelte";
    import NoSelectedFile from "@/components/no-selected-file.svelte";
    import * as Resizable from "$lib/components/ui/resizable/index.js";
    import FileTreePane from "@/components/filetree/pane.svelte";
    import Diagnostics from "@/components/diagnostics-panel.svelte";
    import { appContext } from "@/app-context.svelte";

    let { data }: { data: LayoutData } = $props();
</script>

<main class="flex-1 w-screen">
    <Resizable.PaneGroup class=" h-full w-full mt-0.5" direction="horizontal">
        <!-- {#if appContext.isFileTreeOpen} -->
        <Resizable.Pane
            minSize={15}
            hidden={!appContext.isFileTreeOpen}
            defaultSize={15}
        >
            <FileTreePane />
        </Resizable.Pane>
        <!-- {/if} -->
        <Resizable.Handle hidden={!appContext.isFileTreeOpen} />

        <Resizable.Pane>
            <Resizable.PaneGroup direction="horizontal">
                <Resizable.Pane class="flex-1 min-h-md">
                    {@render EditorAndDiagnosticGroup()}
                </Resizable.Pane>

                <Resizable.Handle hidden={!appContext.isPreviewOpen} />
                <Resizable.Pane
                    hidden={!appContext.isPreviewOpen}
                    defaultSize={45}
                >
                    <PreviewPane />
                </Resizable.Pane>
            </Resizable.PaneGroup>
        </Resizable.Pane>
    </Resizable.PaneGroup>
</main>

{#snippet EditorAndDiagnosticGroup()}
    <Resizable.PaneGroup direction="vertical">
        <Resizable.Pane>
            <div class="h-full">
                {#if appContext.workspace && appContext.workspace.document}
                    <Editor />
                {:else}
                    <NoSelectedFile />
                {/if}
            </div>
        </Resizable.Pane>

        <Resizable.Handle hidden={!appContext.isDiagnosticsOpen} />
        <Resizable.Pane hidden={!appContext.isDiagnosticsOpen} defaultSize={30}>
            <Diagnostics />
        </Resizable.Pane>
    </Resizable.PaneGroup>
{/snippet}
