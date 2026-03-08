import { getCurrentLogView } from "$lib/ipc/commands";
import type { LogEntry, LogFileView, LogLevel } from "$lib/types";
import { logError } from "$lib/logger";

const pollIntervalMs = 3000;

export type LogSeverityFilter = "ALL" | "ERROR" | "WARN" | "INFO" | "OTHER";

function matchesSeverity(level: LogLevel, filter: LogSeverityFilter): boolean {
    switch (filter) {
        case "ALL":
            return true;
        case "ERROR":
            return level === "ERROR";
        case "WARN":
            return level === "WARN";
        case "INFO":
            return level === "INFO";
        case "OTHER":
            return level === "TRACE" || level === "DEBUG" || level === "UNKNOWN";
    }
}

class LogViewStore {
    data = $state<LogFileView | null>(null);
    isLoading = $state(false);
    error = $state<string | null>(null);
    searchQuery = $state("");
    severityFilter = $state<LogSeverityFilter>("ALL");
    lastLoadedAt = $state<Date | null>(null);

    private pollTimer: ReturnType<typeof setInterval> | null = null;

    filteredEntries = $derived.by(() => {
        const entries = this.data?.entries ?? [];
        const query = this.searchQuery.trim().toLowerCase();

        return entries.filter((entry) => {
            if (!matchesSeverity(entry.level, this.severityFilter)) {
                return false;
            }

            if (!query) {
                return true;
            }

            return [
                entry.level,
                entry.timestamp ?? "",
                entry.target ?? "",
                entry.message,
            ]
                .join(" ")
                .toLowerCase()
                .includes(query);
        });
    });

    summary = $derived.by(() => {
        const entries = this.data?.entries ?? [];
        let errorCount = 0;
        let warnCount = 0;
        let infoCount = 0;
        let otherCount = 0;

        for (const entry of entries) {
            switch (entry.level) {
                case "ERROR":
                    errorCount += 1;
                    break;
                case "WARN":
                    warnCount += 1;
                    break;
                case "INFO":
                    infoCount += 1;
                    break;
                default:
                    otherCount += 1;
                    break;
            }
        }

        return {
            total: entries.length,
            errorCount,
            warnCount,
            infoCount,
            otherCount,
        };
    });

    get hasChartData(): boolean {
        return (this.data?.chart ?? []).some((bucket) => bucket.info > 0 || bucket.warn > 0 || bucket.error > 0);
    }

    start(): void {
        if (this.pollTimer !== null) {
            return;
        }

        void this.refresh();
        this.pollTimer = setInterval(() => {
            void this.refresh({ background: true });
        }, pollIntervalMs);
    }

    stop(): void {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async refresh(options: { background?: boolean } = {}): Promise<void> {
        const { background = false } = options;
        if (!background) {
            this.isLoading = true;
        }

        const result = await getCurrentLogView();
        result.match(
            (data) => {
                this.data = data;
                this.error = null;
                this.lastLoadedAt = new Date();
            },
            (err) => {
                this.error = err;
                logError("Failed to load log view:", err);
            },
        );

        if (!background) {
            this.isLoading = false;
        }
    }

    toggleExpanded(expandedEntries: Record<number, boolean>, entry: LogEntry): Record<number, boolean> {
        return {
            ...expandedEntries,
            [entry.index]: !expandedEntries[entry.index],
        };
    }
}

export const logView = new LogViewStore();
