<script lang="ts">
  import { ArrowLeft, Clock3, FileText, RefreshCcw, TriangleAlert } from "@lucide/svelte";
  import { LineChart } from "layerchart";
  import * as Chart from "$lib/components/ui/chart/index.js";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
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
</script>

<div class="flex h-screen w-screen flex-col overflow-y-auto bg-background text-foreground">
  <div class="border-b border-border px-6 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-3">
        <Button variant="outline" class="gap-2" onclick={handleBack}>
          <ArrowLeft class="size-4" />
          Back
        </Button>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-semibold tracking-tight">Logs</h1>
            {#if logView.isLoading}
              <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Loading
              </span>
            {/if}
          </div>
          <p class="mt-1 truncate font-mono text-xs text-muted-foreground">
            {logView.data?.path ?? "Resolving log path..."}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 class="size-3.5" />
        <span>
          Last updated
          {logView.lastLoadedAt ? logView.lastLoadedAt.toLocaleTimeString() : "never"}
        </span>
        <Button variant="outline" class="gap-2" onclick={handleRefresh}>
          <RefreshCcw class="size-4" />
          Refresh
        </Button>
      </div>
    </div>
  </div>

  {#if logView.error}
    <div class="px-6 pt-6">
      <div class="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <TriangleAlert class="mt-0.5 size-4 shrink-0" />
        <div>
          <p class="font-medium">Failed to load logs.</p>
          <p class="mt-1 whitespace-pre-wrap text-destructive/90">{logView.error}</p>
        </div>
      </div>
    </div>
  {/if}

  <div class="grid gap-4 px-6 py-6">
    <div class="grid gap-3 md:grid-cols-4">
      <div class="rounded-lg border border-border bg-card px-4 py-3">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Entries</p>
        <p class="mt-2 text-2xl font-semibold">{logView.summary.total}</p>
      </div>
      <div class="rounded-lg border border-border bg-card px-4 py-3">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Errors</p>
        <p class="mt-2 text-2xl font-semibold text-destructive">{logView.summary.errorCount}</p>
      </div>
      <div class="rounded-lg border border-border bg-card px-4 py-3">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Warnings</p>
        <p class="mt-2 text-2xl font-semibold text-[color:var(--chart-3)]">{logView.summary.warnCount}</p>
      </div>
      <div class="rounded-lg border border-border bg-card px-4 py-3">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">File</p>
        <p class="mt-2 text-sm font-medium">{formatFileSize(logView.data?.size_bytes ?? 0)}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          {formatTimestamp(logView.data?.modified_at ?? null)}
        </p>
      </div>
    </div>

    <div class="rounded-xl border border-border bg-card p-4">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium">Severity over time</p>
          <p class="text-xs text-muted-foreground">
            Minute buckets from the current log file.
          </p>
        </div>
      </div>

      {#if logView.hasChartData}
        <Chart.Container config={chartConfig} class="min-h-[260px] w-full">
          <LineChart
            data={logView.data?.chart ?? []}
            x="label"
            series={[
              { key: "info", label: chartConfig.info.label, color: chartConfig.info.color },
              { key: "warn", label: chartConfig.warn.label, color: chartConfig.warn.color },
              { key: "error", label: chartConfig.error.label, color: chartConfig.error.color },
            ]}
            legend
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
        <div class="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div class="text-center">
            <p class="text-sm font-medium">No chartable log activity yet</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Info, warn, and error entries will appear here once they are written.
            </p>
          </div>
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="w-full md:max-w-sm">
        <Input
          placeholder="Search messages, targets, timestamps..."
          bind:value={logView.searchQuery}
        />
      </div>
      <div class="flex flex-wrap gap-2">
        {#each filters as filter}
          <Button
            variant={logView.severityFilter === filter ? "default" : "outline"}
            size="sm"
            onclick={() => (logView.severityFilter = filter)}
          >
            {filter === "ALL" ? "All" : filter === "OTHER" ? "Other" : filter[0] + filter.slice(1).toLowerCase()}
          </Button>
        {/each}
      </div>
    </div>
  </div>

  <div class="flex-1 px-6 pb-6">
    <div class="flex min-h-full flex-col rounded-xl border border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p class="text-sm font-medium">Log entries</p>
          <p class="text-xs text-muted-foreground">
            {logView.filteredEntries.length} shown of {logView.summary.total}
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText class="size-3.5" />
          {logView.data?.exists ? "Current file" : "Waiting for log file"}
        </div>
      </div>

      {#if !(logView.data?.exists ?? false)}
        <div class="flex h-full items-center justify-center px-6">
          <div class="max-w-lg text-center">
            <p class="text-sm font-medium">No log file yet</p>
            <p class="mt-2 text-sm text-muted-foreground">
              Typwriter has not written the current log file yet.
            </p>
            <p class="mt-3 break-all rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              {logView.data?.path ?? "Resolving log file path..."}
            </p>
          </div>
        </div>
      {:else if logView.filteredEntries.length === 0}
        <div class="flex h-full items-center justify-center px-6">
          <div class="text-center">
            <p class="text-sm font-medium">No matching log entries</p>
            <p class="mt-2 text-sm text-muted-foreground">
              Adjust the search query or severity filter to widen the results.
            </p>
          </div>
        </div>
      {:else}
        <div class="min-h-[24rem] flex-1 overflow-y-auto">
          <div class="divide-y divide-border">
            {#each logView.filteredEntries as entry (entry.index)}
              <button
                type="button"
                class="w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
                onclick={() => toggleEntry(entry)}
              >
                <div class="flex flex-wrap items-start gap-3">
                  <span class="min-w-32 shrink-0 font-mono text-xs text-muted-foreground">
                    {entry.timestamp ?? "UNKNOWN"}
                  </span>
                  <span class={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${levelTone(entry.level)}`}>
                    {entry.level}
                  </span>
                  <span class="min-w-0 shrink truncate font-mono text-xs text-muted-foreground">
                    {entry.target ?? "unknown-target"}
                  </span>
                </div>
                <div class="mt-2 pl-0 md:pl-[calc(8rem+0.75rem)]">
                  <p class="whitespace-pre-wrap break-words text-sm text-foreground">
                    {previewMessage(entry)}
                  </p>
                  {#if shouldShowDetail(entry) && entry.message !== previewMessage(entry)}
                    <pre class="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">{entry.message}</pre>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
