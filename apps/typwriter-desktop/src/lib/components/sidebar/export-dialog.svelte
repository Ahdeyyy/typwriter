<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
  import { Select } from "bits-ui";
  import { toast } from "svelte-sonner";

  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import {
    exportHtmlWithPicker,
    exportPdfWithPicker,
    exportPngWithPicker,
    exportSvgWithPicker,
  } from "$lib/services/export-service";
  import { workspace } from "$lib/stores/workspace.svelte";

  // ── Props ────────────────────────────────────────────────────────────────

  interface Props {
    open: boolean;
    totalPages: number;
  }

  let { open = $bindable(), totalPages }: Props = $props();

  // ── State ────────────────────────────────────────────────────────────────

  type Format = "pdf" | "png" | "svg" | "html";

  let format = $state<Format>("pdf");
  let exporting = $state(false);

  // Shared
  let pageRangeMode = $state<"all" | "custom">("all");
  let pageRangeCustom = $state("");

  // PDF
  let pdfTitle = $state("");
  let pdfAuthor = $state("");
  let pdfStandard = $state("1.7");
  let pdfIncludeDate = $state(false);
  let pdfPretty = $state(false);

  // HTML
  let htmlPretty = $state(false);

  // PNG
  let pngScale = $state(2.0);

  // PNG/SVG shared
  let filePrefix = $state("page");

  const pageRangeInputId = "export-page-range";
  const pdfTitleInputId = "export-pdf-title";
  const pdfAuthorInputId = "export-pdf-author";
  const pngPrefixInputId = "export-png-prefix";
  const svgPrefixInputId = "export-svg-prefix";

  // ── Constants ─────────────────────────────────────────────────────────────

  const PDF_STANDARDS = [
    { value: "1.4", label: "PDF 1.4" },
    { value: "1.5", label: "PDF 1.5" },
    { value: "1.6", label: "PDF 1.6" },
    { value: "1.7", label: "PDF 1.7 (default)" },
    { value: "2.0", label: "PDF 2.0" },
    { value: "a-1b", label: "PDF/A-1b" },
    { value: "a-2b", label: "PDF/A-2b" },
    { value: "a-3b", label: "PDF/A-3b" },
    { value: "a-4", label: "PDF/A-4" },
    { value: "ua-1", label: "PDF/UA-1 (accessible)" },
    { value: "a-2b+ua-1", label: "PDF/A-2b + UA-1" },
    { value: "a-3b+ua-1", label: "PDF/A-3b + UA-1" },
  ];

  const DPI_PRESETS = [
    { scale: 1.0, label: "72 DPI" },
    { scale: 2.0, label: "144 DPI" },
    { scale: 3.0, label: "216 DPI" },
    { scale: 4.0, label: "288 DPI" },
  ];

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedStandardLabel = $derived(
    PDF_STANDARDS.find((s) => s.value === pdfStandard)?.label ?? pdfStandard,
  );

  // ── Export handler ───────────────────────────────────────────────────────

  async function handleExport() {
    exporting = true;
    const pageRange =
      pageRangeMode === "custom" && pageRangeCustom.trim()
        ? pageRangeCustom.trim()
        : null;

    try {
      if (format === "pdf") {
        const mainName = workspace.mainFile
          ? workspace.mainFile.replace(/\.typ$/, ".pdf")
          : "document.pdf";

        const result = await exportPdfWithPicker(mainName, {
          title: pdfTitle || null,
          author: pdfAuthor || null,
          pdf_standard: pdfStandard !== "1.7" ? pdfStandard : null,
          include_date: pdfIncludeDate,
          pretty: pdfPretty,
        });
        if (!result) return;
        result.match(
          () => {
            toast.success("PDF exported successfully");
            open = false;
          },
          (err) => toast.error(`Export failed: ${err}`),
        );
      } else if (format === "html") {
        const mainName = workspace.mainFile
          ? workspace.mainFile.replace(/\.typ$/, ".html")
          : "document.html";

        const result = await exportHtmlWithPicker(mainName, {
          pretty: htmlPretty,
        });
        if (!result) return;
        result.match(
          () => {
            toast.success("HTML exported successfully");
            open = false;
          },
          (err) => toast.error(`Export failed: ${err}`),
        );
      } else if (format === "png") {
        const result = await exportPngWithPicker({
          scale: pngScale,
          prefix: filePrefix || "page",
          page_range: pageRange,
        });
        if (!result) return;
        result.match(
          () => {
            toast.success("PNG images exported successfully");
            open = false;
          },
          (err) => toast.error(`Export failed: ${err}`),
        );
      } else {
        const result = await exportSvgWithPicker({
          prefix: filePrefix || "page",
          page_range: pageRange,
        });
        if (!result) return;
        result.match(
          () => {
            toast.success("SVG files exported successfully");
            open = false;
          },
          (err) => toast.error(`Export failed: ${err}`),
        );
      }
    } catch (err) {
      toast.error(`Export failed: ${err}`);
    } finally {
      exporting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Export Document</Dialog.Title>
      <Dialog.Description>
        Export your document to PDF, PNG, SVG, or HTML.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2">
      <!-- ── Format selector ─────────────────────────────────────────── -->
      <div class="flex gap-1 rounded-lg border border-border p-1">
        {#each [["pdf", "PDF"], ["png", "PNG"], ["svg", "SVG"], ["html", "HTML"]] as [value, label]}
          <Button
            variant={format === value ? "default" : "ghost"}
            size="sm"
            class="flex-1"
            onclick={() => (format = value as Format)}
          >
            {label}
          </Button>
        {/each}
      </div>

      <!-- ── Page range (PNG/SVG only) ─────────────────────────────── -->
      {#if format === "png" || format === "svg"}
        <div class="space-y-2">
          <p class="text-sm font-medium text-foreground">Pages</p>
          <div class="flex gap-1.5">
            <Button
              variant={pageRangeMode === "all" ? "default" : "outline"}
              size="sm"
              onclick={() => (pageRangeMode = "all")}
            >
              All{totalPages > 0 ? ` (${totalPages})` : ""}
            </Button>
            <Button
              variant={pageRangeMode === "custom" ? "default" : "outline"}
              size="sm"
              onclick={() => (pageRangeMode = "custom")}
            >
              Custom
            </Button>
          </div>
          {#if pageRangeMode === "custom"}
            <label class="sr-only" for={pageRangeInputId}>Custom page range</label>
            <Input
              id={pageRangeInputId}
              placeholder="e.g. 1-3, 5, 7-9"
              bind:value={pageRangeCustom}
            />
          {/if}
        </div>
      {/if}

      <!-- ── PDF options ─────────────────────────────────────────────── -->
      {#if format === "pdf"}
        <div class="space-y-3">
          <div class="space-y-1.5">
            <p class="text-sm font-medium text-foreground">PDF Standard</p>
            <Select.Root type="single" bind:value={pdfStandard}>
              <Select.Trigger
                class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>{selectedStandardLabel}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} class="size-4 opacity-50" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  class="z-50 min-w-[var(--bits-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  sideOffset={4}
                >
                  {#each PDF_STANDARDS as std}
                    <Select.Item
                      value={std.value}
                      label={std.label}
                      class="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      {std.label}
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium text-foreground" for={pdfTitleInputId}>Title</label>
            <Input
              id={pdfTitleInputId}
              placeholder="Document title (optional)"
              bind:value={pdfTitle}
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium text-foreground" for={pdfAuthorInputId}>Author</label>
            <Input
              id={pdfAuthorInputId}
              placeholder="Author name (optional)"
              bind:value={pdfAuthor}
            />
          </div>

          <div class="space-y-1.5">
            <p class="text-sm font-medium text-foreground">Document date</p>
            <div class="flex gap-1.5">
              <Button
                variant={pdfIncludeDate ? "default" : "outline"}
                size="sm"
                class="flex-1"
                onclick={() => (pdfIncludeDate = true)}
              >
                Today
              </Button>
              <Button
                variant={!pdfIncludeDate ? "default" : "outline"}
                size="sm"
                class="flex-1"
                onclick={() => (pdfIncludeDate = false)}
              >
                None
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              {pdfIncludeDate
                ? "Stamped with today's date if document date is auto."
                : "No creation date will be set."}
            </p>
          </div>

          <div class="space-y-1.5">
            <p class="text-sm font-medium text-foreground">Output</p>
            <div class="flex gap-1.5">
              <Button
                variant={!pdfPretty ? "default" : "outline"}
                size="sm"
                class="flex-1"
                onclick={() => (pdfPretty = false)}
              >
                Compact
              </Button>
              <Button
                variant={pdfPretty ? "default" : "outline"}
                size="sm"
                class="flex-1"
                onclick={() => (pdfPretty = true)}
              >
                Readable
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              {pdfPretty
                ? "Uncompressed, human-readable PDF (larger file)."
                : "Space-optimized PDF (smaller file)."}
            </p>
          </div>
        </div>
      {/if}

      <!-- ── PNG options ─────────────────────────────────────────────── -->
      {#if format === "png"}
        <div class="space-y-3">
          <div class="space-y-1.5">
            <p class="text-sm font-medium text-foreground">Resolution</p>
            <div class="flex gap-1.5">
              {#each DPI_PRESETS as preset}
                <Button
                  variant={pngScale === preset.scale ? "default" : "outline"}
                  size="sm"
                  class="flex-1"
                  onclick={() => (pngScale = preset.scale)}
                >
                  {preset.label}
                </Button>
              {/each}
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium text-foreground" for={pngPrefixInputId}>File prefix</label>
            <Input id={pngPrefixInputId} bind:value={filePrefix} placeholder="page" />
            <p class="text-xs text-muted-foreground">
              {filePrefix || "page"}-1.png, {filePrefix || "page"}-2.png, ...
            </p>
          </div>
        </div>
      {/if}

      <!-- ── SVG options ─────────────────────────────────────────────── -->
      {#if format === "svg"}
        <div class="space-y-1.5">
          <label class="text-sm font-medium text-foreground" for={svgPrefixInputId}>File prefix</label>
          <Input id={svgPrefixInputId} bind:value={filePrefix} placeholder="page" />
          <p class="text-xs text-muted-foreground">
            {filePrefix || "page"}-1.svg, {filePrefix || "page"}-2.svg, ...
          </p>
        </div>
      {/if}

      <!-- ── HTML options ────────────────────────────────────────────── -->
      {#if format === "html"}
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-foreground">Output</p>
          <div class="flex gap-1.5">
            <Button
              variant={!htmlPretty ? "default" : "outline"}
              size="sm"
              class="flex-1"
              onclick={() => (htmlPretty = false)}
            >
              Minified
            </Button>
            <Button
              variant={htmlPretty ? "default" : "outline"}
              size="sm"
              class="flex-1"
              onclick={() => (htmlPretty = true)}
            >
              Readable
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Exports the whole document as a single HTML file (math as MathML).
          </p>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={handleExport} disabled={exporting}>
        {exporting ? "Exporting..." : "Export"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
