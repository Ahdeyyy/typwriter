<script lang="ts">
  // The toolbar's second mode: caret placement and selection by button and
  // gesture instead of by fingertip. See lib/editor/selection.ts for why.
  //
  // Three ways to move, in increasing order of how far you are going:
  //
  //   * tap an arrow — exactly one character or line;
  //   * hold an arrow — the same step on repeat, accelerating;
  //   * drag the grip — a trackpad: horizontal for characters, vertical for
  //     lines, both at once. This is the one that makes long selections
  //     bearable, because the finger is nowhere near the text it is selecting.
  //
  // The Select toggle turns all three into selection tools by extending from the
  // anchor instead of moving the caret, so a selection is built the same way it
  // is navigated. Nothing here is obscured by the hand doing it.

  import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    ArrowUp01Icon,
    ArrowDown01Icon,
    ArrowLeftDoubleIcon,
    ArrowRightDoubleIcon,
    ArrowLeftToLineIcon,
    ArrowRightToLineIcon,
    ArrowAllDirectionIcon,
    CursorRectangleSelection01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import type { EditorView } from "@codemirror/view";
  import Icon from "$lib/components/icon.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import {
    step,
    selectWordAtCursor,
    selectCurrentLine,
    selectWholeDoc,
    collapseSelection,
    type Step,
  } from "$lib/editor/selection";

  /** Extend-from-anchor mode: arrows and the grip drag the selection's head. */
  let extend = $state(false);

  // Turning Select on with a bare caret has nothing to extend from yet, which is
  // fine — the anchor is wherever the caret is. Turning it off is a decision to
  // stop selecting, so drop the range rather than leave one stranded on screen
  // with no visible way to dismiss it.
  function toggleExtend() {
    extend = !extend;
    if (!extend && editor.view) collapseSelection(editor.view);
    editor.view?.focus();
  }

  function run(fn: (v: EditorView) => boolean) {
    const view = editor.view;
    if (!view) return;
    fn(view);
    view.focus();
  }

  // ── Press and hold ────────────────────────────────────────────────────────
  // First repeat is slow enough that a normal tap never triggers one, then it
  // accelerates: holding is how you cross a line, and one step per 200 ms would
  // make that slower than just tapping.
  const HOLD_DELAY_MS = 400;
  const HOLD_INTERVAL_MS = [110, 110, 70, 70, 45];

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdCount = 0;

  function startHold(dir: Step) {
    stopHold();
    holdCount = 0;
    const tick = () => {
      const view = editor.view;
      // Stop at the ends of the document instead of firing uselessly until the
      // finger lifts.
      if (!view || !step(view, dir, extend)) return stopHold();
      holdCount++;
      const interval = HOLD_INTERVAL_MS[Math.min(holdCount, HOLD_INTERVAL_MS.length - 1)];
      holdTimer = setTimeout(tick, interval);
    };
    holdTimer = setTimeout(tick, HOLD_DELAY_MS);
  }

  function stopHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  // ── Grip scrubbing ────────────────────────────────────────────────────────
  // Distance per step. Roughly a fingertip's width, so a deliberate nudge moves
  // one character and a sweep crosses a line without the caret feeling twitchy.
  const SCRUB_CHAR_PX = 11;
  const SCRUB_LINE_PX = 26;

  let scrubbing = false;
  let scrubX = 0;
  let scrubY = 0;

  function scrubStart(e: PointerEvent) {
    // Capture so the gesture survives the finger sliding off the grip — which it
    // will, since the grip is one button wide and the drags are not.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubbing = true;
    scrubX = e.clientX;
    scrubY = e.clientY;
    editor.view?.focus();
  }

  function scrubMove(e: PointerEvent) {
    const view = editor.view;
    if (!scrubbing || !view) return;
    // Consume the drag in whole steps and carry the remainder, so slow drags
    // accumulate into a step instead of being rounded away and fast ones don't
    // lose the distance between frames.
    scrubX += drain(e.clientX - scrubX, SCRUB_CHAR_PX, (dir) =>
      step(view, dir > 0 ? "charRight" : "charLeft", extend),
    );
    scrubY += drain(e.clientY - scrubY, SCRUB_LINE_PX, (dir) =>
      step(view, dir > 0 ? "lineDown" : "lineUp", extend),
    );
  }

  /** Fire `apply` once per whole `unit` of `delta`, stopping early if it reports
   *  nothing moved. Returns how much of `delta` was consumed. */
  function drain(delta: number, unit: number, apply: (dir: number) => boolean): number {
    let consumed = 0;
    while (Math.abs(delta - consumed) >= unit) {
      const dir = Math.sign(delta - consumed);
      if (!apply(dir)) break;
      consumed += dir * unit;
    }
    return consumed;
  }

  function scrubEnd(e: PointerEvent) {
    if (!scrubbing) return;
    scrubbing = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  // Same focus rule as the rest of the toolbar: tapping a button must not blur
  // the editor, or the soft keyboard drops out from under the user.
  function keepEditorFocus(e: MouseEvent) {
    e.preventDefault();
  }

  const ARROWS: { icon: IconSvgElement; label: string; dir: Step }[] = [
    { icon: ArrowLeftToLineIcon, label: "Line start", dir: "lineStart" },
    { icon: ArrowLeftDoubleIcon, label: "Word left", dir: "wordLeft" },
    { icon: ArrowLeft01Icon, label: "Left", dir: "charLeft" },
  ];
  const ARROWS_AFTER: { icon: IconSvgElement; label: string; dir: Step }[] = [
    { icon: ArrowRight01Icon, label: "Right", dir: "charRight" },
    { icon: ArrowRightDoubleIcon, label: "Word right", dir: "wordRight" },
    { icon: ArrowRightToLineIcon, label: "Line end", dir: "lineEnd" },
  ];
  const VERTICAL: { icon: IconSvgElement; label: string; dir: Step }[] = [
    { icon: ArrowUp01Icon, label: "Up", dir: "lineUp" },
    { icon: ArrowDown01Icon, label: "Down", dir: "lineDown" },
  ];
</script>

{#snippet arrow(icon: IconSvgElement, label: string, dir: Step)}
  <!-- `touch-action: none` because a tap here is never a gesture: without it the
       browser waits to see if the press becomes a scroll, and the hold repeat
       starts late. The pointerup handler runs the single step, so a plain tap
       and the first step of a hold are the same action. -->
  <button
    class="active:bg-accent active:text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
    style="touch-action: none;"
    aria-label={label}
    onmousedown={keepEditorFocus}
    onpointerdown={() => startHold(dir)}
    onpointerup={(e) => {
      e.preventDefault();
      // A hold that already repeated has moved far enough; adding the tap's step
      // on release would overshoot by one.
      if (holdCount === 0) run((v) => step(v, dir, extend));
      stopHold();
    }}
    onpointercancel={stopHold}
    onpointerleave={stopHold}
  >
    <Icon {icon} class="size-5" />
  </button>
{/snippet}

<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" style="scrollbar-width: none; touch-action: pan-x;">
  <!-- Extend toggle: the same controls, building a selection instead of moving. -->
  <button
    class="active:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium"
    style="touch-action: none;"
    aria-label="Extend selection"
    aria-pressed={extend}
    onmousedown={keepEditorFocus}
    onpointerup={(e) => {
      e.preventDefault();
      toggleExtend();
    }}
  >
    <Icon icon={CursorRectangleSelection01Icon} class="size-4" />
    Select
  </button>

  <div class="bg-border mx-1 h-5 w-px shrink-0"></div>

  {#each ARROWS as a (a.dir)}
    {@render arrow(a.icon, a.label, a.dir)}
  {/each}

  <!-- The trackpad. Wider than a button so it reads as a surface, not a target. -->
  <button
    class="bg-background/60 active:bg-accent flex h-9 w-14 shrink-0 items-center justify-center rounded-full"
    style="touch-action: none;"
    aria-label="Drag to move the cursor"
    onmousedown={keepEditorFocus}
    onpointerdown={scrubStart}
    onpointermove={scrubMove}
    onpointerup={scrubEnd}
    onpointercancel={scrubEnd}
  >
    <Icon icon={ArrowAllDirectionIcon} class="size-5" />
  </button>

  {#each ARROWS_AFTER as a (a.dir)}
    {@render arrow(a.icon, a.label, a.dir)}
  {/each}

  <div class="bg-border mx-1 h-5 w-px shrink-0"></div>

  {#each VERTICAL as a (a.dir)}
    {@render arrow(a.icon, a.label, a.dir)}
  {/each}

  <div class="bg-border mx-1 h-5 w-px shrink-0"></div>

  <!-- Selection shortcuts. Word is the usual starting point: grab it, then widen
       by character with the arrows rather than aiming two handles by hand. -->
  {#each [{ label: "Word", run: selectWordAtCursor }, { label: "Line", run: selectCurrentLine }, { label: "All", run: selectWholeDoc }] as s (s.label)}
    <button
      class="active:bg-accent active:text-accent-foreground flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-medium"
      style="touch-action: none;"
      onmousedown={keepEditorFocus}
      onpointerup={(e) => {
        e.preventDefault();
        run(s.run);
      }}
    >
      {s.label}
    </button>
  {/each}
</div>
