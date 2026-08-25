<script lang="ts">
  // Snippet authoring.
  //
  // Two writable scopes side by side: app-wide snippets follow the user across
  // every project, project snippets live in the workspace and travel with the
  // document. Built-ins are listed read-only so it is visible what a name will
  // resolve to before you shadow it.

  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Add01Icon,
    Delete01Icon,
    Copy01Icon,
    Alert01Icon,
  } from "@hugeicons/core-free-icons";
  import { Input } from "$lib/components/ui/input/index.js";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingMatch from "../setting-match.svelte";
  import { snippets, type WritableScope } from "$lib/stores/snippets.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { basename } from "$lib/paths";
  import {
    BUILTIN_SNIPPETS,
    validateSnippet,
    type Snippet,
    type SnippetScope,
  } from "$lib/snippets";
  import { toast } from "svelte-sonner";

  let scope = $state<WritableScope>("app");

  /** Name being edited, or null when the form is closed. Empty string = new. */
  let editing = $state<string | null>(null);

  let draftName = $state("");
  let draftLabel = $state("");
  let draftDescription = $state("");
  let draftBody = $state("");

  // The app-wide set is stored in settings, which this window owns; load it on
  // mount so the list is populated even if the editor never opened a workspace.
  $effect(() => {
    void snippets.loadApp();
  });

  // The project set lives in the *workspace*, which this window does not own:
  // `workspace.rootPath` is replicated here from the main window and arrives a
  // beat after mount. Read it inside the effect so the list loads as soon as it
  // does, and again if the user opens a different project while this window
  // stays up. Rust resolves the file against the open workspace, so the read
  // itself needs nothing from us.
  $effect(() => {
    const root = workspace.rootPath;
    if (!root) return;
    void snippets.refreshProject();
  });

  // Closing the workspace strands the project pane on a scope that can no
  // longer be written; fall back rather than leaving a dead form on screen.
  $effect(() => {
    if (!snippets.hasProject && scope === "project") {
      scope = "app";
      editing = null;
    }
  });

  /** Folder name of the open workspace, for labelling the project scope. */
  const projectName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : null,
  );

  const list = $derived(snippets.snippetsIn(scope));

  /** Names already taken in this scope, excluding the one being edited — a
   *  snippet keeping its own name is not a collision. */
  const takenNames = $derived(
    list.map((s) => s.name).filter((name) => name !== editing),
  );

  const problems = $derived(
    editing === null ? {} : validateSnippet({ name: draftName, body: draftBody }, takenNames),
  );
  const canSave = $derived(editing !== null && Object.keys(problems).length === 0);

  const SCOPE_LABELS: Record<SnippetScope, string> = {
    builtin: "Built-in",
    app: "App-wide",
    project: "Project",
  };

  function startNew() {
    editing = "";
    draftName = "";
    draftLabel = "";
    draftDescription = "";
    draftBody = "";
  }

  function startEdit(snippet: Snippet) {
    editing = snippet.name;
    draftName = snippet.name;
    draftLabel = snippet.label;
    draftDescription = snippet.description ?? "";
    draftBody = snippet.body;
  }

  function cancel() {
    editing = null;
  }

  async function save() {
    if (!canSave || editing === null) return;
    const name = draftName.trim();
    await snippets.save(
      scope,
      {
        name,
        // An empty label means "same as the name", which is what most
        // snippets want and saves filling in two identical fields.
        label: draftLabel.trim() || name,
        description: draftDescription.trim() || undefined,
        body: draftBody,
      },
      // Pass the old name so a rename replaces rather than duplicates.
      editing || undefined,
    );
    editing = null;
    toast.success(`Saved snippet “${name}”`);
  }

  async function remove(snippet: Snippet) {
    await snippets.remove(scope, snippet.name);
    if (editing === snippet.name) editing = null;
    toast.success(`Deleted snippet “${snippet.name}”`);
  }

  async function copyToOtherScope(snippet: Snippet) {
    const target: WritableScope = scope === "app" ? "project" : "app";
    await snippets.copyTo(target, snippet);
    toast.success(`Copied to ${SCOPE_LABELS[target].toLowerCase()} snippets`);
  }

  function startFromBuiltin(snippet: Snippet) {
    editing = "";
    draftName = snippet.name;
    draftLabel = snippet.label;
    draftDescription = snippet.description ?? "";
    draftBody = snippet.body;
  }
</script>

<SettingGroup
  title="Snippets"
  description="Reusable Typst boilerplate. Type a snippet's name in the editor and pick it from the completion list."
