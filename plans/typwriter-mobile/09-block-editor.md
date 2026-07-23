# Phase 9 — Notion-style block editor (real-render blocks)

Goal: a second editing surface on mobile that presents the document as a vertical
list of **blocks**, Notion-style. Inactive blocks display the block's **actual
compiled output** (cropped from the already-rendered preview pages — never a
styled approximation). Tapping a block flips it into a source mini-editor.
A slash-command menu inserts new blocks; a per-block menu converts block types.
The classic source editor stays; a toggle switches between the two surfaces.

Written 2026-07-23 against commit `988692f`. If the cited files have moved,
re-verify before executing.

## Product decisions (settled with the user — do not relitigate)

| Question | Decision |
|---|---|
| WYSIWYG approach | **Real compiled output only.** No fake/approximated styling of Typst source in the app's fonts. Inactive blocks show crops of the real rendered pages from the last compile. |
| Edit reveal | **Tap-to-edit.** Inactive blocks are read-only renders; tapping one switches that block to raw source in an editor. (Not the Obsidian cursor-reveals model.) |
| Scripting constructs | **Raw code blocks.** `#set`/`#show`/`#let`/`#import`/code exprs/raw fences render as monospace source chips, like Notion's code block. No smart form UIs in v1. |
| Relationship to source editor | **Toggle mode.** Blocks and classic source are two views over the same buffer; a top-bar toggle switches. Escape hatch for anything the block view handles poorly. |
| Block manipulation in v1 | **Slash-command insert menu + block convert menu.** No drag-reorder in v1 (revisit later). |
| Compile cadence | Unchanged. Mobile never compiles per keystroke (see memory: per-keystroke compile froze Android). Blocks refresh on the existing idle-save/blur/toggle compiles; between compiles, edited content is stale and shown as source. |

## Why this architecture is safe for Typst's scripting

The block model is a **partition of the source text**, not an AST re-serialization.
Every byte of the file belongs to exactly one block span, blocks are ordered, and
concatenating them reproduces the file byte-for-byte. Round-tripping is lossless
*by construction*, so a `#show` rule, a weird macro, or a construct the segmenter
doesn't understand can never be corrupted — worst case it lands in a "script"
block and renders as source. Cross-block semantic effects (a show rule restyling
everything after it) are handled for free because fragments come from the real
whole-document compile.

## Existing machinery to reuse

- `apps/typwriter-mobile/src-tauri/src/compiler.rs` — `CompileState` keeps the
  last successful `Arc<PagedDocument>` plus `page_lookup` (fingerprint → page
  index). `CompileResult` carries `generation` + `PageMeta { fingerprint,
  width_pt, height_pt }`.
- `apps/typwriter-mobile/src/lib/preview-url.ts` — page images are immutable
  PNGs at `previewimg://…/{fingerprint}-{bucket}.png`, absorbed by the webview
  HTTP cache. **Block fragments are CSS crops of these same images — no new
  rasterization path.**
- `apps/typwriter-desktop/src-tauri/src/commands/click.rs` — `for_each_glyph`
  walks a `Frame` recursively reporting `(Span, offset, origin, advance, size)`
  per glyph. Adapt this for span→extent mapping (also covering
  `FrameItem::Shape`/`FrameItem::Image`, which carry spans directly).
  Heed the lessons in memory note *cursor-sync-page-selection*: one source span
  can appear on many pages.
- `apps/typwriter-mobile/src/lib/editor/typst-lang/` — the hand-written lezer
  parser; its tree drives block segmentation (incremental reparse is cheap).
- `apps/typwriter-mobile/src/lib/editor/completion-controller.svelte.ts` +
  `completion-logic.ts` — reuse the anchoring/filtering machinery for the slash
  menu.
- `apps/typwriter-mobile/src/lib/editor/insert.ts` — line-prefix/wrap helpers;
  the convert menu generalizes these into span rewrites.
