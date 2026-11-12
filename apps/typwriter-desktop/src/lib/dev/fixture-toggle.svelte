<script lang="ts">
  // Dev-only "Demo data / Worst case" switch for the workspace switcher. Plain
  // chrome on purpose — it is not part of the design under test. Pinned
  // bottom-centre, out of the sidebar's way.
  import { FIXTURE_MODES, fixtureMode, type FixtureMode } from "./fixture-mode.svelte";

  const labels: Record<FixtureMode, string> = {
    demo: "Demo",
    worst: "Worst case",
    empty: "Empty",
    one: "One",
  };
</script>

<div class="dev-fixture-toggle" role="radiogroup" aria-label="Fixture data">
  {#each FIXTURE_MODES as mode (mode)}
    <button
      type="button"
      role="radio"
      aria-checked={fixtureMode.mode === mode}
      onclick={() => fixtureMode.set(mode)}
    >
      {labels[mode]}
    </button>
  {/each}
</div>

<style>
  .dev-fixture-toggle {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 9999px;
    background: #e5e5e5;
    font: 500 11px/1 system-ui, sans-serif;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
    max-width: calc(100vw - 16px);
  }
  button {
    padding: 6px 8px;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: #404040;
    white-space: nowrap;
  }
  button[aria-checked="true"] {
    background: #fff;
    color: #0a0a0a;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
</style>
