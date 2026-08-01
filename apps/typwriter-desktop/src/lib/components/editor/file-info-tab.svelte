<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Archive02Icon,
    BinaryCodeIcon,
    DatabaseIcon,
    File01Icon,
    FolderOpenIcon,
    LinkSquare02Icon,
    MusicNote01Icon,
    Pdf01Icon,
    TextFontIcon,
    Video01Icon,
  } from "@hugeicons/core-free-icons";
  import { Button } from "$lib/components/ui/button/index.js";
  import { openFileExternally, revealFileInManager } from "$lib/ipc/commands";
  import { dirname } from "$lib/paths";
  import type { TabInfo } from "$lib/stores/editor.svelte";
  import { logError } from "$lib/logger";
  import { toast } from "svelte-sonner";

  let { tab }: { tab: TabInfo } = $props();

  /** Extension → (icon, human label). Only formats that can actually reach this
   *  pane are listed: `read_file` opens everything else as text or an image. */
  const KINDS: Record<string, { icon: typeof File01Icon; label: string }> = {
    pdf: { icon: Pdf01Icon, label: "PDF document" },
    zip: { icon: Archive02Icon, label: "ZIP archive" },
    gz: { icon: Archive02Icon, label: "Gzip archive" },
    tgz: { icon: Archive02Icon, label: "Gzip archive" },
    bz2: { icon: Archive02Icon, label: "Bzip2 archive" },
    xz: { icon: Archive02Icon, label: "XZ archive" },
    zst: { icon: Archive02Icon, label: "Zstandard archive" },
    "7z": { icon: Archive02Icon, label: "7-Zip archive" },
    rar: { icon: Archive02Icon, label: "RAR archive" },
    tar: { icon: Archive02Icon, label: "Tar archive" },
    jar: { icon: Archive02Icon, label: "Java archive" },
    exe: { icon: BinaryCodeIcon, label: "Windows executable" },
    dll: { icon: BinaryCodeIcon, label: "Windows library" },
    so: { icon: BinaryCodeIcon, label: "Shared library" },
    dylib: { icon: BinaryCodeIcon, label: "Shared library" },
    bin: { icon: BinaryCodeIcon, label: "Binary file" },
    wasm: { icon: BinaryCodeIcon, label: "WebAssembly module" },
    class: { icon: BinaryCodeIcon, label: "Java class file" },
    o: { icon: BinaryCodeIcon, label: "Object file" },
    a: { icon: BinaryCodeIcon, label: "Static library" },
    lib: { icon: BinaryCodeIcon, label: "Static library" },
    obj: { icon: BinaryCodeIcon, label: "Object file" },
    pdb: { icon: BinaryCodeIcon, label: "Debug symbols" },
    pyc: { icon: BinaryCodeIcon, label: "Python bytecode" },
    ttf: { icon: TextFontIcon, label: "TrueType font" },
    otf: { icon: TextFontIcon, label: "OpenType font" },
    woff: { icon: TextFontIcon, label: "Web font" },
    woff2: { icon: TextFontIcon, label: "Web font" },
    eot: { icon: TextFontIcon, label: "Embedded font" },
    mp3: { icon: MusicNote01Icon, label: "MP3 audio" },
    wav: { icon: MusicNote01Icon, label: "WAV audio" },
    flac: { icon: MusicNote01Icon, label: "FLAC audio" },
    ogg: { icon: MusicNote01Icon, label: "Ogg audio" },
    m4a: { icon: MusicNote01Icon, label: "M4A audio" },
    mp4: { icon: Video01Icon, label: "MP4 video" },
    mkv: { icon: Video01Icon, label: "Matroska video" },
    mov: { icon: Video01Icon, label: "QuickTime video" },
    avi: { icon: Video01Icon, label: "AVI video" },
    webm: { icon: Video01Icon, label: "WebM video" },
    db: { icon: DatabaseIcon, label: "Database" },
    sqlite: { icon: DatabaseIcon, label: "SQLite database" },
    sqlite3: { icon: DatabaseIcon, label: "SQLite database" },
    heic: { icon: File01Icon, label: "HEIC image" },
    psd: { icon: File01Icon, label: "Photoshop document" },
  };

  /** A leading dot marks a hidden file, not an extension — `.DS_Store` has
   *  none, `archive.tar.gz` is a `gz`. */
  function extensionOf(name: string): string {
    const idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
  }

  const ext = $derived(extensionOf(tab.name));
  const kind = $derived(
    KINDS[ext] ?? {
      icon: File01Icon,
      label: ext ? `${ext.toUpperCase()} file` : "File",
    },
  );

  const folder = $derived(dirname(tab.relPath));

  function formatSize(bytes: number): string {
    if (bytes < 1000) {
      return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1000;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000;
      unit += 1;
    }
    // Keep one decimal until the number is big enough not to need it.
    const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
    return `${rounded} ${units[unit]} (${bytes.toLocaleString()} bytes)`;
  }

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  /** The rows of the detail table, skipping anything the filesystem didn't
   *  tell us about. */
  const rows = $derived.by(() => {
    const meta = tab.fileMeta;
    const out: { label: string; value: string }[] = [
      { label: "Type", value: kind.label },
      { label: "Location", value: folder === "" ? "Workspace root" : folder },
    ];
    if (meta?.size != null) {
      out.push({ label: "Size", value: formatSize(meta.size) });
    }
    if (meta?.modified != null) {
      out.push({ label: "Modified", value: formatDate(meta.modified) });
    }
    if (meta?.created != null) {
      out.push({ label: "Created", value: formatDate(meta.created) });
    }
    if (meta?.readonly) {
      out.push({ label: "Access", value: "Read-only" });
    }
    return out;
  });

  function openExternally() {
    openFileExternally(tab.absPath).mapErr((err) => {
      logError("file-info: open externally failed:", err);
      toast.error("Couldn't open this file", { description: err });
    });
  }

  function revealInManager() {
    revealFileInManager(tab.absPath).mapErr((err) => {
      logError("file-info: reveal in file manager failed:", err);
      toast.error("Couldn't show this file", { description: err });
    });
  }
</script>

<div class="flex h-full items-center justify-center overflow-auto p-6">
  <div class="w-full max-w-md">
    <div class="flex items-start gap-4">
      <div class="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted/40">
        <HugeiconsIcon icon={kind.icon} class="size-6 text-muted-foreground" />
      </div>
      <div class="min-w-0 pt-0.5">
        <h2 class="truncate text-base font-medium" title={tab.name}>{tab.name}</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Typwriter can't display this format — here's what's on disk.
        </p>
      </div>
    </div>

    <dl class="mt-5 divide-y divide-border/60 border-y border-border/60 text-sm">
      {#each rows as row (row.label)}
        <div class="flex gap-4 py-2">
          <dt class="w-24 shrink-0 text-xs text-muted-foreground">{row.label}</dt>
          <dd class="min-w-0 flex-1 break-words text-xs">{row.value}</dd>
        </div>
      {/each}
    </dl>

    <div class="mt-5 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onclick={openExternally}>
        <HugeiconsIcon icon={LinkSquare02Icon} class="size-3.5" />
        Open in default app
      </Button>
      <Button variant="ghost" size="sm" onclick={revealInManager}>
        <HugeiconsIcon icon={FolderOpenIcon} class="size-3.5" />
        Show in folder
      </Button>
    </div>
  </div>
</div>