- `apps/typwriter-mobile/src/lib/stores/editor.svelte.ts` — owns the buffer,
  save/flush flow, and the single CodeMirror `view`. The block surface must go
  through this store so save/compile/diagnostics keep working unmodified.

## Architecture

### 1. Block model — `src/lib/blocks/segment.ts`

```ts
export type BlockKind =
  | "heading"     // = / == / === … line
  | "paragraph"   // contiguous markup lines between parbreaks
  | "list"        // contiguous -, +, or n. items (one block per contiguous run)
  | "math"        // block math  $ … $  (multiline or spaced form)
  | "raw"         // ``` fenced raw block
  | "script"      // top-level #set/#show/#let/#import/#include/code expr
  | "blank";      // run of blank lines / trailing whitespace (renders as gap)

export interface Block {
  id: string;      // stable across edits (see below)
  kind: BlockKind;
  from: number;    // byte offsets into the master doc; [from, to) spans
  to: number;      //   partition the file: sorted, non-overlapping, gap-free
}

export function segment(tree: Tree, doc: Text): Block[];
```

Segmentation rules:

- Split at **top-level parbreaks** (blank lines) and at kind boundaries.
- A multi-line construct (fenced raw, block math, a `#let` with a code block,
  a content block `#[ … ]` spanning lines) is **one block** — the lezer tree
  gives the enclosing node's extent; never split inside a node.
- Anything starting with `#` at top level, or that the parser flags as code,
  is `script`. When in doubt → `script`. Unknown/broken syntax → `script`.
- `blank` blocks own the parbreak whitespace so the partition stays gap-free;
  the UI renders them as inter-block spacing, not as visible blocks.

**Stable ids:** on re-segmentation, match new blocks to old by (kind, content
hash) first, then by order among unmatched. Ids keep Svelte keyed-each state
(active block, scroll position) stable while typing.

**Invariants (bun test these):** blocks sorted, non-overlapping, gap-free,
`concat(blocks) === doc`; segmenting twice is idempotent; an edit inside one
block changes only that block's span (plus offsets after it).

### 2. Rust command — `block_extents`

