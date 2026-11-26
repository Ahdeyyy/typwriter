// Fixing the links a rename or move breaks.
//
// After a file or folder moves, `plan_link_updates` (Rust) finds the path
// literals that now point nowhere — `#include`, `#import`, `#image`,
// `#bibliography`, … in other files, and the moved file's own relative
// paths — and says what each should read instead. This store decides what
// happens with that plan, per `settings.linkUpdateMode`:
//
//   always  apply it, with an Undo toast   (default)
//   ask     show it in a review dialog first
//   never   drop it
//
// Renames made *outside* the app (file manager, git) are never applied on
// their own — a `git mv` may well have fixed the links already — they only
// raise a prompt.
//
// Open tabs are patched through the editor, never behind its back on disk:
// that keeps unsaved work, keeps the edit undoable, and lets a clean tab save
// itself straight after. Everything else is written by Rust in one batch that
// becomes one restore point. Nothing here runs except after a move.

import { toast } from 'svelte-sonner';
import { applyLinkUpdates, planLinkUpdates } from '#lib/ipc/commands.ts';
import {
    describeLinkCount,
    invertLinkUpdates,
    type FileLinkUpdate,
    type PathMove,
} from '#lib/link-updates.ts';
import { basename } from '#lib/paths.ts';
import { logError } from '#lib/logger.ts';
import { editor } from './editor.svelte';
import { settings } from './settings.svelte';
import { workspace } from './workspace.svelte';

export interface LinkReview {
    moves: PathMove[];
    updates: FileLinkUpdate[];
    /** What moved, for the dialog and the restore point: `ch1.typ → intro.typ`. */
    label: string;
}

interface ApplyResult {
    applied: FileLinkUpdate[];
    skipped: string[];
}

const EXTERNAL_TOAST_ID = 'link-updates:external';

/** `a.typ → b.typ`, or `chapters → book/chapters` for a move. */
export function describeMove(move: PathMove): string {
    const sameDir =
        move.from.slice(0, move.from.lastIndexOf('/') + 1) ===
        move.to.slice(0, move.to.lastIndexOf('/') + 1);
    return `${basename(move.from)} → ${sameDir ? basename(move.to) : move.to}`;
}

class LinkUpdateStore {
    /** The plan waiting in the review dialog (Ask mode). */
    review = $state<LinkReview | null>(null);

    /** External moves the open prompt covers. They accumulate while it is up,
     *  so a folder rename reported in several watcher batches is one prompt. */
    private _externalMoves: PathMove[] = [];
    /** Plans, applies and undos run one at a time: each reads what the one
     *  before it wrote. */
    private _queue: Promise<void> = Promise.resolve();

    private _enqueue(task: () => Promise<void>): Promise<void> {
        const run = this._queue.then(task).catch((err) => {
            logError('link updates failed:', err);
            toast.error(`Couldn't update links: ${err}`);
        });
        this._queue = run;
        return run;
    }

    /** A rename or move made in the app has just finished. */
    afterMove(moves: PathMove[]): Promise<void> {
        // The prompt was about the layout before this move; its plan is stale.
        this._dropExternalPrompt();
        if (settings.linkUpdateMode === 'never' || workspace.isStandalone) {
            return Promise.resolve();
        }
        return this._enqueue(async () => {
            // A second move while the review is open joins it, so neither
            // move's links are lost when the user answers.
            const all = this.review ? [...this.review.moves, ...moves] : moves;
            const updates = await this._plan(all);
            if (updates.length === 0) {
                this.review = null;
                return;
            }
            const label = all.map(describeMove).join(', ');
            if (settings.linkUpdateMode === 'ask') {
                this.review = { moves: all, updates, label };
                return;
            }
            this._report(await this._apply(updates, `Updated links after ${label}`));
        });
    }

    /** The user accepted the review. Re-planned first: the dialog may have
     *  been open while files changed. */
    confirmReview(): Promise<void> {
        const review = this.review;
        this.review = null;
        if (!review) return Promise.resolve();
        return this._enqueue(async () => {
            const updates = await this._plan(review.moves);
            if (updates.length === 0) return;
            this._report(await this._apply(updates, `Updated links after ${review.label}`));
        });
    }

    dismissReview(): void {
        this.review = null;
    }