>
  <SettingMatch
    keywords={[
      "snippets",
      "templates",
      "boilerplate",
      "scaffold",
      "app-wide snippets",
      "project snippets",
    ]}
    matched={true}
  >
    <!-- ── Scope switch ─────────────────────────────────────────────── -->
    <div class="flex items-center gap-1.5 pb-3">
      <Button
        variant={scope === "app" ? "default" : "outline"}
        size="sm"
        onclick={() => {
          scope = "app";
          editing = null;
        }}
      >
        App-wide
      </Button>
      <Button
        variant={scope === "project" ? "default" : "outline"}
        size="sm"
        disabled={!snippets.hasProject}
        onclick={() => {
          scope = "project";
          editing = null;
        }}
      >
        {projectName ?? "This project"}
      </Button>

      <span class="text-muted-foreground ml-2 flex-1 text-xs">
        {#if scope === "app"}
          Available in every project.
        {:else}
          Only in this project. Saved to <code>.typwriter/snippets.json</code>, so they
          travel with it.
        {/if}
      </span>

      <Button variant="outline" size="sm" onclick={startNew}>
        <HugeiconsIcon icon={Add01Icon} class="size-3.5" />
        New
      </Button>
    </div>

    {#if snippets.errors.length > 0}
      <div class="mb-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs">
        <HugeiconsIcon icon={Alert01Icon} class="text-destructive mt-0.5 size-3.5 shrink-0" />
        <div class="min-w-0">
          <p class="font-medium">Some project snippets could not be loaded.</p>
          {#each snippets.errors as error, errorIndex (errorIndex)}
            <p class="text-muted-foreground">{error}</p>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Editor form ──────────────────────────────────────────────── -->
    {#if editing !== null}
      <div class="bg-muted/40 mb-3 space-y-2 rounded-lg p-3">
        <div class="flex gap-2">
          <div class="flex-1 space-y-1">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-xs font-medium">Name</label>
            <Input bind:value={draftName} placeholder="figure" class="h-8 text-sm" />
            {#if problems.name}
              <p class="text-destructive text-[11px]">{problems.name}</p>
            {/if}
          </div>
          <div class="flex-1 space-y-1">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-xs font-medium">Label <span class="text-muted-foreground">(optional)</span></label>
            <Input bind:value={draftLabel} placeholder={draftName || "figure"} class="h-8 text-sm" />
          </div>
        </div>

        <div class="space-y-1">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium">Description <span class="text-muted-foreground">(optional)</span></label>
          <Input
            bind:value={draftDescription}
            placeholder="Figure with a caption and a label"
            class="h-8 text-sm"
          />
        </div>

        <div class="space-y-1">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-medium">Body</label>
          <textarea
            bind:value={draftBody}
            rows="8"
            spellcheck="false"
            placeholder={"#figure(\n  image(\"${path}\"),\n  caption: [${caption}],\n)"}
            class="border-input bg-background placeholder:text-muted-foreground w-full rounded-md
                   border px-2 py-1.5 font-mono text-xs outline-none"
          ></textarea>
          {#if problems.body}
            <p class="text-destructive text-[11px]">{problems.body}</p>
          {/if}
          <p class="text-muted-foreground text-[11px]">
            <code>{"${}"}</code> is where the cursor lands, and
            <code>{"${name}"}</code> is a placeholder you tab through.
          </p>
        </div>

        <div class="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onclick={cancel}>Cancel</Button>
          <Button size="sm" disabled={!canSave} onclick={save}>Save</Button>
        </div>
      </div>
    {/if}

    <!-- ── This scope's snippets ────────────────────────────────────── -->
    {#if list.length === 0}
      <p class="text-muted-foreground py-4 text-center text-xs">
        No {SCOPE_LABELS[scope].toLowerCase()} snippets yet.
      </p>
    {:else}
      <div class="space-y-0.5">
        {#each list as snippet (snippet.name)}
          <div class="hover:bg-muted/50 group flex items-center gap-2 rounded px-2 py-1.5">
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              onclick={() => startEdit(snippet)}
            >
              <span class="font-mono text-xs font-medium">{snippet.name}</span>
              {#if snippet.description}
                <span class="text-muted-foreground ml-2 text-xs">{snippet.description}</span>
              {/if}
            </button>

            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Copy to ${scope === "app" ? "this project" : "app-wide"}`}
                    disabled={scope === "app" && !snippets.hasProject}
                    onclick={() => copyToOtherScope(snippet)}
                  >
                    <HugeiconsIcon icon={Copy01Icon} class="size-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>
                Copy to {scope === "app" ? "this project" : "app-wide"}
              </Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete snippet"
                    onclick={() => remove(snippet)}
                  >
                    <HugeiconsIcon icon={Delete01Icon} class="size-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Delete</Tooltip.Content>
            </Tooltip.Root>
          </div>
        {/each}
      </div>
    {/if}
  </SettingMatch>

  <!-- ── Built-ins ────────────────────────────────────────────────── -->
  <SettingMatch
    keywords={["built-in snippets", "default snippets", "figure", "theorem", "letter"]}
    matched={true}
  >
    <div class="pt-4">
      <p class="pb-2 text-xs font-medium">Built-in</p>
      <p class="text-muted-foreground pb-2 text-xs">
        Shipped with Typwriter. Start from one to make your own version — saving it under the
        same name replaces the built-in everywhere it applies.
      </p>
      <div class="space-y-0.5">
        {#each BUILTIN_SNIPPETS as snippet (snippet.name)}
          <div class="hover:bg-muted/50 flex items-center gap-2 rounded px-2 py-1.5">
            <span class="min-w-0 flex-1">
              <span class="font-mono text-xs font-medium">{snippet.name}</span>
              <span class="text-muted-foreground ml-2 text-xs">{snippet.description}</span>
            </span>
            <Button variant="ghost" size="sm" onclick={() => startFromBuiltin(snippet)}>
              Start from this
            </Button>
          </div>
        {/each}
      </div>
    </div>
  </SettingMatch>
</SettingGroup>
