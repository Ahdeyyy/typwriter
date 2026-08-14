<script lang="ts">
  // Light / Dark / System segmented control.
  //
  // mode-watcher keeps its state per webview, so every change is also broadcast
  // over `app:mode-changed` for the other windows to apply.
  import { setMode, resetMode, userPrefersMode, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api";
  import { emitAppModeChanged, type ModePreference } from "$lib/ipc/events";
  import { logError } from "$lib/logger";

  const OPTIONS: { id: ModePreference; label: string }[] = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ];

  function select(next: ModePreference) {
    if (next === "system") {
      resetMode();
    } else {
      setMode(next);
    }
    // Tauri's window chrome follows the *resolved* mode. Derive it from `next`
    // rather than reading `mode.current` back — that hasn't settled yet in this
    // tick, so it would apply the previous mode's chrome.
    const resolved = next === "system" ? (systemPrefersMode.current ?? "light") : next;
    app.setTheme(resolved === "dark" ? "dark" : "light");
    emitAppModeChanged(next).mapErr((err) => logError("mode broadcast failed:", err));
  }
</script>

<div class="flex items-center gap-1 rounded-md border border-border p-0.5">
  {#each OPTIONS as option (option.id)}
    <button
      type="button"
      class="rounded px-3 py-1 text-sm transition-colors {userPrefersMode.current === option.id
        ? 'bg-accent font-medium text-accent-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      aria-pressed={userPrefersMode.current === option.id}
      onclick={() => select(option.id)}
    >
      {option.label}
    </button>
  {/each}
</div>
