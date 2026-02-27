<script lang="ts">
  import { page } from "@/stores/page.svelte";

  import { Effect } from "@tauri-apps/api/window";
  import { Window } from "@tauri-apps/api/window";

  const window = Window.getCurrent();
</script>

<page.component />
