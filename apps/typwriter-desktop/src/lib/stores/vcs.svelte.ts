// Reactive store for the version-history sidebar. Holds:
//   - the loaded list of restore points
//   - the currently selected point (for diff-vs-current view)
//   - the optional second selection (for diff-between-two view)
//   - the active diff payload + its loading state
//   - the page-level diff (which *pages* changed), which is asynchronous:
//     the backend has to compile the restore point to answer, so the store
//     tracks the outstanding request id and ignores results that arrive for
//     a selection the user has already moved past
//
// Convention follows the rest of the app: class-instance singleton so $state
// stays reactive across imports; IPC methods return ResultAsync so callers
// can chain or log without try/catch noise.

import { ResultAsync } from 'neverthrow';

import type { RestorePoint, WorkspaceDiff, FileDiff, PageDiffPayload } from '$lib/types';
import {
    triggerPreview,
    vcsCreateRestorePoint,
    vcsCurrentId,
    vcsDiffBetween,
    vcsDiffVsCurrent,
    vcsListHistory,
    vcsPageDiffCancel,
    vcsPageDiffRequest,
    vcsRestoreFile,
    vcsRestoreWorkspace
} from '$lib/ipc/commands';
import { editor } from './editor.svelte';
import { workspace } from './workspace.svelte';
import { closeDiffWindow } from '$lib/windows';
import { logError } from '$lib/logger';

class VcsStore {
    /** Newest first. Empty until the first [`refresh`] call resolves. */
    history = $state<RestorePoint[]>([]);

    /** Loading flag for the history list. */
    loading = $state(false);

    /** First selected restore point (anchor). When `secondaryId` is null the
     *  diff is "selected vs working tree"; when both are set, it's the diff
     *  between the two. */
    primaryId = $state<string | null>(null);
    secondaryId = $state<string | null>(null);

    /** Backend HEAD — the snapshot id the working tree currently matches.
     *  Used by the timeline to highlight the "you are here" point. Updated
     *  on `refresh()` and after every restore. `null` when the workspace
     *  has no snapshots yet. */
    currentId = $state<string | null>(null);

    /** Currently displayed diff payload (or null if nothing's selected yet). */
    diff = $state<WorkspaceDiff | null>(null);

    /** Loading flag for the diff payload. */
    diffLoading = $state(false);

    // ─── Page-level diff ─────────────────────────────────────────────────
    //
    // Requested explicitly (it costs a full compile of the restore point),
    // so it is *not* recomputed by `reloadDiff` — the Pages view asks for it
    // when the user opens it. Results arrive over events; `pageDiffRequestId`
    // is what makes a superseded result droppable.

    pageDiff = $state<PageDiffPayload | null>(null);
    pageDiffLoading = $state(false);
    pageDiffError = $state<string | null>(null);
    /** Id of the comparison we're still waiting for; `null` when idle. */
    pageDiffRequestId = $state<number | null>(null);

    /** Per-commit branch index derived from the parent_id graph. A commit
     *  inherits its parent's branch if it is the *oldest* child of that
     *  parent; later siblings (a fork off a non-tip commit) get a fresh
     *  branch index. Roots (no parent_id) each get their own branch.
     *
     *  Recomputed on history changes via `$derived` — cheap (linear in
     *  history size) and avoids stale state if the timeline mutates. */
    branchIndexById: Record<string, number> = $derived.by(() => {
        const map: Record<string, number> = {};
        // Walk oldest → newest so each parent sees its first-born first.
        const ascending = [...this.history].sort(
            (a, b) => a.timestamp_seconds - b.timestamp_seconds
        );
        // Track which parents already have an heir (the child that
        // inherits the branch color). Subsequent children fork.
        const heirClaimed = new Set<string>();
        let nextBranch = 0;
        for (const entry of ascending) {
            const parentId = entry.parent_id;
            if (parentId && map[parentId] !== undefined && !heirClaimed.has(parentId)) {
                map[entry.id] = map[parentId];
                heirClaimed.add(parentId);
            } else {
                map[entry.id] = nextBranch++;
            }
        }
        return map;
    });

    /** Maps a branch index to one of the eight VCS node CSS custom properties
     *  defined in layout.css. The variables adapt to light/dark mode and any
     *  active color-scheme preset, so the dots always look at home in the UI. */
    colorForBranch(index: number): string {
        return `var(--vcs-node-${index % 8})`;
    }

    /** Color for a given restore-point id, based on its branch in the
     *  parent_id graph. Falls back to a neutral gray for unknown ids. */
    colorForCommit(id: string): string {
        const idx = this.branchIndexById[id];
        if (idx === undefined) return 'hsl(0, 0%, 60%)';
        return this.colorForBranch(idx);
    }

    // ─── Loading ─────────────────────────────────────────────────────────

