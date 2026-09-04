<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "@/stores/page.svelte";
  import Button from "../ui/button/button.svelte";
  import {
    getRecentWorkspaces,
    createWorkspace,
    initPackageWorkspace,
    listPackages,
    removeRecentWorkspace,
    clearRecentWorkspaces,
  } from "$lib/ipc/commands";
  import type { RecentWorkspaceEntry, PackageEntry } from "$lib/types";
  import { fuzzyRank } from "$lib/fuzzy";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { onboarding } from "$lib/stores/onboarding.svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Folder01Icon,
    FolderOpenIcon,
    FolderAddIcon,
    Delete01Icon,
    Cancel01Icon,
    Settings01Icon,
    Search01Icon,
    PackageIcon,
  } from "@hugeicons/core-free-icons";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import { openSettingsWindow } from "$lib/windows";

  let recentWorkspaces = $state<RecentWorkspaceEntry[]>([]);
  let loading = $state(true);

  // New workspace dialog state
  let newWorkspaceOpen = $state(false);
  let newWorkspaceType = $state<"blank" | "template">("blank");
  let newWorkspaceName = $state("");
  let newWorkspaceParent = $state("");
  let newWorkspaceCreating = $state(false);
  let autoFilledName = $state(false);

  // Template picker state
  let templatePackages = $state<PackageEntry[]>([]);
  let templatesLoading = $state(false);
  let templatesLoaded = false;
  let templateQuery = $state("");
  let selectedTemplate = $state<PackageEntry | null>(null);
  let useCustomSpec = $state(false);
  let customTemplateSpec = $state("");

  async function loadTemplates() {
    if (templatesLoaded || templatesLoading) return;
    templatesLoading = true;
    const result = await listPackages();
    result.match(
      (entries) => {
        templatePackages = entries.filter((e) => e.isTemplate);
        templatesLoaded = true;
        templatesLoading = false;
      },
      (err) => {
        logError("Failed to load packages for templates:", err);
        templatesLoading = false;
      },
    );
  }

  $effect(() => {
    if (newWorkspaceOpen && newWorkspaceType === "template") {
      void loadTemplates();
    }
  });

  const templateMatches = $derived(
    fuzzyRank(
      templatePackages,
      templateQuery,
      (entry) => entry.name,
      (entry) => entry.description ?? "",
    ).slice(0, 50),
  );

  function selectTemplate(entry: PackageEntry) {
    selectedTemplate = entry;
    useCustomSpec = false;
    if (!newWorkspaceName.trim() || autoFilledName) {
      newWorkspaceName = entry.name;
      autoFilledName = true;
    }
  }

  function handleNameInput() {
    autoFilledName = false;
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  let onboardingChecked = false;

  /** Auto-show the tutorial once, on first launch. It compiles examples, but
   *  fonts now load lazily on the first compile, so there's nothing to wait for
   *  here. The Rust-side flag is the source of truth, so this is a no-op on
   *  every subsequent launch. */
  async function maybeAutoShowOnboarding() {
    if (onboardingChecked) return;
    onboardingChecked = true;
    const result = await onboarding.shouldAutoShow();
    if (result.isOk() && result.value) {
      page.navigate("onboarding");
    } else if (result.isErr()) {
      logError("Failed to read onboarding flag:", result.error);
    }
  }

  onMount(() => {
    loadRecent();
    maybeAutoShowOnboarding();
    // The workspace ships as its own chunk now, so warm it while the user is
    // still reading this screen — opening a project should not wait on a fetch.
    page.preload("workspace");
  });

  // ── Workspace operations ────────────────────────────────────────────────────

  async function loadRecent() {
    loading = true;
    const result = await getRecentWorkspaces({ includeThumbnails: true });
    result.match(
      (entries) => {
        recentWorkspaces = entries;
      },
      (err) => {
        logError("Failed to load recent workspaces:", err);
        toast.error(`Failed to load recent workspaces: ${err}`);
      },
    );
    loading = false;
  }

  /** Enter a workspace optimistically: navigate right away so the editor
   *  shell appears instantly behind its loading overlay while `init` runs,
   *  then bounce back home with a toast if the open fails. */
  function enterWorkspace(open: () => ReturnType<typeof workspace.init>) {
    open().match(
      () => {},
      (err) => {
        logError("Failed to open workspace:", err);
        toast.error(`Failed to open workspace: ${err}`);
        page.back("home");
      },
    );
    page.navigate("workspace");
  }

  function handleOpenRecent(path: string) {
    if (workspace.opening) return;
    enterWorkspace(() => workspace.init(path));
  }

  async function handleRemoveRecent(e: MouseEvent, path: string) {
    e.stopPropagation();
    const result = await removeRecentWorkspace(path);
    result.match(
      () => { loadRecent(); },
      (err) => {
        logError("Failed to remove workspace from recents:", err);
        toast.error(`Failed to remove workspace: ${err}`);
      },
    );
  }

  async function handleClearRecent() {
    const result = await clearRecentWorkspaces();
    result.match(
      () => { loadRecent(); },
      (err) => {
        logError("Failed to clear recent workspaces:", err);
        toast.error(`Failed to clear recent workspaces: ${err}`);
      },
    );
  }

  async function handleOpenNew() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;
    // The picker can sit open while another workspace is opening.
    if (workspace.opening) return;

    enterWorkspace(() => workspace.init(selected as string));
  }

  async function handleSelectParentFolder() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      newWorkspaceParent = selected as string;
    }
  }

  async function handleCreateWorkspace() {
    if (workspace.opening || newWorkspaceCreating) return;
    if (!newWorkspaceName.trim()) {
      toast.error("Please enter a workspace name.");
      return;
    }
    if (!newWorkspaceParent) {
      toast.error("Please select a location.");
      return;
    }

    if (newWorkspaceType === "template") {
      const templateSpec = useCustomSpec
        ? customTemplateSpec.trim()
        : selectedTemplate
          ? `@${selectedTemplate.namespace}/${selectedTemplate.name}:${selectedTemplate.version}`
          : "";
      if (!templateSpec) {
        toast.error("Please select a template or enter a package spec.");
        return;
      }

      newWorkspaceCreating = true;
      const initResult = await initPackageWorkspace(
        newWorkspaceParent,
        newWorkspaceName.trim(),
        templateSpec,
      );

      if (initResult.isErr()) {
        logError("Failed to initialize template workspace:", initResult.error);
        toast.error(`Failed to initialize template: ${initResult.error}`);
        newWorkspaceCreating = false;
        return;
      }

      const newPath = initResult.value.workspacePath;
      newWorkspaceCreating = false;
      newWorkspaceOpen = false;
      newWorkspaceName = "";
      newWorkspaceParent = "";
      selectedTemplate = null;
      customTemplateSpec = "";
      useCustomSpec = false;
      autoFilledName = false;

      enterWorkspace(() => workspace.init(newPath));
      return;
    }

    newWorkspaceCreating = true;
    const createResult = await createWorkspace(newWorkspaceParent, newWorkspaceName.trim());

    if (createResult.isErr()) {
      logError("Failed to create workspace:", createResult.error);
      toast.error(`Failed to create workspace: ${createResult.error}`);
      newWorkspaceCreating = false;
      return;
    }

    const newPath = createResult.value;

    // The folder exists, so from here on the open is optimistic like every
    // other entry point: dismiss the dialog and enter the workspace while
    // `init` runs behind its overlay.
    newWorkspaceCreating = false;
    newWorkspaceOpen = false;
    newWorkspaceName = "";
    newWorkspaceParent = "";
    autoFilledName = false;

    enterWorkspace(() => workspace.init(newPath));
  }

  function handleNewWorkspaceKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleCreateWorkspace();
    }
  }