New command in `apps/typwriter-mobile/src-tauri/src/commands/compile.rs` (or a
sibling `blocks.rs`):

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSpanReq { pub id: String, pub from: usize, pub to: usize } // byte offsets in main source

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockExtent { pub page: usize, pub y0_pt: f64, pub y1_pt: f64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockExtentsResult {
    pub generation: u64,                              // which compile this maps
    pub blocks: Vec<(String, Vec<BlockExtent>)>,      // id -> extents (may be empty)
}

#[tauri::command]
pub async fn block_extents(spans: Vec<BlockSpanReq>, ...) -> Result<BlockExtentsResult, String>
```

Implementation:

- Take the `Arc<PagedDocument>` from `CompileState`; record the generation it
  belongs to (store the generation alongside the document when the compile
  lands, so the pair is atomic).
- Walk every page frame once (adapt `for_each_glyph`, extended to report
  `FrameItem::Shape` and `FrameItem::Image` spans and each item's bounding
  box, not just glyph origins). For each item, resolve its `Span` to a byte
  range in the **main** source via `WorldExt::range`; skip spans from other
  files/packages.
- Bucket each item into the requested block whose `[from, to)` contains the
  range start. Accumulate per (block, page) a min/max y. Pad y0/y1 by a small
  margin (~2 pt) so ascenders/descenders aren't clipped.
- Sort each block's extents by page then y0; merge extents on the same page
  that overlap or nearly touch (< ~6 pt gap).
- Multi-page blocks naturally yield multiple extents (the UI stacks crops).
- Blocks with **no** rendered items (set rules, lets, comments) return an empty
  extent list — the UI shows them as code chips, which they'd be anyway.
- Async command (memory: *mobile-main-thread-blocking-commands* — never block
  the main thread). A full-frame walk over a large doc is fine off-thread; if
  it ever shows up in profiles, cache the span→extent index per generation.
- Unit-test with a `TestWorld` like `click.rs`'s: compile a small doc, assert a
  heading block maps to page 0 with sane y bounds, a two-page paragraph yields
  two extents, and a `#set` block yields none.

### 3. Fragment rendering — `src/lib/components/blocks/block-fragment.svelte`

A block fragment is a stack of crops. Each crop:

```svelte
<div class="overflow-hidden" style:height="{(y1 - y0) * scale}px">
  <img src={previewUrl(page.fingerprint, bucket)}
       style:width="{page.widthPt * scale}px"
       style:transform="translateY(-{y0 * scale}px)" />
</div>
```

- `scale` = block-list content width / `page.widthPt` — fragments fill the
  column width, giving the Notion "canvas" feel regardless of paper size.
- The `<img>` URLs are the same fingerprints the preview overlay uses, so the
  HTTP cache means zero extra IPC/render for docs you've previewed; unseen
  fingerprints load lazily like the preview's pages do.
- Lazy-load off-screen fragments (`loading="lazy"` + an IntersectionObserver
  fallback if needed). Virtualize the block list only if profiling demands it —
  crops are cheap DOM.

### 4. Stale model + refresh loop — `src/lib/stores/blocks.svelte.ts`

```ts
class BlockStore {
  blocks = $state<Block[]>([]);            // re-derived from editor doc changes
  extents = $state<Map<string, BlockExtent[]>>(new Map());
  extentsGeneration = 0;                   // compile generation extents map to
  dirty = $state<Set<string>>(new Set());  // block ids edited since extentsGeneration
  activeId = $state<string | null>(null);
}
```

- On every master-doc change: re-segment, diff ids, add changed ids to `dirty`.
  **Any** edit also potentially reflows later blocks (show rules, page breaks),
  but their *content* is still last-compile-truthful, so v1 policy: only the
  edited blocks are marked dirty; all fragments swap wholesale when the next
  compile lands. (Extents + fingerprints refresh together, so post-edit blocks
  are never *wrongly* cropped — just up to one compile old, exactly like the
  preview overlay today.)
- When a compile lands (hook the existing `compileStore.run()` success path):
  call `block_extents` with the current segmentation, verify the returned
  `generation` matches the compile's, then atomically replace `extents`, clear
  `dirty`, and set `extentsGeneration`.
- Rendering rule per block: `script`/`raw`/extent-less → code chip (monospace
  source, tinted background). Dirty, or no extents yet (never-compiled doc) →
  source text with a subtle "pending compile" shimmer/badge. Otherwise →
  fragment crops.
- Blocks whose span renders in *multiple* places (e.g. content reused by a show
  rule) get all matching extents merged per §2's rules; if that ever looks
  wrong in practice, prefer the first occurrence in page order (lesson from the
  cursor-sync page-selection work).

### 5. Active block editing — `src/lib/components/blocks/block-editor.svelte`

**One shared CodeMirror instance**, remounted into whichever block is active —
never one CM per block (Android IME + memory cost; see memory notes).

- Tap an inactive block → `blockStore.activeId = id`; mount the shared CM into
  the block's slot, seeded with `doc.sliceString(from, to)`, with the same
  typst-lang/theme/completion extensions the classic editor uses.
- While active, edits stay local to the mini-editor. On **commit** (tap outside,
  toggle to another block, back button, view toggle, or the idle-save timer
  firing) splice the mini-doc back into the master buffer via the editor
  store (`view` transaction or string splice + `loadDocInto`-style programmatic
  update), then re-segment. Splicing on commit — not per keystroke — keeps the
  segmentation/diff loop out of the hot typing path.
- The existing idle-save → compile pipeline then runs untouched: commit feeds
  save, save feeds compile, compile refreshes fragments.
- Enter behavior inside an active paragraph: a blank line simply becomes a
  parbreak on commit, splitting the block naturally via re-segmentation. No
  special "split block" command needed in v1.
- Undo: CM's history covers the active block while it's mounted. Cross-block
  undo in v1 = the classic source editor's history after commits (keep a small
  ring of pre-commit snapshots in the editor store; wire a toolbar undo that
  restores the last snapshot). Full block-aware undo is out of scope.