    refresh(limit?: number): ResultAsync<void, string> {
        this.loading = true;
        // Pull HEAD in parallel with the history list — both are cheap, and
        // we want the "you are here" highlight to land in the same paint as
        // the timeline so nodes don't visibly re-style on first mount.
        return vcsListHistory(limit)
            .map((entries) => {
                this.history = entries;
                // Reset selections if they no longer exist (e.g. after a
                // history rewrite — not currently possible, but cheap).
                const ids = new Set(entries.map((e) => e.id));
                if (this.primaryId && !ids.has(this.primaryId)) this.primaryId = null;
                if (this.secondaryId && !ids.has(this.secondaryId)) this.secondaryId = null;
            })
            .andThen(() => vcsCurrentId())
            .map((id) => {
                this.currentId = id;
                this.loading = false;
            })
            .mapErr((err) => {
                this.loading = false;
                logError('vcs: refresh failed:', err);
                return err;
            });
    }

    /** Returns the new commit id, or `null` if the working tree was identical
     *  to HEAD (the backend short-circuits in that case — nothing to commit).
     *  Callers should distinguish the two so the UI can tell the user nothing
     *  was created rather than falsely claiming success. */
    createRestorePoint(message: string): ResultAsync<string | null, string> {
        return vcsCreateRestorePoint(message)
            .andThen((id) => this.refresh().map(() => id))
            .mapErr((err) => {
                logError('vcs: createRestorePoint failed:', err);
                return err;
            });
    }

    // ─── Selection / diff ────────────────────────────────────────────────

