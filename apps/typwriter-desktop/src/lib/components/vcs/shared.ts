// vcs/shared.ts
//
// Display helpers + thin store wrappers for the history pane, kept out
// of the component so ledger.svelte only contains layout. Selection /
// restore semantics:
//
//   * plain click        → primary selection (diff vs working tree)
//   * modifier click     → secondary selection (two-point diff)
//   * restore            → confirmed via native dialog; backend makes a
//                          pre-restore safety point first

import { toast } from 'svelte-sonner';
import {
    ArrowReloadHorizontalIcon,
    FileEditIcon,
    FloppyDiskIcon,
    GitCommitIcon,
    PlayIcon,
    Tag01Icon
} from '@hugeicons/core-free-icons';

import { vcs } from '$lib/stores/vcs.svelte';
import type { CommitTrigger, RestorePoint } from '$lib/types';

// ─── Trigger presentation ────────────────────────────────────────────────

export const triggerLabel: Record<CommitTrigger, string> = {
    initial: 'Initial',
    manual: 'Manual',
    save: 'Save',
    compile: 'Compile',
    pre_restore: 'Pre-restore',
    file_op: 'File change'
};

export const triggerIcon: Record<CommitTrigger, typeof PlayIcon> = {
    initial: GitCommitIcon,
    manual: Tag01Icon,
    save: FloppyDiskIcon,
    compile: PlayIcon,
    pre_restore: ArrowReloadHorizontalIcon,
    file_op: FileEditIcon
};

// ─── Time / id formatting ────────────────────────────────────────────────

export function shortId(id: string): string {
    return id.slice(0, 7);
}

export function relTime(sec: number): string {
    const now = Date.now() / 1000;
    const diff = Math.max(0, now - sec);
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
    return new Date(sec * 1000).toLocaleDateString();
}

/** "14:32" — used where the day is already implied by a group header. */
export function clockTime(sec: number): string {
    const d = new Date(sec * 1000);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

/** Full human timestamp for detail views. */
export function absTime(sec: number): string {
    return new Date(sec * 1000).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ─── Date buckets (Today / Yesterday / This week / Earlier) ──────────────

export type Bucket = { label: string; entries: RestorePoint[] };

export function bucketize(history: RestorePoint[]): Bucket[] {
    const now = new Date();
    const startOfToday =
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const startOfYesterday = startOfToday - 86400;
    const startOfWeek = startOfToday - 86400 * 6;

    const today: RestorePoint[] = [];
    const yesterday: RestorePoint[] = [];
    const week: RestorePoint[] = [];
    const earlier: RestorePoint[] = [];

    for (const e of history) {
        if (e.timestamp_seconds >= startOfToday) today.push(e);
        else if (e.timestamp_seconds >= startOfYesterday) yesterday.push(e);
        else if (e.timestamp_seconds >= startOfWeek) week.push(e);
        else earlier.push(e);
    }

    const out: Bucket[] = [];
    if (today.length) out.push({ label: 'Today', entries: today });
    if (yesterday.length) out.push({ label: 'Yesterday', entries: yesterday });
    if (week.length) out.push({ label: 'This week', entries: week });
    if (earlier.length) out.push({ label: 'Earlier', entries: earlier });
    return out;
}

// ─── Selection / actions ─────────────────────────────────────────────────

export function selectionStateOf(id: string): 'none' | 'primary' | 'secondary' {
    if (vcs.primaryId === id) return 'primary';
    if (vcs.secondaryId === id) return 'secondary';
    return 'none';
}

/** Plain click → primary selection; ctrl/cmd/shift click → secondary. */
export async function selectEntry(ev: MouseEvent, entry: RestorePoint): Promise<void> {
    const additive = ev.metaKey || ev.ctrlKey || ev.shiftKey;
    (await vcs.selectPoint(entry.id, additive)).mapErr((err) =>
        toast.error(`History: ${err}`)
    );
}

/** Explicit "use as compare anchor" action (from buttons/menus). */
export async function useAsCompare(entry: RestorePoint): Promise<void> {
    if (!vcs.primaryId) {
        (await vcs.selectPoint(entry.id, false)).mapErr((err) =>
            toast.error(`History: ${err}`)
        );
        return;
    }
    if (vcs.primaryId === entry.id) {
        toast.info("That's already the anchor.");
        return;
    }
    (await vcs.selectPoint(entry.id, true)).mapErr((err) =>
        toast.error(`History: ${err}`)
    );
}

/** Select (if needed) and open the diff window. */
export function viewDiffFor(entry: RestorePoint, onopenDiff?: () => void): void {
    if (vcs.primaryId !== entry.id) {
        vcs.selectPoint(entry.id, false).mapErr((err) =>
            toast.error(`History: ${err}`)
        );
    }
    onopenDiff?.();
}

export async function restoreWithConfirm(entry: RestorePoint): Promise<void> {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(
        `Restore workspace to "${entry.message}" (${shortId(entry.id)})?\n\n` +
            "Your current state will be saved as a 'pre-restore' point you can " +
            'return to from this same timeline.',
        { title: 'Typwriter', kind: 'warning' }
    );
    if (!ok) return;
    const result = await vcs.restoreWorkspaceTo(entry.id);
    result.match(
        () => toast.success('Workspace restored.'),
        (err) => toast.error(`Restore failed: ${err}`)
    );
}

export function defaultRestoreLabel(): string {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `Checkpoint ${d.toLocaleDateString()} ${hh}:${mm}`;
}
