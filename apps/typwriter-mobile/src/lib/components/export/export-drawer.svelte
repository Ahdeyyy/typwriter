<script lang="ts">
  import {
    Pdf01Icon,
    ImageIcon,
    FileCodeIcon,
    CodeIcon,
    Download01Icon,
    Share01Icon,
    Alert02Icon,
    Loading03Icon,
    ArrowDown01Icon,
    CheckmarkBadge01Icon,
    FolderExportIcon,
    Package01Icon,
  } from "@hugeicons/core-free-icons";
  import { toast } from "svelte-sonner";
  import { openPath } from "@tauri-apps/plugin-opener";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import * as Drawer from "$lib/components/ui/drawer";
  import {
    exportPdf,
    exportPng,
    exportSvg,
    exportHtml,
    exportForShare,
  } from "$lib/ipc/commands";
  import type { ExportFormat } from "$lib/ipc/types";
  import { app } from "$lib/stores/app.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";

  // ── State ──────────────────────────────────────────────────────────────────

  let format = $state<ExportFormat>(settings.lastExportFormat || "pdf");
  let pageRangeMode = $state<"all" | "custom">("all");
  let pageRangeCustom = $state("");

  // PDF
  let pdfStandard = $state(settings.lastPdfStandard || "1.7");
  let pdfTitle = $state("");
  let pdfAuthor = $state("");
  let pdfIncludeDate = $state(false);
  let metadataOpen = $state(false);

  // PNG
  let pngScale = $state(settings.lastPngScale || 2.0);

  // Multi-page image packing
  let packageMode = $state<"zip" | "folder">(settings.lastPackageMode || "zip");

  // HTML
  let htmlPretty = $state(false);

  // Actions state
  let saving = $state(false);
  let sharing = $state(false);

  const totalPages = $derived(compileStore.pages.length);

  const PDF_STANDARDS = [
    { value: "1.7", label: "PDF 1.7 (default)" },
    { value: "2.0", label: "PDF 2.0 (modern)" },
    { value: "a-2b", label: "PDF/A-2b (archival)" },
    { value: "ua-1", label: "PDF/UA-1 (accessible)" },
    { value: "1.4", label: "PDF 1.4" },
    { value: "1.5", label: "PDF 1.5" },
    { value: "1.6", label: "PDF 1.6" },
    { value: "a-1b", label: "PDF/A-1b" },
    { value: "a-3b", label: "PDF/A-3b" },
    { value: "a-4", label: "PDF/A-4" },
  ];

  const DPI_OPTIONS = [
    { scale: 1.0, label: "1×", dpi: "72 DPI" },
    { scale: 2.0, label: "2×", dpi: "144 DPI" },
    { scale: 3.0, label: "3×", dpi: "216 DPI" },
    { scale: 4.0, label: "4×", dpi: "288 DPI" },
  ];

  function selectFormat(f: ExportFormat) {
    format = f;
    settings.setLastExportFormat(f);
  }

  function selectStandard(s: string) {
    pdfStandard = s;
    settings.setLastPdfStandard(s);
  }

  function selectScale(s: number) {
    pngScale = s;
    settings.setLastPngScale(s);
  }

  function selectPackageMode(m: "zip" | "folder") {
    packageMode = m;
    settings.setLastPackageMode(m);
  }

  // ─── Export Execution ──────────────────────────────────────────────────────

  async function ensureFreshCompile(): Promise<boolean> {
    if (compileStore.stale || compileStore.pages.length === 0) {
      await editor.flush();
      await compileStore.run();
    }
    return true;
  }

  function getPageRange(): string | null {
    if (pageRangeMode === "custom" && pageRangeCustom.trim()) {
      return pageRangeCustom.trim();
    }
    return null;
  }

  async function handleSave() {
    if (saving || sharing) return;
    await ensureFreshCompile();

    saving = true;
    const pageRange = getPageRange();

    try {
      if (format === "pdf") {
        const res = await exportPdf({
          pageRange,
          standard: pdfStandard,
          title: pdfTitle.trim() || null,
          author: pdfAuthor.trim() || null,
          includeDate: pdfIncludeDate,
        });
        saving = false;
        res.match(
          (name) => {
            toast.success(`Exported ${name}`);
            app.closeOverlay();
          },
          (err) => {
            if (err !== "Export cancelled") toast.error(`Export failed: ${err}`);
          },
        );
      } else if (format === "png") {
        const res = await exportPng({
          pageRange,
          scale: pngScale,
          packageMode,
        });
        saving = false;
        res.match(
          (name) => {
            toast.success(`Exported ${name}`);
            app.closeOverlay();
          },
          (err) => {
            if (err !== "Export cancelled") toast.error(`Export failed: ${err}`);
          },
        );
      } else if (format === "svg") {
        const res = await exportSvg({
          pageRange,
          packageMode,
        });
        saving = false;
        res.match(
          (name) => {
            toast.success(`Exported ${name}`);
            app.closeOverlay();
          },
          (err) => {
            if (err !== "Export cancelled") toast.error(`Export failed: ${err}`);
          },
        );
      } else if (format === "html") {
        const res = await exportHtml({
          pretty: htmlPretty,
        });
        saving = false;
        res.match(
          (name) => {
            toast.success(`Exported ${name}`);
            app.closeOverlay();
          },
          (err) => {
            if (err !== "Export cancelled") toast.error(`Export failed: ${err}`);
          },
        );
      }
    } catch (e) {
      saving = false;
      toast.error(`Export failed: ${e}`);
    }
  }

  async function handleShare() {
    if (saving || sharing) return;
    await ensureFreshCompile();

    sharing = true;
    const pageRange = getPageRange();

    const res = await exportForShare({
      format,
      pageRange,
      scale: pngScale,
      standard: pdfStandard,
      title: pdfTitle.trim() || null,
      author: pdfAuthor.trim() || null,
      pretty: htmlPretty,
      packageMode,
    });

    if (res.isErr()) {
      sharing = false;
      toast.error(`Share export failed: ${res.error}`);
      return;
    }

    const { filePath, fileName, mimeType, dataBase64 } = res.value;

    // First attempt: Web Share API with binary File
    let shared = false;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        const binary = atob(dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
          shared = true;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          sharing = false;
          return;
        }
      }
    }

    // Fallback: Open with system viewer / intent via opener
    if (!shared) {
      try {
        await openPath(filePath);
        toast.success(`Exported for sharing: ${fileName}`);
        app.closeOverlay();
      } catch (e) {
        toast.info(`Exported to ${filePath}`);
      }
    } else {
      app.closeOverlay();
    }

    sharing = false;
  }