    /** Select a restore point. With one selection we show "point vs current".
     *  Calling again with the same id clears the selection. Calling with a
     *  different id and the modifier flag adds it as the second selection
     *  for two-point comparison. */
    selectPoint(id: string, additive = false): ResultAsync<void, string> {
        if (additive && this.primaryId && this.primaryId !== id) {
            this.secondaryId = id;
            return this.reloadDiff();
        }
        if (this.primaryId === id && !additive) {
            this.primaryId = null;
            this.secondaryId = null;
            this.diff = null;
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        this.primaryId = id;
        this.secondaryId = null;
        return this.reloadDiff();
    }

    /** Set both anchors at once and recompute the diff in a single pass.
     *  Used by the standalone diff window, whose selection arrives whole
     *  (URL params on boot, `vcs:diff-selection` events afterwards) rather
     *  than through incremental clicks. */
    setSelection(primaryId: string | null, secondaryId: string | null): ResultAsync<void, string> {
        this.primaryId = primaryId;
        this.secondaryId = primaryId ? secondaryId : null;
        return this.reloadDiff();
    }

    /** Drop the second-anchor selection but keep the primary. */
    clearSecondary(): void {
        if (this.secondaryId == null) return;
        this.secondaryId = null;
        this.reloadDiff();
    }

    private reloadDiff(): ResultAsync<void, string> {
        // The page diff belongs to the *previous* selection and costs a
        // compile to recompute, so drop it rather than silently showing the
        // wrong pages. The Pages view re-requests when it needs one.
        //
        // With a selection still in play we only reset our own state: a
        // request may be moments away and must not race a cancel (see
        // `discardPageDiff`). With the selection cleared nothing more is
        // coming, so that is the moment to make the backend let go.
        if (this.primaryId == null) {
            this.releasePageDiff();
            this.diff = null;
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        this.discardPageDiff();
        this.diffLoading = true;
        const cmd = this.secondaryId
            ? vcsDiffBetween(this.primaryId, this.secondaryId)
            : vcsDiffVsCurrent(this.primaryId);
        return cmd
            .map((d) => {
                this.diff = d;
                this.diffLoading = false;
            })
            .mapErr((err) => {
                this.diffLoading = false;
                logError('vcs: diff failed:', err);
                return err;
            });
    }

    // ─── Page-level diff ─────────────────────────────────────────────────

    /** Ask the backend which pages changed for the current selection. Safe to
     *  call repeatedly — a new request supersedes the one in flight, and the
     *  worker drops the abandoned one at its next phase boundary. */
    requestPageDiff(): ResultAsync<void, string> {
        if (this.primaryId == null) {
            this.discardPageDiff();
            return ResultAsync.fromSafePromise(Promise.resolve());
        }
        this.pageDiff = null;
        this.pageDiffError = null;
        this.pageDiffLoading = true;
        return vcsPageDiffRequest(this.primaryId, this.secondaryId)
            .map((requestId) => {
                this.pageDiffRequestId = requestId;
            })
            .mapErr((err) => {
                this.pageDiffLoading = false;
                this.pageDiffRequestId = null;
                this.pageDiffError = err;
                logError('vcs: requestPageDiff failed:', err);
                return err;
            });
    }

    /** Apply a result from the worker, ignoring anything we no longer want. */
    applyPageDiff(payload: PageDiffPayload): void {
        if (payload.request_id !== this.pageDiffRequestId) return;
        this.pageDiff = payload;
        this.pageDiffError = null;
        this.pageDiffLoading = false;
        this.pageDiffRequestId = null;
    }

    /** Record a worker-side failure for the request we're waiting on. */
    applyPageDiffError(requestId: number, message: string): void {
        if (requestId !== this.pageDiffRequestId) return;
        this.pageDiff = null;
        this.pageDiffError = message;
        this.pageDiffLoading = false;
        this.pageDiffRequestId = null;
    }

    /** Forget the page diff on this side only.
     *
     *  Deliberately does *not* tell the backend to stop. `vcs_page_diff_cancel`
     *  and `vcs_page_diff_request` are both async commands with no relative
     *  ordering, so cancelling here — on the way to requesting a comparison for
     *  the new selection — could land *after* that request and kill it. A new
     *  request already supersedes the old one backend-side, which is the real
     *  cancellation; use [`releasePageDiff`] for the terminal case where
     *  nothing further will be asked for. */
    discardPageDiff(): void {
        this.pageDiff = null;
        this.pageDiffError = null;
        this.pageDiffLoading = false;
        this.pageDiffRequestId = null;
    }

    /** Forget the page diff *and* tell the backend to stand down: stop any
     *  compile still running and drop the laid-out documents it was holding
     *  for full-size page renders. Only safe where no request follows —
     *  clearing the selection, or tearing the window down. */
    releasePageDiff(): void {
        const hadWork = this.pageDiffRequestId !== null || this.pageDiff !== null;
        this.discardPageDiff();
        if (hadWork) {
            vcsPageDiffCancel().mapErr((err) =>
                logError('vcs: pageDiffCancel failed:', err)
            );
        }
    }

    // ─── Restore ─────────────────────────────────────────────────────────

    restoreWorkspaceTo(id: string): ResultAsync<void, string> {
        // Flush in-memory edits to disk first so the pre-restore safety
        // commit (created server-side) captures the user's actual current
        // state rather than what was last saved. Without this, unsaved
        // shadow edits would be silently discarded by the restore.
        return ResultAsync.fromSafePromise(editor.flushAllTabs())
            .andThen(() => vcsRestoreWorkspace(id))
            .andThen(() => this.refresh())
            .andThen(() =>
                // Working tree just changed under the editor. Re-read every
                // open tab from disk (dropping shadow buffers), refresh the
                // file tree in case files were added/removed, and kick a
                // recompile so the preview matches.
                ResultAsync.fromSafePromise(this.reloadAfterRestore())
            )
            .map(() => {
                // After restore, the working tree matches `id`. The diff
                // against current would now be empty — clear the selection
                // and tear down the diff window showing it.
                this.primaryId = null;
                this.secondaryId = null;
                this.diff = null;
                void closeDiffWindow();
            })
            .mapErr((err) => {
                logError('vcs: restoreWorkspaceTo failed:', err);
                return err;
            });
    }

    restoreSingleFile(id: string, path: string): ResultAsync<void, string> {
        return ResultAsync.fromSafePromise(editor.flushAllTabs())
            .andThen(() => vcsRestoreFile(id, path))
            .andThen(() => this.refresh())
            .andThen(() => ResultAsync.fromSafePromise(this.reloadAfterRestore()))
            .andThen(() => this.reloadDiff())
            .mapErr((err) => {
                logError('vcs: restoreSingleFile failed:', err);
                return err;
            });
    }

    /** Post-restore housekeeping. Failures here are non-fatal — the restore
     *  itself already succeeded on disk; the worst case is the UI looking
     *  stale until the user clicks around. */
    private async reloadAfterRestore(): Promise<void> {
        try {
            await editor.reloadAllTabsFromDisk();
        } catch (err) {
            logError('vcs: reloadAllTabsFromDisk failed:', err);
        }
        const treeResult = await workspace.refreshTree();
        treeResult.mapErr((err) => logError('vcs: refreshTree failed:', err));
        const previewResult = await triggerPreview('explicit');
        previewResult.mapErr((err) => logError('vcs: triggerPreview failed:', err));
    }

    // ─── Derived view helpers ────────────────────────────────────────────

    /** Look up a restore point by id. Linear scan — fine for human-scale
     *  history (we cap the UI list well below the painful threshold). */
    findById(id: string): RestorePoint | undefined {
        return this.history.find((r) => r.id === id);
    }

    /** All files touched in either of the currently-selected restore points
     *  (or, if only one is selected, that one). Used to render the diff
     *  list pane heading. */
    activeChangedFiles(): readonly FileDiff[] {
        return this.diff?.files ?? [];
    }

    destroy(): void {
        this.releasePageDiff();
        this.history = [];
        this.primaryId = null;
        this.secondaryId = null;
        this.currentId = null;
        this.diff = null;
    }
}

export const vcs = new VcsStore();
