<script lang="ts">
    import { editorStore } from "@/store/index.svelte";
</script>

<div>
    {#if editorStore.content === ""}
        <p class="text-center text-sm text-muted-foreground mt-4">
            No content to display.
        </p>
    {:else}
        {@html editorStore.content}
    {/if}
</div>