- Diagnostics: reuse `inline-diagnostics.ts` inside the active block by
  offsetting compile diagnostics into block-local coordinates; inactive blocks
  with diagnostics get a red/yellow dot in the block gutter.

### 6. Slash-command insert menu

- In an **empty active block** (or via a `+` button between blocks), typing `/`
  opens the insert menu, anchored like the completion popup (reuse
  `completion-controller` positioning/filtering).
- Items insert Typst source templates: Heading 1–3 (`= `), bullet/numbered list
  (`- ` / `+ `), block math (`$ … $`), raw fence, quote (`#quote[…]`), image
  (`#image("")`), table (`#table(columns: …)`), figure, code (`#{ }`), divider
  (`#line(length: 100%)`).
- Selecting an item replaces the `/query` text with the template and places the
  caret via the same snippet flattening used by completions.

### 7. Block convert menu

- Per-block overflow menu (long-press or `⋯` affordance — reuse
  `actions/longpress.ts`) with: Turn into → Heading 1/2/3, Paragraph, Bullet
  list, Numbered list, Quote; plus Delete block, Duplicate block.
- Conversions are pure text rewrites of the block span: strip the current
  line-prefixes, apply the new ones (generalize `insertLinePrefix`).
  Paragraph→list applies `- ` per line; list→paragraph strips markers;
  →quote wraps in `#quote[ … ]`. Convert of a `script` block is disabled
  except Delete/Duplicate.
- Every conversion goes through the same commit path as editing (splice →
  re-segment → dirty), so undo snapshots cover it.

### 8. Mode toggle

- `settings.svelte.ts`: `editorSurface: "source" | "blocks"` (persisted).
- Top bar gets a toggle next to the existing preview button. Switching surfaces
  commits any active block first, then flips; both surfaces read/write the same
  editor-store buffer, so nothing else changes.
- Non-text files and files with parse-crash pathologies fall back to source
  surface automatically.

## Risks / accepted limitations (v1)

- **Freshness**: fragments are one compile behind by design (mobile compile
  cadence). Mitigated by dirty-block source display + shimmer.
- **Vertical-extent cropping is approximate**: side-by-side layouts (grids,
  floats, margin notes) will crop neighbors into a block's fragment. Accepted;
  y-only crops keep v1 simple. If ugly in practice, clamp x too (extents
  already computable per item).
- **Headers/footers/page numbers** may fall inside a crop's y-range. Accepted
  for v1; excluding them needs frame-role info — note as follow-up.
- **Content blocks spanning parbreaks** (`#[ … ]` with blank lines) are one big
  block — correct but chunky. Fine.
- **No drag-reorder** in v1 (explicit user decision); the block model makes it
  a trivial future addition (splice two spans).

## Milestones (land separately, each shippable)

| # | Milestone | Contents | Effort |
|---|-----------|----------|--------|
| 9a | Segmentation + surface shell | `segment.ts` + invariant tests, `BlockStore`, read-only block list showing source text with block chrome, mode toggle | M |
| 9b | Real fragments | `block_extents` command + Rust tests, fragment crops, stale/dirty handling, compile-hook refresh | M–L |
| 9c | Editing | shared-CM active block, commit/splice loop, undo snapshots, per-block diagnostics | M |
| 9d | Block UX | slash insert menu, convert/overflow menu, empty-doc "+" affordance, polish (transitions, lazy fragment loading) | M |

Sequencing note: 9a/9b prove the risky span→extent mapping before any editing
complexity lands. If 9b's extents turn out unusable for real documents, the
fallback position (block chrome over source text, per 9a) is still a shippable
improvement — decide before starting 9c.
