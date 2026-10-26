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

  onMount(() => {
    let disposed = false;
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
          void opening.mapErr(() => {
            if (!disposed && workspace.version === openVersion) settings.setLastWorkspace(null);
          });
        } else {
          settings.setLastWorkspace(null);
        }
      }
    };
    void restoreWorkspace();
    return () => {
      disposed = true;
      documentOpening.destroy();
      workspace.destroy();
      app.destroy();
    };
  });
</script>

{#if app.screen === "home"}
  <HomeScreen />
{:else}
  <EditorScreen />
{/if}

<!-- Overlays reachable from both screens. -->
<SettingsOverlay />
<DiagnosticsDrawer />
<ExportDrawer />
