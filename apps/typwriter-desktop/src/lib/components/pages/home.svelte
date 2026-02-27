<script lang="ts">
  import { page, pages } from "@/stores/page.svelte";
  import { Window } from "@tauri-apps/api/window";
  import Button from "../ui/button/button.svelte";

  const window = Window.getCurrent();
  window.setTitle("Typwriter");
</script>

<main>
  <!-- Recent workspaces (not implemented yet)  -->

  <!-- Open new workspace -->
</main>
