<script lang="ts">
  import { tick } from "svelte";
  import { getSettingControl } from "./control-context";
  const settingControl = getSettingControl();

  // Range input + right-aligned readout, the shape every numeric setting uses.
  interface Props {
    min: number;
    max: number;
    step: number;
    value: number;
    onchange: (value: number) => void;
    /** Formatted readout (e.g. "13px", "unlimited"). A function is passed the
     *  value under the thumb, so it tracks a drag before it is committed. */
    readout: string | ((value: number) => string);
    /** Width class for the readout so columns line up within a group. */
    readoutClass?: string;
    disabled?: boolean;
    /**
     * When the value is committed. "input" (the default) reports every step
     * of a drag. "release" reports only once the thumb is let go (or per
     * keyboard step) — for settings like the UI font size that resize the
     * slider itself, where live updates would pull the track out from under
     * the pointer. The slider is kept in place on screen across the change.
     */
    commit?: "input" | "release";
  }

  let {
    min,
    max,
    step,
    value,
    onchange,
    readout,
    readoutClass = "w-12",
    disabled = false,
    commit = "input",
  }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);
  // The value under the thumb while a "release" drag is in progress.
  let draft = $state<number | null>(null);

  const shown = $derived(draft ?? value);
  const readoutText = $derived(typeof readout === "function" ? readout(shown) : readout);

  function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }
    return null;
  }

  // Commit, then scroll so the slider sits where it did before the layout
  // changed around it.
  async function commitAnchored(next: number) {
    draft = null;
    const el = input;
    if (!el || next === value) {
      onchange(next);
      return;
    }
    const before = el.getBoundingClientRect().top;
    onchange(next);
    await tick();
    const delta = el.getBoundingClientRect().top - before;
    if (delta === 0) return;
    const scroller = scrollParent(el);
    if (scroller) scroller.scrollTop += delta;
  }
</script>

<input
  bind:this={input}
  type="range"
  aria-labelledby={settingControl?.["aria-labelledby"]}
  aria-describedby={settingControl?.["aria-describedby"]}
  aria-valuetext={readoutText}
  {min}
  {max}
  {step}
  value={shown}
  {disabled}
  oninput={(e) => {
    const next = parseFloat(e.currentTarget.value);
    if (commit === "input") onchange(next);
    else draft = next;
  }}
  onchange={(e) => {
    if (commit === "release") void commitAnchored(parseFloat(e.currentTarget.value));
  }}
  class="w-32 accent-primary"
/>
<span class="{readoutClass} text-right text-sm tabular-nums">{readoutText}</span>
