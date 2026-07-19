<!--
  vcs/create-point-dialog.svelte

  The "new restore point" naming dialog for the history pane. Host
  binds `open`; the dialog seeds a timestamped default label each time
  it opens.
-->
<script lang="ts">
  import { tick } from "svelte";

  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { toast } from "svelte-sonner";

  import { vcs } from "$lib/stores/vcs.svelte";
  import { defaultRestoreLabel } from "./shared";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let label = $state("");
  let submitting = $state(false);
  let inputEl: HTMLInputElement | null = $state(null);

  // Seed + focus whenever the dialog opens.
  $effect(() => {
    if (open) {
      label = defaultRestoreLabel();
      tick().then(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  async function submit() {
    if (submitting) return;
    submitting = true;
    const trimmed = label.trim() || "Restore point";
    const result = await vcs.createRestorePoint(trimmed);
    submitting = false;
    result.match(
      (id) => {
        if (id === null) {
          toast.info(
            "Nothing to save — the workspace already matches the latest restore point."
          );
        } else {
          toast.success(`Saved "${trimmed}".`);
        }
        open = false;
      },
      (err) => toast.error(`Create failed: ${err}`)
    );
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>New restore point</Dialog.Title>
      <Dialog.Description>
        Save the current workspace state. You can restore or diff against it any time from the History pane.
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="space-y-4 py-1"
      onsubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
    >
      <div class="space-y-2">
        <label class="text-sm font-medium text-foreground" for="vcs-design-create-label">Label</label>
        <Input
          id="vcs-design-create-label"
          bind:ref={inputEl}
          bind:value={label}
          placeholder="e.g. Before refactor, Draft 2"
          maxlength={120}
          disabled={submitting}
        />
        <p class="text-xs text-muted-foreground">
          A short name shown in the timeline alongside the time and file count.
        </p>
      </div>

      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          onclick={() => (open = false)}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save restore point"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