</script>

<Tooltip.Provider>
<div class="flex h-full w-full flex-col">
  <Titlebar variant="minimal" title="Typwriter" />
  <main class="relative flex min-h-0 flex-1 flex-col">
    <!-- Everything that used to be a footer link (docs, tutorial, updates,
         logs) now lives in the settings window, so this is the one entry point
         left on the home screen — it can't move there too. -->
    <div class="absolute right-3 top-3 z-10">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Settings"
              onclick={() => openSettingsWindow()}
            >
              <HugeiconsIcon icon={Settings01Icon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="left">Settings</Tooltip.Content>
      </Tooltip.Root>
    </div>
  <!-- Fill the viewport exactly (no page-level scroll) so the whole screen —
       header and action buttons — always stays visible on short laptops; only
       the recents list shrinks-and-scrolls internally. -->
    <div class="flex h-full min-h-0 w-full flex-col items-center justify-center gap-5 p-4">
      {@render homeContent()}
    </div>
  </main>
</div>
</Tooltip.Provider>

{#snippet homeContent()}
  <section class="flex min-h-0 w-full max-w-3xl flex-col">
    <div class="mb-4 flex shrink-0 items-center justify-between gap-3">
      <h2 class="text-sm font-medium text-muted-foreground">
        Recent Workspaces
      </h2>
      <div class="flex items-center gap-2">
        {#if recentWorkspaces.length > 0}
          <Button
            variant="ghost"
            size="sm"
            onclick={handleClearRecent}
            disabled={workspace.opening}
            class="gap-2 text-destructive hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete01Icon} class="size-4" />
            Clear All
          </Button>
        {/if}
      </div>
    </div>

    <!-- The recents list is the only flexible region — it takes the leftover
         height and scrolls internally, so the page itself never grows past the
         viewport. -->
    <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <span class="text-sm text-muted-foreground">Loading…</span>
      </div>
    {:else if recentWorkspaces.length === 0}
      <div
        class="flex items-center justify-center rounded-md border border-dashed border-border py-12"
      >
        <p class="text-sm text-muted-foreground">
          No recent workspaces. Open a folder to get started.
        </p>
      </div>
    {:else}
      <ul class="grid grid-cols-2 gap-2">
        {#each recentWorkspaces.slice(0, 6) as entry (entry.path)}
            <li class="group relative">
                       <button
                         class="group/card flex w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none cursor-pointer disabled:opacity-50"
                         disabled={workspace.opening}
                         onclick={() => handleOpenRecent(entry.path)}
                       >
                         <div class="flex h-28 w-full items-center justify-center overflow-hidden bg-muted">
                           {#if entry.thumbnail}
                             <img
                               src="data:image/png;base64,{entry.thumbnail}"
                               alt="{entry.name} preview"
                               class="h-full w-full object-cover object-top"
                             />
                           {:else}
                             <HugeiconsIcon icon={Folder01Icon} class="h-8 w-8 text-muted-foreground" />
                           {/if}
                         </div>

                         <div class="min-w-0 px-3 py-2">
                           <p class="truncate text-sm font-medium text-foreground group-hover/card:text-accent-foreground">
                             {entry.name}
                           </p>
                           <p class="truncate text-xs text-muted-foreground group-hover/card:text-accent-foreground/70">
                             {entry.path}
                           </p>
                         </div>
                       </button>

                       <Tooltip.Root>
                         <Tooltip.Trigger>
                           {#snippet child({ props })}
                              <button
                                {...props}
                                class="absolute right-1.5 top-1.5 flex h-6 w-6 rounded-lg items-center justify-center bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground focus:opacity-100 group-hover:opacity-100 "
                                disabled={workspace.opening}
                                onclick={(e) => handleRemoveRecent(e, entry.path)}
                                aria-label="Remove {entry.name} from recents"
                              >
                               <HugeiconsIcon icon={Cancel01Icon} class="size-3.5" />
                             </button>
                           {/snippet}
                         </Tooltip.Trigger>
                         <Tooltip.Content>Remove from recents</Tooltip.Content>
                       </Tooltip.Root>
                     </li>
        {/each}
      </ul>
    {/if}
    </div>
  </section>

  <div class="flex gap-2">
    <Dialog.Root bind:open={newWorkspaceOpen}>
      <Dialog.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline" class="gap-2" disabled={workspace.opening}>
            <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
            New Workspace
          </Button>
        {/snippet}
      </Dialog.Trigger>
      <Dialog.Content class="sm:max-w-lg">
        <Dialog.Header>
          <Dialog.Title>New Workspace</Dialog.Title>
          <Dialog.Description>
            {newWorkspaceType === "template"
              ? "Initialize a new project from a Typst package template."
              : "Choose a location and name for your new workspace."}
          </Dialog.Description>
        </Dialog.Header>

        <!-- Segmented toggle: Blank vs From Template -->
        <div class="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs font-medium">
          <button
            type="button"
            class="flex items-center justify-center rounded-md py-1.5 transition-colors cursor-pointer {newWorkspaceType === 'blank' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => { newWorkspaceType = 'blank'; }}
            disabled={newWorkspaceCreating || workspace.opening}
          >
            Blank Workspace
          </button>
          <button
            type="button"
            class="flex items-center justify-center rounded-md py-1.5 transition-colors cursor-pointer {newWorkspaceType === 'template' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => {
              newWorkspaceType = 'template';
              void loadTemplates();
            }}
            disabled={newWorkspaceCreating || workspace.opening}
          >
            From Template
          </button>
        </div>

        <div class="flex flex-col gap-4 py-1">
          {#if newWorkspaceType === "template"}
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Template</span>
                <button
                  type="button"
                  class="text-xs text-primary hover:underline cursor-pointer"
                  onclick={() => { useCustomSpec = !useCustomSpec; }}
                >
                  {useCustomSpec ? "Pick from known templates" : "Enter custom spec"}
                </button>
              </div>

              {#if useCustomSpec}
                <Input
                  id="template-spec"
                  placeholder="@preview/touying:0.5.5 or @preview/charged-ieee"
                  bind:value={customTemplateSpec}
                  disabled={newWorkspaceCreating || workspace.opening}
                  oninput={() => {
                    const match = customTemplateSpec.match(/@?[^/]+\/([^:]+)/);
                    if (match && (!newWorkspaceName.trim() || autoFilledName)) {
                      newWorkspaceName = match[1];
                      autoFilledName = true;
                    }
                  }}
                />
                <p class="text-[11px] text-muted-foreground">
                  Specify any Typst Universe package spec (e.g. <code>@preview/touying</code>).
                </p>
              {:else}
                <div class="flex flex-col gap-1.5">
                  <div class="relative flex items-center">
                    <HugeiconsIcon icon={Search01Icon} class="absolute left-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search templates (e.g. slides, cv, report, touying)…"
                      bind:value={templateQuery}
                      class="pl-8 text-xs"
                      disabled={newWorkspaceCreating || workspace.opening}
                    />
                  </div>

                  <div class="max-h-40 min-h-24 overflow-y-auto rounded-md border border-border bg-card p-1">
                    {#if templatesLoading}
                      <p class="py-6 text-center text-xs text-muted-foreground">Loading templates…</p>
                    {:else if templateMatches.length === 0}
                      <p class="py-6 text-center text-xs text-muted-foreground">
                        {templatePackages.length === 0 ? "No templates available" : "No templates match"}
                      </p>
                    {:else}
                      <div class="flex flex-col gap-0.5">
                        {#each templateMatches as { item } (item.namespace + "/" + item.name)}
                          <button
                            type="button"
                            class="flex w-full flex-col rounded px-2 py-1.5 text-left transition-colors cursor-pointer {selectedTemplate?.name === item.name ? 'bg-accent text-accent-foreground ring-1 ring-primary' : 'hover:bg-accent/50'}"
                            onclick={() => selectTemplate(item)}
                          >
                            <div class="flex items-center justify-between">
                              <span class="font-mono text-xs font-medium">{item.name}</span>
                              <span class="text-[10px] text-muted-foreground tabular-nums">{item.version}</span>
                            </div>
                            {#if item.description}
                              <p class="line-clamp-1 text-[11px] text-muted-foreground">
                                {item.description}
                              </p>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  {#if selectedTemplate}
                    <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={PackageIcon} class="size-3.5 text-primary" />
                      <span>Selected: <strong class="font-mono text-foreground">{selectedTemplate.name}</strong> ({selectedTemplate.version})</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          <div class="flex flex-col gap-1.5">
            <label for="ws-name" class="text-sm font-medium">Workspace Name</label>
            <Input
              id="ws-name"
              placeholder="my-document"
              bind:value={newWorkspaceName}
              oninput={handleNameInput}
              onkeydown={handleNewWorkspaceKeydown}
              disabled={newWorkspaceCreating || workspace.opening}
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="ws-location" class="text-sm font-medium">Location</label>
            <div class="flex gap-2">
              <Input
                readonly
                id="ws-location"
                value={newWorkspaceParent}
                placeholder="Select a parent folder…"
                class="flex-1 cursor-default text-muted-foreground"
                disabled={newWorkspaceCreating || workspace.opening}
              />
              <Button
                variant="outline"
                size="sm"
                onclick={handleSelectParentFolder}
                disabled={newWorkspaceCreating || workspace.opening}
              >
                Browse
              </Button>
            </div>
            {#if newWorkspaceParent && newWorkspaceName.trim()}
              <p class="text-xs text-muted-foreground break-all">
                Will create: {newWorkspaceParent}/{newWorkspaceName.trim()}
              </p>
            {/if}
          </div>
        </div>

        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" disabled={newWorkspaceCreating || workspace.opening}>Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button
            onclick={handleCreateWorkspace}
            disabled={newWorkspaceCreating ||
              workspace.opening ||
              !newWorkspaceName.trim() ||
              !newWorkspaceParent ||
              (newWorkspaceType === "template" && !useCustomSpec && !selectedTemplate) ||
              (newWorkspaceType === "template" && useCustomSpec && !customTemplateSpec.trim())}
          >
            {newWorkspaceCreating
              ? newWorkspaceType === "template" ? "Initializing…" : "Creating…"
              : newWorkspaceType === "template" ? "Initialize Workspace" : "Create"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <Button onclick={handleOpenNew} disabled={workspace.opening} class="gap-2">
      <HugeiconsIcon icon={FolderOpenIcon} class="size-4" />
      Open Folder
    </Button>
  </div>

{/snippet}
