<script lang="ts">
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Cancel01Icon,
    CancelCircleIcon,
    RemoveSquareIcon,
    File02Icon,
    Image01Icon,
    File01Icon,
    FolderOpenIcon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import * as Drawer from "$lib/components/ui/drawer";
  import { longpress } from "$lib/actions/longpress";
  import { basename, parentDir } from "$lib/paths";
  import { flip } from "svelte/animate";
  import { easeOut, screen } from "$lib/motion";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";

  const open = $derived(app.overlay === "tabswitcher");
  const count = $derived(editor.tabs.length + (editor.newTabOpen ? 1 : 0));

  // Long-press action drawer for a single tab.
  let actionTarget = $state<string | null>(null);
  /** A long press already opened the drawer — don't also treat the release as a
   *  tap (which would switch to the tab and dismiss the switcher). */
  let longpressed = false;

  // The drawer lives outside `{#if open}` (it has to — the grid unmounts under
  // it) and isn't a history entry, so an Android back press pops the switcher
  // and would leave the drawer floating over the editor. Tie its lifetime to the
  // overlay's.
  $effect(() => {
    if (!open) actionTarget = null;
  });

  function iconFor(name: string): IconSvgElement {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return Image01Icon;
    if (name.endsWith(".typ")) return File02Icon;
    return File01Icon;
  }

  function openTab(rel: string) {
    app.closeOverlay();
    if (!editor.isActiveTab(rel)) {
      editor.loadFile(rel).mapErr((e) => toast.error(`Failed to open: ${e}`));
    }
  }

  /** Tap on a tab card. Swallowed when the press was a long press. */
  function pick(rel: string) {
    if (longpressed) {
      longpressed = false;
      return;
    }
    openTab(rel);
  }

  function newTab() {
    editor.openNewTab();
    app.closeOverlay();
  }

  function closeOthers(rel: string) {
    actionTarget = null;
    editor.closeOtherTabs(rel);
  }

  function closeAll() {
    actionTarget = null;
    editor.closeAllTabs();
    app.closeOverlay();
  }
</script>

{#if open}
  <div
    transition:screen
    class="bg-background fixed inset-0 z-50 flex flex-col"
    style="padding-top: env(safe-area-inset-top);"
  >
    <!-- Tab grid -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 tablet:p-8">
      <div class="grid grid-cols-2 gap-4 tablet:mx-auto tablet:max-w-5xl tablet:grid-cols-4 tablet:gap-6 wide:grid-cols-5">
        {#each editor.tabs as rel (rel)}
          {@const active = editor.isActiveTab(rel)}
          <!-- A closed card shrinks away and its neighbours slide into the
               gap, so the grid never jumps under the finger. -->
          <div
            class="flex flex-col gap-1.5"
            animate:flip={{ duration: 260, easing: easeOut }}
            out:screen={{ duration: 180, scale: 0.9 }}
          >
            <div class="relative">
              <button
                class="bg-card flex aspect-[3/4] w-full items-center justify-center rounded-xl border transition-shadow {active
                  ? 'ring-primary border-primary/60 ring-2'
                  : 'border-border'}"
                onclick={() => pick(rel)}
                onpointerdown={() => (longpressed = false)}
                use:longpress={{
                  onLongpress: () => {
                    longpressed = true;
                    actionTarget = rel;
                  },
                }}
              >
                <Icon icon={iconFor(rel)} class="text-muted-foreground size-10" />
              </button>
              <button
                class="bg-background/80 hover:text-foreground text-muted-foreground absolute right-1.5 top-1.5 flex size-9 items-center justify-center rounded-full"
                aria-label="Close tab"
                onclick={() => editor.closeTab(rel)}
              >
                <Icon icon={Cancel01Icon} class="size-5" />
              </button>
            </div>
            <span class="truncate px-1 text-center text-sm {active ? 'text-foreground font-medium' : 'text-muted-foreground'}">
              {basename(rel)}
            </span>
          </div>
        {/each}

        {#if editor.newTabOpen}
          <div class="flex flex-col gap-1.5">
            <button
              class="bg-card ring-primary border-primary/60 flex aspect-[3/4] w-full items-center justify-center rounded-xl border ring-2"
              onclick={() => app.closeOverlay()}
            >
              <Icon icon={File01Icon} class="text-muted-foreground size-10" />
            </button>
            <span class="text-foreground truncate px-1 text-center text-sm font-medium">New tab</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Bottom bar: new tab · count · done -->
    <div
      class="flex shrink-0 items-center border-t px-4 py-3"
      style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.75rem);"
    >
      <button
        class="text-foreground -ml-1.5 flex size-11 items-center justify-center rounded-full"
        aria-label="New tab"
        onclick={newTab}
      >
        <Icon icon={Add01Icon} class="size-6" />
      </button>
      <span class="text-foreground flex-1 text-center text-sm font-medium">
        {count} tab{count === 1 ? "" : "s"}
      </span>
      <button class="text-foreground -mr-2 h-11 rounded-full px-4 text-sm font-medium" onclick={() => app.closeOverlay()}>
        Done
      </button>
    </div>
  </div>
{/if}

<!-- A single tappable row inside a grouped action card (mirrors the file tree). -->
{#snippet actionRow(icon: IconSvgElement, label: string, onclick: () => void, disabled = false)}
  <button
    type="button"
    {onclick}
    {disabled}
    class="flex min-h-14 w-full items-center gap-4 px-4 py-3 text-left text-[15px] disabled:opacity-40"
  >
    <Icon icon={icon} class="text-muted-foreground size-6 shrink-0" />
    <span class="min-w-0 flex-1 truncate">{label}</span>
  </button>
{/snippet}

<!-- Long-press tab actions -->
<Drawer.Root open={actionTarget !== null} onOpenChange={(o) => { if (!o) actionTarget = null; }}>
  <Drawer.Content>
    {#if actionTarget}
      {@const target = actionTarget}
      <div class="px-4 pb-2 pt-1">
        <Drawer.Title class="truncate text-base font-semibold">{basename(target)}</Drawer.Title>
        <Drawer.Description class="text-muted-foreground truncate text-xs">
          {parentDir(target)}
        </Drawer.Description>
      </div>
      <div
        class="flex flex-col gap-3 px-3 pb-4 pt-2"
        style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);"
      >
        {#if !editor.isActiveTab(target)}
          <div class="bg-muted/40 overflow-hidden rounded-xl">
            {@render actionRow(FolderOpenIcon, "Open", () => {
              actionTarget = null;
              openTab(target);
            })}
          </div>
        {/if}

        <div class="bg-muted/40 divide-border/60 divide-y overflow-hidden rounded-xl">
          {@render actionRow(Cancel01Icon, "Close tab", () => {
            actionTarget = null;
            editor.closeTab(target);
          })}
          {@render actionRow(
            RemoveSquareIcon,
            "Close other tabs",
            () => closeOthers(target),
            editor.tabs.length < 2 && !editor.newTabOpen,
          )}
          {@render actionRow(CancelCircleIcon, "Close all tabs", closeAll)}
        </div>
      </div>
    {/if}
  </Drawer.Content>
</Drawer.Root>
