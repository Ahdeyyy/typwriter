<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    RefreshIcon,
    Mortarboard01Icon,
    File01Icon,
    FavouriteIcon,
    LinkSquare02Icon,
  } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import { setOnboardingCompleted, getLogFilePath } from "$lib/ipc/commands";
  import { emitShowTutorialRequest } from "$lib/ipc/events";
  import { openPath, openUrl } from "@tauri-apps/plugin-opener";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";

  // The tutorial is a page in the *main* window; this window can only ask for
  // it. The main window navigates and focuses itself.
  function handleOpenTutorial() {
    emitShowTutorialRequest().mapErr((err) => {
      logError("show tutorial request failed:", err);
      toast.error("Couldn't open the tutorial.");
      return err;
    });
  }

  async function handleResetTutorial() {
    const result = await setOnboardingCompleted(false);
    result.match(
      () => toast.success("Tutorial reset — it will show again on next launch"),
      (err) => toast.error(`Couldn't reset the tutorial: ${err}`),
    );
  }

  async function handleOpenLogsFile() {
    const result = await getLogFilePath();
    if (result.isErr()) {
      logError("Failed to resolve log file path:", result.error);
      toast.error(`Failed to resolve log file path: ${result.error}`);
      return;
    }
    try {
      await openPath(result.value);
    } catch (err) {
      logError("Failed to open log file:", err);
      toast.error(`Failed to open log file: ${err}`);
    }
  }

  // Matches the `github:` entry in the repo's .github/FUNDING.yml.
  const SPONSOR_URL = "https://github.com/sponsors/Ahdeyyy";

  function handleSponsor() {
    openUrl(SPONSOR_URL).catch((err) => {
      logError("open sponsor page failed:", err);
      toast.error("Couldn't open the sponsor page.");
    });
  }
</script>

<SettingGroup
  title="General"
  description="Updates, onboarding, and app information."
  keywords={["about", "misc", "other"]}
>
  <div class="flex flex-col gap-3">
    <SettingRow
      label
      title="Check for updates on launch"
      description="Silently look for a new version each time Typwriter starts."
      keywords={["auto update", "upgrade", "new version", "release"]}
    >
      {#snippet control()}
        <Switch
          checked={settings.autoCheckUpdates}
          onCheckedChange={(v) => settings.setAutoCheckUpdates(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Tutorial"
      description="Open the onboarding tutorial now, or reset it so it shows again on the next launch."
      keywords={["onboarding", "walkthrough", "getting started", "help"]}
    >
      {#snippet control()}
        <Button variant="outline" size="sm" class="gap-2 shrink-0" onclick={handleOpenTutorial}>
          <HugeiconsIcon icon={Mortarboard01Icon} class="size-4" />
          Open
        </Button>
        <Button variant="outline" size="sm" class="gap-2 shrink-0" onclick={handleResetTutorial}>
          <HugeiconsIcon icon={RefreshIcon} class="size-4" />
          Reset
        </Button>
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Log file"
      description="Open Typwriter's log file in your system's default editor."
      keywords={["logs", "debug", "troubleshoot", "diagnostics"]}
    >
      {#snippet control()}
        <Button variant="outline" size="sm" class="gap-2 shrink-0" onclick={handleOpenLogsFile}>
          <HugeiconsIcon icon={File01Icon} class="size-4" />
          Open logs
        </Button>
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Sponsor Typwriter"
      description="Typwriter is free and open source. Sponsoring helps keep it that way."
      keywords={["sponsor", "donate", "support", "funding", "github sponsors", "contribute"]}
    >
      {#snippet control()}
        <Button variant="outline" size="sm" class="gap-2 shrink-0" onclick={handleSponsor}>
          <HugeiconsIcon icon={FavouriteIcon} class="size-4" />
          Sponsor
          <HugeiconsIcon icon={LinkSquare02Icon} class="size-3.5 text-muted-foreground" />
        </Button>
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Typwriter"
      description={platform.appVersion ? `Version ${platform.appVersion}` : "Loading version…"}
      keywords={["about", "app version", "build"]}
    />
  </div>
</SettingGroup>
