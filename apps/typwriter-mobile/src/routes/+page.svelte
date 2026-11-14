<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { startDocumentOpening } from "$lib/document-opening";
  import HomeScreen from "$lib/components/screens/home.svelte";
  import EditorScreen from "$lib/components/screens/editor.svelte";
  import SettingsOverlay from "$lib/components/screens/settings-overlay.svelte";
  import DiagnosticsDrawer from "$lib/components/diagnostics/diagnostics-drawer.svelte";
  import ExportDrawer from "$lib/components/export/export-drawer.svelte";

  /** Reopening the last workspace on launch used to paint home for a beat and
   *  then swap to the editor. Hold the first frame on the bare background
   *  until the restore settles, but never longer than this. */
  const RESTORE_HOLD_MS = 1500;
  let restoring = $state(true);

  onMount(() => {
    let disposed = false;
    const holdTimer = setTimeout(() => (restoring = false), RESTORE_HOLD_MS);
    app.init();
    workspace.init();
    const version = workspace.version;
    const documentOpening = startDocumentOpening();
    const restoreWorkspace = async () => {
      await settings.init();
      await documentOpening.ready;
      if (disposed || version !== workspace.version) return;
      // Re-open the previously active workspace on launch. Silently fall back
      // to the home screen if it no longer exists.
      const last = settings.lastWorkspace;
      if (last) {
        const result = await workspace.refreshList();
        if (disposed || version !== workspace.version || result.isErr()) return;
        if (workspace.workspaces.some((w) => w.name === last)) {
          const opening = workspace.open(last);
          const openVersion = workspace.version;
          await opening.mapErr(() => {
            if (!disposed && workspace.version === openVersion) settings.setLastWorkspace(null);
          });
        } else {
          settings.setLastWorkspace(null);
        }
      }
    };
    void restoreWorkspace().finally(() => {
      clearTimeout(holdTimer);
      restoring = false;
    });
    return () => {
      disposed = true;
      clearTimeout(holdTimer);
      documentOpening.destroy();
      workspace.destroy();
      app.destroy();
    };
  });
</script>

{#if app.screen === "editor"}
  <EditorScreen />
{:else if !restoring}
  <HomeScreen />
{/if}

<!-- Overlays reachable from both screens. -->
<SettingsOverlay />
<DiagnosticsDrawer />
<ExportDrawer />
