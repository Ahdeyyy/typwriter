<script lang="ts">
    import * as Empty from "@/components/ui/empty";
    import { Button } from "./ui/button";
    import {
        ArrowUpRightIcon,
        LucideFileQuestionMark,
        LucideFolderX,
    } from "@lucide/svelte";
    import { open_workspace } from "@/commands";
    import { workspaceStore } from "@/store/index.svelte";

    async function handleOpenWorkspace() {
        await workspaceStore.openWorkspace();
    }
</script>

<Empty.Root
    class="from-muted/80 to-background h-full bg-gradient-to-b from-30%"
>
    <Empty.Header>
        <Empty.Media variant="icon">
            <LucideFileQuestionMark />
        </Empty.Media>
        <Empty.Title>No open file</Empty.Title>
        <Empty.Description>
            You haven't open any file. Get started by opening a workspace
        </Empty.Description>
    </Empty.Header>
    <Empty.Content>
        <div class="flex gap-2">
            <Button onclick={async () => await handleOpenWorkspace()}>
                Open Workspace
            </Button>
            {#if workspaceStore.path}
                <Button disabled variant="outline">Open File</Button>
            {/if}
        </div>
    </Empty.Content>
    <Button variant="link" class="text-muted-foreground" size="sm">
        <a
            href="https://typst.app/docs/tutorial"
            target="_blank"
            rel="noreferrer"
        >
            New to Typst? Learn More <ArrowUpRightIcon class="inline" />
        </a>
    </Button>
</Empty.Root>