    /** Something outside the app renamed or moved files in the workspace. */
    afterExternalMoves(moves: PathMove[]): Promise<void> {
        if (moves.length === 0 || settings.linkUpdateMode === 'never' || workspace.isStandalone) {
            return Promise.resolve();
        }
        this._externalMoves.push(...moves);
        const all = [...this._externalMoves];
        return this._enqueue(async () => {
            const updates = await this._plan(all);
            // Another batch arrived, or the prompt went away, meanwhile.
            if (this._externalMoves.length !== all.length) return;
            if (updates.length === 0) {
                this._dropExternalPrompt();
                return;
            }
            const title =
                all.length === 1
                    ? `${basename(all[0].from)} was moved outside Typwriter`
                    : 'Files were moved outside Typwriter';
            toast.info(title, {
                id: EXTERNAL_TOAST_ID,
                description: `Update ${describeLinkCount(updates)} that pointed to the old location?`,
                duration: 20_000,
                action: {
                    label: 'Update links',
                    onClick: () => {
                        const moves = [...this._externalMoves];
                        this._externalMoves = [];
                        void this._enqueue(async () => {
                            const fresh = await this._plan(moves);
                            if (fresh.length === 0) return;
                            const label = moves.map(describeMove).join(', ');
                            this._report(await this._apply(fresh, `Updated links after ${label}`));
                        });
                    },
                },
                onDismiss: () => {
                    this._externalMoves = [];
                },
                onAutoClose: () => {
                    this._externalMoves = [];
                },
            });
        });
    }

    private _dropExternalPrompt(): void {
        if (this._externalMoves.length === 0) return;
        this._externalMoves = [];
        toast.dismiss(EXTERNAL_TOAST_ID);
    }

    private async _plan(moves: PathMove[]): Promise<FileLinkUpdate[]> {
        const result = await planLinkUpdates(moves, editor.linkBuffers());
        if (result.isErr()) throw new Error(result.error);
        return result.value;
    }

    /** Patch open tabs through the editor, write the rest through Rust. */
    private async _apply(updates: FileLinkUpdate[], message: string): Promise<ApplyResult> {
        const applied: FileLinkUpdate[] = [];
        const skipped: string[] = [];
        const onDisk: FileLinkUpdate[] = [];
        const toSave: string[] = [];

        for (const update of updates) {
            const tab = editor.linkTab(update.path);
            if (!tab) {
                onDisk.push(update);
                continue;
            }
            const wasClean = !tab.hasUnsavedChanges;
            if (editor.applyLinkEdits(update.path, update.edits)) {
                applied.push(update);
                // A clean tab mirrors disk; saving now keeps it that way, like
                // the files written below. A dirty one stays dirty — its edits
                // ride along with whatever the user saves next.
                if (wasClean) toSave.push(tab.id);
            } else {
                skipped.push(update.path);
            }
        }

        if (onDisk.length > 0) {
            const result = await applyLinkUpdates(onDisk, message);
            if (result.isErr()) throw new Error(result.error);
            const written = new Set(result.value.applied);
            applied.push(...onDisk.filter((u) => written.has(u.path)));
            skipped.push(...result.value.skipped);
        }

        await Promise.all(
            toSave.map((id) =>
                editor.flushTab(id).catch((err) => logError('saving a link-updated tab failed:', err))
            )
        );
        return { applied, skipped };
    }

    private _report(result: ApplyResult, undoable = true): void {
        if (result.applied.length > 0) {
            const applied = result.applied;
            toast.success(`Updated ${describeLinkCount(applied)}`, {
                action: undoable
                    ? { label: 'Undo', onClick: () => void this._undo(applied) }
                    : undefined,
            });
        }
        if (result.skipped.length > 0) {
            const n = result.skipped.length;
            toast.warning(
                `Left links in ${n} file${n === 1 ? '' : 's'} unchanged`,
                { description: `Changed while updating: ${result.skipped.join(', ')}` }
            );
        }
    }

    private _undo(applied: FileLinkUpdate[]): Promise<void> {
        return this._enqueue(async () => {
            const result = await this._apply(invertLinkUpdates(applied), 'Reverted link updates');
            if (result.applied.length > 0) {
                toast.success(`Restored ${describeLinkCount(result.applied)}`);
            }
            this._report({ applied: [], skipped: result.skipped }, false);
        });
    }
}

export const linkUpdates = new LinkUpdateStore();
