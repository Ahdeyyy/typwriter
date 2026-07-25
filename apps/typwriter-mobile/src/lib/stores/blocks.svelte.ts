// State for the Notion-style block surface.
//
// The store owns the master document's block partition, the per-block render
// extents from the last compile, and which block is being edited. It is the
// only writer of block edits into the editor store: a block's mini-editor
// keeps its changes local until they're **committed**, at which point the
// spliced document goes through `editor.replaceText` and the ordinary
// save → compile → refresh pipeline runs.

import { ResultAsync, okAsync } from "neverthrow";
import { segment, type Block } from "$lib/blocks/segment";
import { convert, type ConversionId } from "$lib/blocks/convert";
import * as ipc from "$lib/ipc/commands";
import type { BlockExtent } from "$lib/ipc/types";
import { editor } from "./editor.svelte";
import { compileStore } from "./compile.svelte";

class BlockStore {
  blocks = $state<Block[]>([]);
  /** block id -> the bands it renders into, from compile `extentsGeneration`. */
  extents = $state<Map<string, BlockExtent[]>>(new Map());
  /** Compile the current `extents` describe; 0 before anything has compiled. */
  extentsGeneration = $state(0);
  /** Blocks edited since `extentsGeneration` — shown as source until the next
   *  refresh, because their last render no longer matches their text. */
  dirtyIds = $state<Set<string>>(new Set());
  activeId = $state<string | null>(null);
  refreshing = $state(false);
  /** Non-null while the active block holds nothing but a `/query` — the
   *  insert menu is open, filtered by it. */
  slashQuery = $state<string | null>(null);

  /** The master document the current segmentation describes. */
  doc = $state("");

  /** Set by the mounted mini-editor: reads its live text so a commit can be
   *  triggered from anywhere (tapping another block, toggling surface). */
  private activeText: (() => string) | null = null;
  /** Bumped by every document mutation. A refresh that finishes against an
   *  older value describes text that no longer exists, so it re-runs. */
  private editSeq = 0;

  /** Adopt `text` as a fresh document (surface mount, file switch). Drops all
   *  per-block state — ids from another file must never be reused. */
  load(text: string) {
    this.doc = text;
    this.blocks = segment(text);
    this.extents = new Map();
    this.extentsGeneration = 0;
    this.dirtyIds = new Set();
    this.activeId = null;
    this.activeText = null;
  }

  /** The block's source text, without the trailing whitespace its span owns. */
  textOf(block: Block): string {
    return this.doc.slice(block.from, block.contentTo);
  }

  /** Whether `block` should be drawn from its source rather than its render. */
  isStale(block: Block): boolean {
    return this.dirtyIds.has(block.id) || this.extentsGeneration === 0;
  }

  extentsOf(block: Block): BlockExtent[] {
    return this.extents.get(block.id) ?? [];
  }

  // ─── Activation / commit ──────────────────────────────────────────────────

  /** Register the mini-editor's live-text reader for the active block. */
  bindActiveText(read: () => string) {
    this.activeText = read;
  }

  /** Open `id` for editing, committing whichever block was open before. */
  activate(id: string) {
    if (this.activeId === id) return;
    this.commitActive();
    this.activeId = id;
  }

  /** Close the active block, splicing its text back into the document. */
  commitActive(): void {
    const id = this.activeId;
    const read = this.activeText;
    this.activeId = null;
    this.activeText = null;
    if (!id || !read) return;
    this.commit(id, read());
  }

