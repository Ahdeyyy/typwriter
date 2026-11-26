<script lang="ts">
  // The update flow at the top of the General pane, sized like any other
  // setting row. The row *is* the progress UI: the version line grows a
  // "→ vNext" when a release is out, the status line turns into live download
  // stats, and the row's own bottom edge fills as the download runs. One button
  // always takes the next step. The store raises no toasts, so failures are
  // shown here too.
  import { fly } from "svelte/transition";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowRight02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
  import Button from "#lib/components/ui/button/button.svelte";
  import { cn } from "#lib/utils.ts";
  import { platform } from "#lib/stores/platform.svelte.ts";
  import { updater } from "#lib/stores/updater.svelte.ts";

  function formatBytes(bytes: number) {
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  function formatEta(seconds: number) {
    if (seconds < 1) return "almost done";
    if (seconds < 60) return `${Math.ceil(seconds)}s left`;
    return `${Math.ceil(seconds / 60)} min left`;
  }

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

  // Ticks so "checked just now" ages while the window stays open.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  function ago(date: Date) {
    const minutes = Math.round((date.getTime() - now) / 60_000);
    if (minutes > -1) return "just now";
    if (minutes > -60) return relative.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (hours > -24) return relative.format(hours, "hour");
    return relative.format(Math.round(hours / 24), "day");
  }

  // Release notes are GitHub markdown; reduce them to headings, bullets and
  // paragraphs rather than ship a markdown renderer for one panel.
  type NoteLine = { kind: "heading" | "bullet" | "text"; text: string };
  const noteLines = $derived.by<NoteLine[]>(() => {
    if (!updater.notes) return [];
    const clean = (t: string) =>
      t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(\*\*|__|`)/g, "").trim();
    return updater.notes
      .split(/\r?\n/)
      .map((raw): NoteLine | null => {
        const line = raw.trim();
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return { kind: "heading", text: clean(heading[1]) };
        const bullet = line.match(/^[-*+]\s+(.*)$/);
        if (bullet) return { kind: "bullet", text: clean(bullet[1]) };
        return line ? { kind: "text", text: clean(line) } : null;
      })
      .filter((l): l is NoteLine => l !== null && l.text.length > 0);
  });

  const current = $derived(
    platform.appVersion ? `v${platform.appVersion.replace(/^v/i, "")}` : "…",
  );
  const next = $derived(updater.displayVersion);
  const pending = $derived(
    updater.status === "available" ||
      updater.status === "downloading" ||
      updater.status === "ready" ||
      updater.status === "installing",
  );
  const downloading = $derived(updater.status === "downloading");

  const status = $derived.by(() => {
    switch (updater.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return updater.releaseDate
          ? `New release, out ${dateFormat.format(updater.releaseDate)}`
          : "New release available";
      case "downloading": {
        const parts = [
          updater.totalBytes
            ? `${formatBytes(updater.downloadedBytes)} of ${formatBytes(updater.totalBytes)}`
            : formatBytes(updater.downloadedBytes),
        ];
        if (updater.bytesPerSecond) parts.push(`${formatBytes(updater.bytesPerSecond)}/s`);
        if (updater.secondsLeft !== null) parts.push(formatEta(updater.secondsLeft));
        return parts.join(" · ");
      }
      case "ready":
        return "Downloaded. Restart to finish installing";
      case "installing":
        return "Installing…";
      default:
        return updater.upToDate && updater.checkedAt
          ? `Up to date · checked ${ago(updater.checkedAt)}`
          : "Not checked yet";
    }
  });

  const actionLabel = $derived.by(() => {
    switch (updater.status) {
      case "checking":
        return "Checking…";
      case "available":
        return updater.error ? "Retry" : "Download";
      case "downloading":
        return updater.progress === null ? "Downloading…" : `${updater.progress}%`;
      case "ready":
      case "installing":
        return "Restart";
      default:
        return updater.error ? "Try again" : "Check now";
    }
  });

  let notesOpen = $state(false);
</script>

<div class="relative overflow-hidden rounded-md border border-border">
  <div class="flex items-center justify-between gap-4 px-4 py-3">
    <div class="min-w-0">
      <p class="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        Typwriter
        <span class={cn("font-mono", pending && "text-muted-foreground line-through decoration-1")}>
          {current}
        </span>
        {#if pending && next}
          <span class="flex items-center gap-1.5" in:fly={{ x: -6, duration: 250 }}>
            <HugeiconsIcon icon={ArrowRight02Icon} class="size-3.5 text-muted-foreground" />
            <span class="font-mono text-primary">{next}</span>
          </span>
        {/if}
      </p>
      <p
        class={cn(
          "flex items-center gap-1.5 text-xs tabular-nums",
          updater.error ? "text-destructive" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        <span
          class={cn(
            "size-1.5 shrink-0 rounded-full",
            updater.error
              ? "bg-destructive"
              : pending
                ? "bg-primary"
                : updater.upToDate
                  ? "bg-foreground/60"
                  : "bg-muted-foreground/40",
            (updater.busy || updater.status === "ready") && "motion-safe:animate-pulse",
          )}
          aria-hidden="true"
        ></span>
        <span class="truncate">{updater.error ?? status}</span>
        {#if pending && noteLines.length && !downloading}
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-0.5 rounded-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-expanded={notesOpen}
            aria-controls="update-release-notes"
            onclick={() => (notesOpen = !notesOpen)}
          >
            · What's new
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              class={cn("size-3 transition-transform", notesOpen && "rotate-180")}
            />
          </button>
        {/if}
      </p>
    </div>

    <Button
      size="sm"
      variant={pending ? "default" : "outline"}
      class="min-w-24 shrink-0 tabular-nums disabled:opacity-100"
      disabled={updater.busy}
      onclick={() => updater.advance()}
    >
      {actionLabel}
    </Button>
  </div>

  {#if notesOpen && pending && noteLines.length}
    <div
      id="update-release-notes"
      class="max-h-56 overflow-y-auto border-t border-border px-4 py-3 text-xs leading-relaxed"
    >
      {#each noteLines as line, i (i)}
        {#if line.kind === "heading"}
          <p class="mt-3 font-semibold first:mt-0">{line.text}</p>
        {:else if line.kind === "bullet"}
          <p class="mt-1 flex gap-2 text-muted-foreground">
            <span aria-hidden="true">•</span><span>{line.text}</span>
          </p>
        {:else}
          <p class="mt-1 text-muted-foreground">{line.text}</p>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- The row's bottom edge is the download bar. It stays full once the
       download lands, until the restart. -->
  {#if downloading || updater.status === "ready" || updater.status === "installing"}
    <div
      class="absolute inset-x-0 bottom-0 h-0.5"
      role="progressbar"
      aria-label="Downloading {next}"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={downloading ? (updater.progress ?? undefined) : 100}
    >
      <div
        class="h-full bg-primary shadow-[0_0_8px_var(--color-primary)] transition-[width] duration-300 ease-out"
        style="width: {downloading ? (updater.progress ?? 0) : 100}%"
      ></div>
      {#if downloading && updater.progress === null}
        <div class="update-sweep absolute inset-0 motion-reduce:hidden" aria-hidden="true"></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Unknown download size: a short segment sweeps the edge instead. */
  .update-sweep {
    background: linear-gradient(90deg, transparent, var(--color-primary), transparent)
      no-repeat;
    background-size: 30% 100%;
    animation: update-sweep 1.2s ease-in-out infinite;
  }

  @keyframes update-sweep {
    from {
      background-position: -30% 0;
    }
    to {
      background-position: 130% 0;
    }
  }
</style>
