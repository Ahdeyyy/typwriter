<script lang="ts">
    import { editorStore } from "@/store/index.svelte";
    import { getFileType } from "@/utils";
    import { readFile } from "@tauri-apps/plugin-fs";

    const EXT_TO_MIME = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        bmp: "image/bmp",
        webp: "image/webp",
        svg: "image/svg+xml",
    } as const;

    function buildImageSrc(content: string, ext: string): string {
        if (!content) return "";
        if (content.startsWith("data:")) return content;

        // Special-case SVG: support both raw XML and base64 content
        if (ext === "svg") {
            const trimmed = content.trimStart();
            if (trimmed.startsWith("<")) {
                return `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
            }
            return `data:image/svg+xml;base64,${content}`;
        } else if (["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext)) {
            if (editorStore.binary_content) {
                const bytes = Uint8Array.from(editorStore.binary_content);

                const imgBlob = new Blob([bytes], { type: `image/${ext}` });
                const objUrl = URL.createObjectURL(imgBlob);
                return objUrl;
            }
            return "";
        }

        const mime = (EXT_TO_MIME as Record<string, string>)[ext] ?? "";
        // Assume non-SVG images are base64 data (common for binary content in editors)
        return `data:${mime || "application/octet-stream"};base64,${content}`;
    }

    const ext = $derived(
        editorStore.file_path ? getFileType(editorStore.file_path) : "",
    );
    const src = $derived(buildImageSrc(editorStore.content, ext));
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
            class="max-w-full max-h-full object-contain"
            decoding="async"
            loading="eager"
        />
    {/if}
</div>
