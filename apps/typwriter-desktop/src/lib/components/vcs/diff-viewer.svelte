<!--
  vcs/diff-viewer.svelte

  Wraps `@pierre/diffs`'s `FileDiff` class — the vanilla-JS primitive. We
  instantiate one per file and feed it before/after contents from the
  backend. Shiki theming is sourced from a fixed pair so the diff reads
  cleanly in both light and dark modes.

  Heavy: the first render pulls in Shiki + a WASM tokenizer. For workspaces
  with many touched files we render lazily — only the expanded file mounts
  its FileDiff instance.
-->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { FileDiff } from "@pierre/diffs";
  // Note: @pierre/diffs ships a `<diffs-container>` custom element whose
  // shadow root owns the core layout stylesheet. We don't need to import
  // the registration module ourselves — `FileDiff.js` already pulls it in
  // transitively (its export map blocks the deep import anyway). All we
  // have to do is create the element and pass it as `fileContainer`; the
  // constructor takes care of the shadow + adopted stylesheet.
  import type { FileDiff as FileDiffEntry } from "$lib/types";

  let {
    entry,
    layout = "split",
  }: {
    entry: FileDiffEntry;
    layout?: "split" | "unified";
  } = $props();

  /** Host wrapper that owns scrolling + borders. The actual diff goes into a
   *  `<diffs-container>` custom element nested inside, since pierre/diffs
   *  uses that element's shadow DOM to scope its core CSS. */
  let host: HTMLDivElement | undefined = $state();
  let container: HTMLElement | undefined;
  let instance: FileDiff | undefined;
  let lastLayout: "split" | "unified" | undefined;

  // Stylesheet injected into the diffs-container shadow root so long lines
  // wrap instead of producing a horizontal scrollbar. pierre/diffs's core
  // stylesheet is `adopted` into the shadow root, so we can't reach it from
  // the light DOM — we have to add our own sheet to the same shadow root.
  const WRAP_CSS = `
    pre, code, .line, .line-content, .diff-line, .diff-line-content,
    [class*="line-content"], [class*="diff-content"] {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  `;

  function injectWrapStyles(el: HTMLElement | undefined) {
    if (!el) return;
    const root = (el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (!root) return;
    if (root.querySelector("style[data-typwriter-wrap]")) return;
    const style = document.createElement("style");
    style.dataset.typwriterWrap = "true";
    style.textContent = WRAP_CSS;
    root.appendChild(style);
  }

  function teardown() {
    try {
      instance?.cleanUp();
    } catch {
      // cleanUp() can throw if no render ever happened — ignore.
    }
    instance = undefined;
    container?.remove();
    container = undefined;
  }

  function buildInstance() {
    if (!host) return;
    teardown();
    // Create the custom element pierre/diffs expects as fileContainer. Its
    // constructor attaches a shadow root + adopts the bundled stylesheet,
    // which is what makes the rendered diff actually look like a diff.
    container = document.createElement("diffs-container");
    container.style.display = "block";
    host.appendChild(container);

    instance = new FileDiff({
      diffStyle: layout,
      // Dual theme: pierre/diffs picks the active one based on the host
      // color-scheme media query. .typ has no Shiki grammar bundled, so the
      // renderer falls back to plain text — exactly what we want for a
      // content diff without breaking the layout.
      theme: { light: "github-light", dark: "github-dark" },
      disableFileHeader: true,
    });
    lastLayout = layout;
    render();
  }

  function render() {
    if (!instance || !container) return;
    instance.render({
      oldFile: {
        name: entry.path,
        contents: entry.before ?? "",
      },
      newFile: {
        name: entry.path,
        contents: entry.after ?? "",
      },
      fileContainer: container,
    });
    // The diff content lands inside the custom element's shadow root after
    // render. Pierce in with our wrap stylesheet now that it exists.
    injectWrapStyles(container);
  }

  function mountHost(node: HTMLDivElement) {
    host = node;
    buildInstance();
  }

  // Re-render when the entry or layout changes. Layout toggles require a
  // full instance rebuild because `setOptions` doesn't reliably tear down
  // the previous layout's DOM (split's two-column markup leaks into unified
  // and vice versa, leaving the toggle effectively one-way).
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  $effect(() => {
    if (!mounted) return;
    // Read reactive deps so Svelte re-runs this on any change.
    void entry.path;
    void entry.before;
    void entry.after;
    const currentLayout = layout;
    if (!instance) return;
    if (currentLayout !== lastLayout) {
      buildInstance();
    } else {
      render();
    }
  });

  onDestroy(() => {
    teardown();
  });
</script>

{#if entry.binary}
  <div class="text-muted-foreground rounded border border-dashed p-3 text-xs">
    Binary file — diff not displayed
    ({entry.before_bytes.toLocaleString()} → {entry.after_bytes.toLocaleString()} bytes)
  </div>
{:else}
  <div class="pierre-diff-host" use:mountHost></div>
{/if}

<style>
  .pierre-diff-host {
    /* @pierre/diffs renders its own <pre> + theme styles; we just give it a
       scrollable host. font-feature-settings forwarded for ligatures-off look
       in line numbers. */
    font-size: 12px;
    overflow: auto;
    border: 1px solid var(--border, #2b2b2b);
    border-radius: 4px;
    background: var(--background);
  }
</style>