</script>

<Drawer.Root
  open={app.overlay === "export"}
  onOpenChange={(o) => {
    if (!o) app.closeOverlay();
  }}
>
  <Drawer.Content class="max-h-[88vh] flex flex-col">
    <Drawer.Header class="pb-2">
      <div class="flex items-center justify-between">
        <Drawer.Title class="text-base font-semibold">Export Document</Drawer.Title>
        <span class="text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 text-xs font-medium">
          {totalPages} {totalPages === 1 ? "page" : "pages"}
        </span>
      </div>
      <Drawer.Description class="text-xs">
        Choose format and options to save or share.
      </Drawer.Description>
    </Drawer.Header>

    <ScrollArea class="flex-1 px-4">
      <div class="flex flex-col gap-4 pb-4">
        <!-- Error warning banner -->
        {#if compileStore.errors.length > 0}
          <div class="border-amber-500/30 bg-amber-500/10 flex items-start gap-2.5 rounded-lg border p-3">
            <Icon icon={Alert02Icon} class="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium text-amber-500">Document has compile errors</p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                Exporting will use the last successful build.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={() => app.openOverlay("diagnostics")}
            >
              Diagnostics
            </Button>
          </div>
        {/if}

        <!-- Format Selector Tabs -->
        <div>
          <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Format</span>
          <div class="bg-muted grid grid-cols-4 gap-1 rounded-lg p-1">
            <button
              class="flex flex-col items-center gap-1 rounded-md py-2 text-xs font-medium transition-colors {format === 'pdf' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => selectFormat("pdf")}
            >
              <Icon icon={Pdf01Icon} class="size-4" />
              <span>PDF</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md py-2 text-xs font-medium transition-colors {format === 'png' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => selectFormat("png")}
            >
              <Icon icon={ImageIcon} class="size-4" />
              <span>PNG</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md py-2 text-xs font-medium transition-colors {format === 'svg' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => selectFormat("svg")}
            >
              <Icon icon={FileCodeIcon} class="size-4" />
              <span>SVG</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 rounded-md py-2 text-xs font-medium transition-colors {format === 'html' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => selectFormat("html")}
            >
              <Icon icon={CodeIcon} class="size-4" />
              <span>HTML</span>
            </button>
          </div>
        </div>

        <!-- Page Range (PDF, PNG, SVG) -->
        {#if format !== "html"}
          <div>
            <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Pages</span>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="border-input flex items-center justify-center rounded-lg border p-2 text-xs font-medium transition-colors {pageRangeMode === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                onclick={() => (pageRangeMode = "all")}
              >
                All pages ({totalPages})
              </button>
              <button
                class="border-input flex items-center justify-center rounded-lg border p-2 text-xs font-medium transition-colors {pageRangeMode === 'custom' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                onclick={() => (pageRangeMode = "custom")}
              >
                Custom range
              </button>
            </div>
            {#if pageRangeMode === "custom"}
              <div class="mt-2">
                <Input
                  bind:value={pageRangeCustom}
                  placeholder="e.g. 1-3, 5"
                  class="h-9 font-mono text-xs"
                />
                <p class="text-muted-foreground mt-1 text-[11px]">
                  Comma-separated page numbers or ranges (e.g. "1, 3-5").
                </p>
              </div>
            {/if}
          </div>
        {/if}

        <!-- PDF Options -->
        {#if format === "pdf"}
          <div class="flex flex-col gap-3">
            <div>
              <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Standard</span>
              <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {#each PDF_STANDARDS.slice(0, 4) as std}
                  <button
                    class="border-input flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition-colors {pdfStandard === std.value ? 'bg-accent border-primary text-foreground font-medium' : 'bg-background text-muted-foreground hover:bg-muted'}"
                    onclick={() => selectStandard(std.value)}
                  >
                    <span>{std.label.split(' ')[0]}</span>
                    <span class="text-[10px] opacity-70">{std.label.split('(')[1]?.replace(')', '') || ''}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="flex items-center justify-between py-1">
              <div>
                <p class="text-xs font-medium">Include current date</p>
                <p class="text-muted-foreground text-[11px]">Stamp export timestamp into PDF metadata</p>
              </div>
              <Switch checked={pdfIncludeDate} onCheckedChange={(v) => (pdfIncludeDate = v)} />
            </div>

            <!-- Collapsible Metadata -->
            <div class="border-t pt-2">
              <button
                class="text-muted-foreground flex w-full items-center justify-between py-1 text-xs font-medium"
                onclick={() => (metadataOpen = !metadataOpen)}
              >
                <span>Document Metadata (optional)</span>
                <Icon
                  icon={ArrowDown01Icon}
                  class="size-4 transition-transform duration-200 {metadataOpen ? 'rotate-180' : ''}"
                />
              </button>
              {#if metadataOpen}
                <div class="mt-2 flex flex-col gap-2">
                  <Input
                    bind:value={pdfTitle}
                    placeholder="Document Title"
                    class="h-9 text-xs"
                  />
                  <Input
                    bind:value={pdfAuthor}
                    placeholder="Author"
                    class="h-9 text-xs"
                  />
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- PNG Options -->
        {#if format === "png"}
          <div class="flex flex-col gap-3">
            <div>
              <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Resolution</span>
              <div class="grid grid-cols-4 gap-1.5">
                {#each DPI_OPTIONS as opt}
                  <button
                    class="border-input flex flex-col items-center rounded-lg border py-2 text-xs transition-colors {pngScale === opt.scale ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-background text-foreground hover:bg-muted'}"
                    onclick={() => selectScale(opt.scale)}
                  >
                    <span class="font-semibold">{opt.label}</span>
                    <span class="text-[10px] opacity-80">{opt.dpi}</span>
                  </button>
                {/each}
              </div>
            </div>

            {#if totalPages > 1}
              <div>
                <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Packaging</span>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="border-input flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors {packageMode === 'zip' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                    onclick={() => selectPackageMode("zip")}
                  >
                    <Icon icon={Package01Icon} class="size-4" />
                    ZIP archive
                  </button>
                  <button
                    class="border-input flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors {packageMode === 'folder' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                    onclick={() => selectPackageMode("folder")}
                  >
                    <Icon icon={FolderExportIcon} class="size-4" />
                    Save to folder
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- SVG Options -->
        {#if format === "svg"}
          <div class="flex flex-col gap-3">
            {#if totalPages > 1}
              <div>
                <span class="text-muted-foreground mb-1.5 block text-xs font-medium">Packaging</span>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="border-input flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors {packageMode === 'zip' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                    onclick={() => selectPackageMode("zip")}
                  >
                    <Icon icon={Package01Icon} class="size-4" />
                    ZIP archive
                  </button>
                  <button
                    class="border-input flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors {packageMode === 'folder' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground hover:bg-muted'}"
                    onclick={() => selectPackageMode("folder")}
                  >
                    <Icon icon={FolderExportIcon} class="size-4" />
                    Save to folder
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- HTML Options -->
        {#if format === "html"}
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <div>
                <p class="text-xs font-medium">Pretty print HTML</p>
                <p class="text-muted-foreground text-[11px]">Format output with indentation</p>
              </div>
              <Switch checked={htmlPretty} onCheckedChange={(v) => (htmlPretty = v)} />
            </div>
          </div>
        {/if}
      </div>
    </ScrollArea>

    <!-- Drawer Footer Actions -->
    <Drawer.Footer class="border-t pt-3 pb-4">
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          class="h-11 gap-2 text-sm font-medium"
          disabled={saving || sharing}
          onclick={handleShare}
        >
          {#if sharing}
            <Icon icon={Loading03Icon} class="size-4 animate-spin" />
            <span>Sharing…</span>
          {:else}
            <Icon icon={Share01Icon} class="size-4" />
            <span>Share</span>
          {/if}
        </Button>
        <Button
          class="h-11 gap-2 text-sm font-medium"
          disabled={saving || sharing}
          onclick={handleSave}
        >
          {#if saving}
            <Icon icon={Loading03Icon} class="size-4 animate-spin" />
            <span>Saving…</span>
          {:else}
            <Icon icon={Download01Icon} class="size-4" />
            <span>Save</span>
          {/if}
        </Button>
      </div>
    </Drawer.Footer>
  </Drawer.Content>
</Drawer.Root>
