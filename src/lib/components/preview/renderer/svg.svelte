<script lang="ts">
    import { editorStore } from "@/store/index.svelte";
</script>

<div>
    {#if editorStore.content === ""}
        <p class="text-center text-sm text-muted-foreground mt-4">
            No content to display.
        </p>
    {:else}
        <div class=" px-1">
            <img
                src={`data:image/svg+xml;base64,${btoa(editorStore.content)}`}
                alt="SVG Preview"
                class="w-screen h-screen object-contain object-center"
            />
        </div>
    {/if}
</div>
