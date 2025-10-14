<script lang="ts">
    import "../app.css";
    import { ModeWatcher } from "mode-watcher";
    import { Button } from "@/components/ui/button";
    import {
        FolderTreeIcon,
        LucideDownload,
        LucideEye,
        LucideHamburger,
        LucideMaximize,
        LucideMenu,
        LucideMinimize,
        LucideMinimize2,
        LucideMinus,
        LucideOctagonAlert,
        LucidePanelRight,
        LucidePanelRightClose,
        LucideSettings,
        LucideSquare,
        LucideX,
    } from "@lucide/svelte";
    // import { appState } from "@/states.svelte"
    import { appContext } from "@/app-context.svelte";
    import Diagnostics from "@/components/diagnostics-panel.svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { save } from "@tauri-apps/plugin-dialog";
    import { export_to } from "@/ipc";
    import { Toaster } from "$lib/components/ui/sonner/index.js";
    import { Badge } from "@/components/ui/badge";
    import { getFileName } from "@/utils";
    import { toast } from "svelte-sonner";
    import { PressedKeys } from "runed";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import SunIcon from "@lucide/svelte/icons/sun";
    import MoonIcon from "@lucide/svelte/icons/moon";

    import { toggleMode } from "mode-watcher";

    let { children } = $props();
    const keys = new PressedKeys();

    keys.onKeys(["Control", "k"], () => {
        appContext.isPreviewOpen = !appContext.isPreviewOpen;
    });

    keys.onKeys(["Control", "b"], () => {
        appContext.isFileTreeOpen = !appContext.isFileTreeOpen;
    });

    const window = getCurrentWindow();

    let isMaximized = $state(true);

    const openedFilePath = $derived.by(() => {
        if (appContext.workspace && appContext.workspace.document) {
            return ` - ${getFileName(appContext.workspace.document.path)}`;
        }
        return "";
    });

    const export_file_handler = async () => {
        if (!appContext.workspace || !appContext.workspace.document) {
            alert("Please open a file to export.");
            return;
        }
        const export_path = await save({
            defaultPath: appContext.workspace.document.path.replace(
                /\.[^/.]+$/,
                ".pdf",
            ),
            filters: [{ name: "PDF", extensions: ["pdf"] }],
        });

        if (export_path) {
            let res = await export_to(
                appContext.workspace.document.path,
                export_path,
                appContext.workspace.document.content,
            );
            if (res) {
                toast.error(res);
            } else {
                toast.success(
                    `${appContext.workspace.document.path} exported successfully!`,
                );
            }
        }
    };

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
                            variant={appContext.isFileTreeOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (appContext.isFileTreeOpen =
                                    !appContext.isFileTreeOpen)}
                        >
                            <FolderTreeIcon />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Open file tree</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            class="w-10 h-8 rounded-none"
                            variant={appContext.isPreviewOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (appContext.isPreviewOpen =
                                    !appContext.isPreviewOpen)}
                        >
                            <LucideEye />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Toggle preview panel (Ctrl + K)</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            class="h-8 w-10 relative rounded-none"
                            variant={appContext.isDiagnosticsOpen
                                ? "secondary"
                                : "ghost"}
                            onclick={() =>
                                (appContext.isDiagnosticsOpen =
                                    !appContext.isDiagnosticsOpen)}
                        >
                            <LucideOctagonAlert />
                            {#if appContext.workspace && appContext.workspace.document && appContext.workspace.document.diagnostics.length > 0}
                                <Badge
                                    class="h-4 min-w-3 rounded-full px-1 absolute top-0 right-0 font-mono text-xs tabular-nums"
                                    variant="destructive"
                                >
                                    {appContext.workspace.document.diagnostics
                                        .length > 99
                                        ? "99+"
                                        : appContext.workspace.document
                                              .diagnostics.length}
                                </Badge>
                            {/if}
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Toggle diagnostics panel</p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>

            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        <Button
                            size="icon"
                            variant="ghost"
                            class="w-10 h-8 rounded-none"
                            onclick={export_file_handler}
                        >
                            <LucideDownload />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        <p>Export to PDF</p>
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
        </div>

        <h1 class="font-medium">
            {appContext.workspace?.name || ""}
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
