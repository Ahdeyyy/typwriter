<script lang="ts">
    import { editorStore } from "@/store/index.svelte";

    function buildSvgSrc(content: string) {
        if (!content) return "";
        if (content.startsWith("data:")) return content;

        const trimmed = content.trimStart();

        // If the content looks like raw SVG markup, encode as UTF-8
        if (trimmed.startsWith("<")) {
            return `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
        }

        // Otherwise assume it's base64-encoded SVG
        return `data:image/svg+xml;base64,${content}`;
    }

    const src = $derived(buildSvgSrc(editorStore.content));
    const alt = $derived(
        editorStore.file_path
            ? (editorStore.file_path.split(/[\\/]/).pop() ?? "")
            : "",
    );
</script>

<div class="h-full w-full overflow-auto flex items-center justify-center p-2">
    {#if !editorStore.content}
        <p class="text-center text-sm text-muted-foreground mt-4">
            No content to display.
        </p>
    {:else}
        <img
            {src}
            {alt}
            class="max-w-full max-h-full object-contain object-center"
            decoding="async"
            loading="eager"
        />
    {/if}
</div>