  /**
   * Splice `text` in as block `id`'s content and re-segment. The block's
   * trailing whitespace is preserved so the surrounding spacing survives an
   * edit; everything outside the block is untouched, which is what makes the
   * round-trip lossless.
   */
  commit(id: string, text: string) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block) return;
    if (text === this.textOf(block)) return;

    const next =
      this.doc.slice(0, block.from) + text + this.doc.slice(block.contentTo);
    this.dirtyIds = new Set(this.dirtyIds).add(id);
    this.apply(next);
  }

  /** Adopt an edited document: re-segment, hand it to the editor store, and
   *  kick off the refresh that brings the fragments back in sync. */
  private apply(next: string) {
    this.editSeq++;
    this.doc = next;
    this.blocks = segment(next, this.blocks);
    editor.replaceText(next);
    void this.refresh();
  }

  /** Replace the active block's `/query` with a template and keep editing it. */
  insertTemplate(text: string) {
    const id = this.activeId;
    this.slashQuery = null;
    const block = this.blocks.find((b) => b.id === id);
    if (!id || !block) return;

    const from = block.from;
    this.activeId = null;
    this.activeText = null;
    this.commit(id, text);
    // The rewritten block still starts where it did; re-open it so the caret
    // lands inside the freshly inserted template.
    const next = this.blocks.find((b) => b.from === from);
    if (next) this.activeId = next.id;
  }

  /** Turn a block into another kind — a pure rewrite of its own span. */
  convertBlock(target: Block, id: ConversionId) {
    const block = this.settle(target);
    if (!block) return;
    this.commit(block.id, convert(this.textOf(block), id));
  }

  /** Commit any in-progress edit, then re-resolve `block` — committing
   *  re-segments, which shifts the spans of everything after the edit. */
  private settle(block: Block): Block | undefined {
    this.commitActive();
    return this.blocks.find((b) => b.id === block.id);
  }

  /** Insert `text` as a new block after `block`, and open it for editing. */
  insertAfter(target: Block, text: string) {
    const block = this.settle(target);
    if (!block) return;
    const at = block.to;
    // The span already ends in a parbreak unless the block runs straight into
    // the next one (or the end of file).
    const separator = this.doc.slice(block.contentTo, block.to).includes("\n\n")
      ? ""
      : "\n\n";
    this.apply(
      this.doc.slice(0, at) + separator + text + "\n\n" + this.doc.slice(at),
    );

    // Re-segmentation puts the new block's first character exactly where we
    // wrote it; open it so the user can type straight into it.
    const inserted = this.blocks.find((b) => b.from === at + separator.length);
    if (inserted) {
      this.dirtyIds = new Set(this.dirtyIds).add(inserted.id);
      this.activeId = inserted.id;
    }
  }

  /** Remove a block (its span, spacing included) from the document. */
  remove(target: Block) {
    // Deleting the block being edited throws that edit away — that's the
    // point — so drop the mini-editor's text instead of committing it.
    if (this.activeId === target.id) {
      this.activeId = null;
      this.activeText = null;
    }
    const block = this.settle(target);
    if (!block) return;
    this.apply(this.doc.slice(0, block.from) + this.doc.slice(block.to));
  }

  /** Duplicate a block directly below itself. */
  duplicate(target: Block) {
    const block = this.settle(target);
    if (!block) return;
    const text = this.textOf(block);
    this.apply(
      this.doc.slice(0, block.to) + text + "\n\n" + this.doc.slice(block.to),
    );
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  /**
   * Bring the fragments up to date: persist the buffer, compile it if the
   * render is stale, then map the current spans onto the fresh pages.
   *
   * The steps are chained deliberately. Extents are byte offsets into the
   * *compiled* source, so asking for them before the compile catches up would
   * crop every block after an edit against the wrong text.
   */
  refresh(): ResultAsync<void, string> {
    if (this.refreshing) return okAsync(undefined);
    this.refreshing = true;
    const seq = this.editSeq;
    const spans = this.blocks.map((b) => ({
      id: b.id,
      from: b.from,
      to: b.to,
    }));
    return editor
      .flush()
      .andThen(() =>
        compileStore.stale ? compileStore.run() : okAsync(undefined),
      )
      .andThen(() => ipc.blockExtents(spans))
      .map((res) => {
        this.refreshing = false;
        // An edit landed while this was in flight (its own refresh was
        // suppressed by the guard above): these extents describe text that no
        // longer exists, so run the chain again instead of cropping by them.
        if (seq !== this.editSeq) {
          void this.refresh();
          return;
        }
        // Generation 0 means nothing has compiled yet — keep showing source.
        if (res.generation === 0) return;
        this.extents = new Map(res.blocks);
        this.extentsGeneration = res.generation;
        this.dirtyIds = new Set();
      })
      .mapErr((e) => {
        this.refreshing = false;
        return e;
      });
  }
}

export const blocks = new BlockStore();
