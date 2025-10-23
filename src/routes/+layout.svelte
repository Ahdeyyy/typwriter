<script lang="ts">
    import "../app.css";
    import { ModeWatcher } from "mode-watcher";
    import { Button } from "@/components/ui/button";
    import {
        FolderTreeIcon,
        LucideCloudDownload,
        LucideEye,
        LucideMinimize2,
        LucideMinus,
        LucideOctagonAlert,
        LucideSettings,
        LucideSquare,
        LucideX,
    } from "@lucide/svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import ExporterDialog from "@/components/exporter/exporter-dialog.svelte";
    import { save } from "@tauri-apps/plugin-dialog";
    import { compile, export_main } from "@/commands";
    import { Toaster } from "$lib/components/ui/sonner/index.js";
    import { Badge } from "@/components/ui/badge";
    import { getFileName, getFileType } from "@/utils";
    import { toast } from "svelte-sonner";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import SunIcon from "@lucide/svelte/icons/sun";
    import MoonIcon from "@lucide/svelte/icons/moon";

    import { toggleMode, theme } from "mode-watcher";
    import {
        editorStore,
        mainSourceStore,
        paneStore,
        previewStore,
        workspaceStore,
    } from "@/store/index.svelte";
    import { updateApp } from "./updater";
    // import { WorkspaceStore } from "@/store/workspace.svelte";

    let { children } = $props();

    const window = getCurrentWindow();

    let isMaximized = $state(true);

    const openedFilePath = $derived.by(() => {
        if (editorStore.file_path) {
            return ` - ${getFileName(editorStore.file_path)}`;
        }
        return "";
    });

    // TODO: add a platform check for Windows, Linux, MacOS and use the appropriate icons for (minimize, maximize, close)
</script>

<ModeWatcher />
<Toaster />
<section class="h-screen flex flex-col">
    <header class="flex items-center justify-between">
        <div class="flex gap-0.5">
            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            class="w-10 h-8 rounded-none"
                            variant={paneStore.isFileTreePaneOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (paneStore.isFileTreePaneOpen =
                                    !paneStore.isFileTreePaneOpen)}
                        >
                            <FolderTreeIcon />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Open file tree (Ctrl + b)</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            class="w-10 h-8 rounded-none"
                            variant={paneStore.isPreviewPaneOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (paneStore.isPreviewPaneOpen =
                                    !paneStore.isPreviewPaneOpen)}
                        >
                            <LucideEye />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Toggle preview panel (Ctrl + k)</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            class="h-8 w-10 relative rounded-none"
                            variant={paneStore.isDiagnosticsPaneOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (paneStore.isDiagnosticsPaneOpen =
                                    !paneStore.isDiagnosticsPaneOpen)}
                        >
                            <LucideOctagonAlert />
                            {#if editorStore.file_path && editorStore.diagnostics.length > 0}
                                <Badge
                                    class="h-4 min-w-3 rounded-full px-1 absolute top-0 right-0 font-mono text-xs tabular-nums"
                                    variant="destructive"
                                >
                                    {editorStore.diagnostics.length > 99
                                        ? "99+"
                                        : editorStore.diagnostics.length}
                                </Badge>
                            {/if}
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Toggle diagnostics panel (Ctrl + o)</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <ExporterDialog />
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Export main source</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>
            <Button
                size="icon"
                variant="ghost"
                class="w-10 h-8 rounded-none"
                onclick={() => console.log("Settings")}
                disabled
            >
                <LucideSettings />
            </Button>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            onclick={async () => {
                                await updateApp();
                            }}
                            class="w-10 h-8 rounded-none"
                            variant="ghost"
                            size="icon"
                        >
                            <LucideCloudDownload />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Check for updates</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Button
                onclick={toggleMode}
                class="w-10 h-8 rounded-none"
                variant="ghost"
                size="icon"
            >
                <SunIcon
                    class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 !transition-all dark:-rotate-90 dark:scale-0"
                />
                <MoonIcon
                    class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 !transition-all dark:rotate-0 dark:scale-100"
                />
                <span class="sr-only">Toggle theme</span>
            </Button>

            <Button
                variant={mainSourceStore.file_path === editorStore.file_path
                    ? "default"
                    : "ghost"}
                class="rounded-none h-8"
                onclick={() => {
                    mainSourceStore.setMainSource(editorStore.file_path || "");
                }}
            >
                Set as main file
            </Button>
        </div>

        <h1 class="font-medium">
            {workspaceStore.name}
            {openedFilePath}
        </h1>

        <div class="flex gap-0">
            <Button
                size="icon"
                class="w-10 h-8 rounded-none"
                variant="ghost"
                onclick={() => window.minimize()}
            >
                <LucideMinus />
            </Button>

            <Button
                size="icon"
                class="w-10 h-8 rounded-none"
                variant="ghost"
                onclick={async () => {
                    const windowIsMaximized = await window.isMaximized();
                    if (windowIsMaximized) {
                        isMaximized = false;
                        window.unmaximize();
                    } else {
                        isMaximized = true;
                        window.maximize();
                    }
                }}
            >
                {#if isMaximized}
                    <LucideMinimize2 />
                {:else}
                    <LucideSquare />
                {/if}
            </Button>

            <Button
                size="icon"
                class="w-10 h-8 rounded-none hover:bg-destructive group"
                variant="ghost"
                onclick={() => window.close()}
            >
                <LucideX class="group-hover:stroke-destructive-foreground" />
            </Button>
        </div>
    </header>
    {@render children?.()}
</section>

<style>
    :global {
        html::-webkit-scrollbar {
            display: none;
        }

        /* Hide scrollbar for IE, Edge and Firefox */
        html {
            -ms-overflow-style: none; /* IE and Edge */
            scrollbar-width: none; /* Firefox */
        }
    }
</style>
