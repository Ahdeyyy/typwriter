<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import HomeScreen from "$lib/components/screens/home.svelte";
  import EditorScreen from "$lib/components/screens/editor.svelte";
  import SettingsOverlay from "$lib/components/screens/settings-overlay.svelte";
  import DiagnosticsDrawer from "$lib/components/diagnostics/diagnostics-drawer.svelte";

  onMount(async () => {
    app.init();
    await settings.init();
    // Re-open the previously active workspace on launch (item 3). Silently fall
    // back to the home screen if it no longer exists.
    const last = settings.lastWorkspace;
    if (last) {
      await workspace.refreshList();
      if (workspace.workspaces.some((w) => w.name === last)) {
        workspace.open(last).mapErr(() => settings.setLastWorkspace(null));
      } else {
        settings.setLastWorkspace(null);
      }
    }
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
