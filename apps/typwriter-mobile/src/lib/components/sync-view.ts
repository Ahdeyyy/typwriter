// How each sync state looks and reads, shared by the indicator and the
// details sheet.
import { CloudCheckIcon, CloudIcon, CloudOffIcon, CloudSyncIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/svelte";
import type { SyncStatus } from "#lib/ipc/types.ts";

export interface SyncView {
  icon: IconSvgElement;
  label: string;
  /** Text colour class. */
  tone: string;
  /** Background classes for the status dot. */
  dot: string;
  explanation: string;
}

export function syncView(status: SyncStatus): SyncView | null {
  switch (status.state) {
    case "syncing":
      return {
        icon: CloudSyncIcon,
        label: status.total ? `Syncing ${status.done ?? 0} of ${status.total}` : "Syncing",
        tone: "text-primary",
        dot: "bg-primary animate-pulse",
        explanation: "Bringing in changes from the folder.",
      };
    case "synced":
      return {
        icon: CloudCheckIcon,
        label: "Synced",
        tone: "text-muted-foreground",
        dot: "bg-muted-foreground/60",
        explanation:
          "Up to date. Your saves go straight to the folder, and changes from other devices show up within a few seconds.",
      };
    case "paused":
      return {
        icon: CloudIcon,
        label: "Paused",
        tone: "text-muted-foreground",
        dot: "bg-muted-foreground/60",
        explanation: "Paused while Typwriter is in the background. It catches up when you come back.",
      };
    case "offline":
      return {
        icon: CloudOffIcon,
        label: "Can't reach folder",
        tone: "text-destructive",
        dot: "bg-destructive",
        explanation:
          "The folder may have been moved or deleted, or access to it was removed. Saving fails until it's back.",
      };
    default:
      return null;
  }
}
