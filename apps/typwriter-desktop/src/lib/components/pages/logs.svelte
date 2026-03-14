<script lang="ts">
  import { ArrowLeft, Clock, FileText, ArrowCounterClockwise, MagnifyingGlass, Warning, X } from "phosphor-svelte";
  import { LineChart } from "layerchart";
  import * as Chart from "$lib/components/ui/chart/index.js";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { page } from "$lib/stores/page.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { logView, type LogSeverityFilter } from "$lib/stores/log-view.svelte";
  import type { LogEntry } from "$lib/types";

  const chartConfig = {
    info: {
      label: "Info",
      color: "var(--chart-2)",
    },
    warn: {
      label: "Warn",
      color: "var(--chart-3)",
    },
    error: {
      label: "Error",
      color: "var(--chart-5)",
    },
  } satisfies Chart.ChartConfig;

  const filters: LogSeverityFilter[] = ["ALL", "ERROR", "WARN", "INFO", "OTHER"];

  let expandedEntries = $state<Record<number, boolean>>({});

  $effect(() => {
    logView.start();
    return () => {
      logView.stop();
      expandedEntries = {};
    };
  });

  function handleBack() {
    page.back(workspace.rootPath ? "workspace" : "home");
  }

  function handleRefresh() {
    void logView.refresh();
  }

  function formatTimestamp(value: string | null): string {
    if (!value) {
      return "No timestamp";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString();
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function levelTone(level: LogEntry["level"]): string {
    switch (level) {
      case "ERROR":
        return "border-destructive/40 bg-destructive/10 text-destructive";
      case "WARN":
        return "border-[color:var(--chart-3)]/40 bg-[color:var(--chart-3)]/10 text-[color:var(--chart-3)]";
      case "INFO":
        return "border-[color:var(--chart-2)]/40 bg-[color:var(--chart-2)]/10 text-[color:var(--chart-2)]";
      default:
        return "border-border bg-muted text-muted-foreground";
    }
  }

  function previewMessage(entry: LogEntry): string {
    return entry.message.split("\n")[0] ?? "";
  }

  function shouldShowDetail(entry: LogEntry): boolean {
    return expandedEntries[entry.index] || entry.message.includes("\n");
  }

  function toggleEntry(entry: LogEntry) {
    expandedEntries = logView.toggleExpanded(expandedEntries, entry);
  }

  function filterLabel(filter: LogSeverityFilter): string {
    if (filter === "ALL") return "All";
    if (filter === "OTHER") return "Other";
    return filter[0] + filter.slice(1).toLowerCase();
  }
</script>

<div class="relative flex h-screen w-screen overflow-hidden">
  <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
    <!-- ─── Left sidebar ──────────────────────────────────────────────── -->
    <Resizable.Pane defaultSize={25} minSize={15} maxSize={40}>
      <div class="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <!-- Sidebar header -->
        <div class="flex h-9 items-center justify-between border-b border-sidebar-border px-2">
          <div class="flex items-center gap-0.5 min-w-0">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Back"
              aria-label="Back"
              onclick={handleBack}
            >
              <ArrowLeft class="size-3.5" />
            </Button>
            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
              Logs
            </span>
            {#if logView.isLoading}
              <span class="text-[10px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse">
                Loading
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Refresh"
              aria-label="Refresh"
              onclick={handleRefresh}
            >
              <ArrowCounterClockwise class="size-3.5" />
            </Button>
          </div>
        </div>

        <!-- Sidebar body -->
        <ScrollArea class="flex-1 min-h-0">
          <div class="flex flex-col gap-3 p-2">
            <!-- Summary stats -->
            <div class="flex flex-col gap-1">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Summary
              </p>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Entries</span>
                  <span class="font-medium tabular-nums">{logView.summary.total}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Errors</span>
                  <span class="font-medium tabular-nums text-destructive">{logView.summary.errorCount}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Warnings</span>
                  <span class="font-medium tabular-nums text-[color:var(--chart-3)]">{logView.summary.warnCount}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Info</span>
                  <span class="font-medium tabular-nums text-[color:var(--chart-2)]">{logView.summary.infoCount}</span>
                </div>
              </div>
            </div>

            <!-- Severity filter -->
            <div class="flex flex-col gap-1">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Severity
              </p>
              <div class="flex flex-wrap gap-1">
                {#each filters as filter}
                  <button
                    class="h-6 rounded-md px-2 text-xs transition-colors
                           {logView.severityFilter === filter
                             ? 'bg-accent text-accent-foreground font-medium'
                             : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
                    onclick={() => (logView.severityFilter = filter)}
                  >
                    {filterLabel(filter)}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Chart -->
            <div class="flex flex-col gap-1">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Trend
              </p>
              {#if logView.hasChartData}
                <Chart.Container config={chartConfig} class="min-h-[140px] w-full">
                  <LineChart
                    data={logView.data?.chart ?? []}
                    x="label"
                    series={[
                      { key: "info", label: chartConfig.info.label, color: chartConfig.info.color },
                      { key: "warn", label: chartConfig.warn.label, color: chartConfig.warn.color },
                      { key: "error", label: chartConfig.error.label, color: chartConfig.error.color },
                    ]}
                    props={{
                      yAxis: {
                        format: (value) => `${value}`,
                      },
                    }}
                  >
                    {#snippet tooltip()}
                      <Chart.Tooltip />
                    {/snippet}
                  </LineChart>
                </Chart.Container>
              {:else}
                <div class="flex min-h-[140px] items-center justify-center rounded border border-dashed border-sidebar-border bg-muted/20">
                  <p class="text-[10px] text-muted-foreground">No chart data yet</p>
                </div>
              {/if}
            </div>

            <!-- File info -->
            <div class="flex flex-col gap-0.5 border-t border-sidebar-border pt-2">
              <div class="flex items-center gap-1 text-[10px] text-muted-foreground">
                <FileText class="size-3 shrink-0" />
                <span class="truncate">{logView.data?.path ?? "Resolving..."}</span>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{formatFileSize(logView.data?.size_bytes ?? 0)}</span>
                <span class="text-border">|</span>
                <span>{formatTimestamp(logView.data?.modified_at ?? null)}</span>
              </div>
              <div class="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock class="size-3 shrink-0" />
                <span>
                  Updated {logView.lastLoadedAt ? logView.lastLoadedAt.toLocaleTimeString() : "never"}
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </Resizable.Pane>

    <Resizable.Handle />

    <!-- ─── Right main pane ───────────────────────────────────────────── -->
    <Resizable.Pane defaultSize={75} minSize={40}>
      <div class="flex h-full flex-col bg-background">
        <!-- Toolbar -->
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3">
          <div class="relative flex-1 max-w-sm">
            <MagnifyingGlass class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
            <Input
              class="h-6 pl-6 pr-6 text-xs"
              placeholder="Search messages, targets..."
              bind:value={logView.searchQuery}
            />
            {#if logView.searchQuery}
              <button
                class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onclick={() => (logView.searchQuery = "")}
                aria-label="Clear search"
              >
                <X class="size-3" />
              </button>
            {/if}
          </div>

          <div class="flex-1"></div>

          <span class="text-xs text-muted-foreground tabular-nums">
            {logView.filteredEntries.length} / {logView.summary.total}
          </span>

          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText class="size-3.5" />
            <span>{logView.data?.exists ? "Live" : "Waiting"}</span>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0">
          {#if logView.error}
            <div class="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <Warning class="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p class="font-medium">Failed to load logs</p>
                <p class="mt-0.5 whitespace-pre-wrap text-destructive/80">{logView.error}</p>
              </div>
            </div>
          {/if}

          {#if !(logView.data?.exists ?? false)}
            <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
              <FileText class="size-10 opacity-30" />
              <span class="text-sm">Waiting for log file</span>
              <span class="text-xs opacity-50 max-w-xs truncate font-mono">
                {logView.data?.path ?? "Resolving..."}
              </span>
            </div>
          {:else if logView.filteredEntries.length === 0}
            <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
              <MagnifyingGlass class="size-10 opacity-30" />
              <span class="text-sm">No matching entries</span>
              <span class="text-xs opacity-50">Adjust search or severity filter</span>
            </div>
          {:else}
            <ScrollArea class="h-full">
              <div class="divide-y divide-border">
                {#each logView.filteredEntries as entry (entry.index)}
                  <button
                    type="button"
                    class="w-full px-3 py-1.5 text-left transition-colors hover:bg-muted/40"
                    onclick={() => toggleEntry(entry)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                        {entry.timestamp ?? "??:??"}
                      </span>
                      <span class={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.15em] ${levelTone(entry.level)}`}>
                        {entry.level}
                      </span>
                      <span class="min-w-0 shrink truncate font-mono text-[10px] text-muted-foreground">
                        {entry.target ?? ""}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-xs text-foreground">
                        {previewMessage(entry)}
                      </span>
                    </div>

                    {#if shouldShowDetail(entry) && entry.message !== previewMessage(entry)}
                      <pre class="mt-1.5 ml-36 overflow-x-auto rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground whitespace-pre-wrap break-words font-mono">{entry.message}</pre>
                    {/if}
                  </button>
                {/each}
              </div>
            </ScrollArea>
          {/if}
        </div>
      </div>
    </Resizable.Pane>
  </Resizable.PaneGroup>
</div>
