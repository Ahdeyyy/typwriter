# Phase 6 — Preview overlay: compile flow, lazy pages, pinch zoom

Goal: a full-screen preview the user opens deliberately. Opening it saves + compiles,
pages stream in lazily as you scroll, pinch zoom re-renders at a sharper scale, and the
whole thing costs nothing while hidden.

Depends on: phase 2 (`compile`, `previewimg://`), phase 4 (`editor.flush()`).

## Compile store — `stores/compile.svelte.ts`

```ts
type CompileStatus = "idle" | "compiling" | "ok" | "error";

class CompileStore {
  status = $state<CompileStatus>("idle");
  pages = $state<PageMeta[]>([]);
  errors = $state<Diagnostic[]>([]);
  warnings = $state<Diagnostic[]>([]);
  lastGeneration = 0;
  /** True when a save happened since the last successful compile. */
  stale = $state(true);

  /** Called by editor.flush() after every successful save. */
  onSaved() {
    this.stale = true;
    // Compile eagerly ONLY if the preview is currently open (background refresh
    // while reading). Otherwise wait until the user opens the preview.
    if (app.overlay === "preview") void this.run();
  }

  run(): ResultAsync<void, string>
  // status="compiling"; const res = await compile();
  // drop if res.generation < this.lastGeneration (stale response);
  // on document: pages=res.pages, stale=false, status = errors.length ? "error" : "ok"
  // on pages === null (failed compile): KEEP previous pages (last good render stays
  //   visible), set errors, status="error"
}
export const compileStore = new CompileStore();
```

Replace the phase-4 stub with this. Note the contrast with desktop: no events, no
worker queue — one async command, one generation check.

## Opening the preview

Top-bar `Eye` button →

```ts
async function openPreview() {
  app.openOverlay("preview");          // overlay opens immediately (skeleton)
  await editor.flush();                // persist current text
  if (compileStore.stale) await compileStore.run();
}
```

The overlay renders instantly with the previous pages (or skeletons on first open) and
swaps in fresh fingerprints when the compile lands — perceived latency is scroll-ready
immediately.

## Overlay — `components/preview/preview-overlay.svelte`

Full-screen fixed layer (`inset-0 z-50 bg-muted/95 backdrop-blur`), visible when
`app.overlay === "preview"`. Back gesture closes it (phase 3 history integration).

Top strip (h-12): back/`X` button, "Page N / M" indicator (from scroll position),
compile status chip (spinner while compiling; red `Warning` icon + error count when
`status === "error"` → tapping it opens the diagnostics drawer, phase 7), and a
re-compile button (`ArrowsClockwise`) for manual refresh.

Body: vertical `overflow-y-auto` scroller of pages, centered column, `gap-3 p-3`.

## Lazy page rendering — `components/preview/page-list.svelte` + `page.svelte`

Each page renders as a fixed-aspect placeholder that only mounts its `<img>` when near
the viewport:

```svelte
<!-- page.svelte — props: meta: PageMeta, bucket: number -->
<script lang="ts">
  let { meta, bucket } = $props();
  let host = $state<HTMLElement | null>(null);
  let visible = $state(false);
  $effect(() => {
    if (!host) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { visible = true; io.disconnect(); } },
      { rootMargin: "150% 0%" },     // pre-load ~1.5 screens ahead
    );
    io.observe(host);
    return () => io.disconnect();
  });
  const src = $derived(previewUrl(meta.fingerprint, bucket));
</script>

<div bind:this={host}
     class="w-full max-w-[820px] bg-white shadow-md"
     style:aspect-ratio={`${meta.widthPt} / ${meta.heightPt}`}>
  {#if visible}
    <img {src} alt="" class="block h-full w-full" loading="lazy" decoding="async"
         onerror={() => compileStore.stale && void compileStore.run()} />
  {/if}
</div>
```

`previewUrl(fp, bucket)` lives in `lib/preview-url.ts`:
`http://previewimg.localhost/{fp}-{bucket}.png` on Android/Windows,
`previewimg://localhost/{fp}-{bucket}.png` elsewhere (detect via
`navigator.userAgent.includes("Android")` || platform check from `@tauri-apps/plugin-os`
— desktop dev on Windows uses the http form too).

Because `src` is keyed by fingerprint, a recompile that changes page 3 swaps only page
3's URL; unchanged pages keep their URL and the webview serves them from HTTP cache
without touching Rust. The `onerror` handler covers the rare 404 from a
fingerprint/regeneration race by triggering one refresh.

Keep all pages' placeholders mounted (they're empty divs — cheap even for 100 pages);
only `<img>` elements are lazy. Page N/M indicator: an IntersectionObserver per page
with `threshold: 0.5` reporting its index to the overlay, or compute from scrollTop
against cumulative heights — either is fine.

## Pinch zoom

Two-layer approach — cheap CSS zoom while gesturing, re-render at a bucket after:

1. Wrap the page column in a container with a `scale` CSS var:
   `style:transform={`scale(${gestureScale})`}` with `transform-origin` at the pinch
   centroid.
2. Track `pointerdown/move/up` with two active pointers (or `touchmove` +
   `e.scale` where available); while pinching set `gestureScale` (clamp 0.5–4, no
   re-render).
3. On gesture end: `committedZoom = clamp(committedZoom * gestureScale, 0.5, 4)`;
   `gestureScale = 1`; map `committedZoom × devicePixelRatio` to the nearest scale
   bucket (1→1.0, 2→1.5, 3→2.0, 4→3.0); if the bucket changed, update `bucket`
   state — every visible page's `src` swaps to the new bucket URL (Rust renders on
   demand; already-seen buckets come from HTTP cache). Apply the residual zoom
   (committed vs. bucket ratio) via CSS width scaling of the page column.
4. Double-tap: toggle fit-width ↔ 2× at tap point.

Default bucket: from `settings.previewScaleBucket` (default 3 ≙ 2.0×, crisp on ~2.6dpr
phones at fit-width). Keep it simple — exact zoom math can be refined later; what's
fixed is the bucket contract with Rust.

## Tap-to-source (stretch, skip if time-constrained)

Desktop has bidirectional click↔source jump. Mobile v1 ships **without** it. If
implemented later: add a `jump_from_click(pageIndex, xPt, yPt)` command (port of desktop
`commands/click.rs` using `typst_ide::jump_from_click` with the last document), and a
tap handler converting tap coords → pt via the known page size. Update
`02-rust-core.md`'s contract table when doing so.

## Acceptance criteria

1. Cold flow on-device: edit → tap Eye → overlay appears instantly; first page image
   visible in well under a second for a small doc; status chip shows compile time
   sanity (log).
2. A 30+ page document: opening the preview renders only the first ~2 screens of pages
   (verify via Rust render logs); scrolling fast streams the rest without jank.
3. Edit one page's text → reopen preview → only the changed page re-renders (logs show
   one render; other pages load from HTTP cache).
4. Failed compile: previous pages remain visible; error chip shows count; fixing the
   error and recompiling recovers.
5. Pinch zoom in/out is smooth (CSS-only during gesture); after release, sharpness
   matches the zoom level (bucket re-render happened); zooming back out is instant
   (cached bucket).
6. Back gesture closes the overlay and returns to a still-focused editor; reopening the
   unchanged document does not recompile (`stale` is false) and paints purely from
   cache.
