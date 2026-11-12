// Dev-only data fixtures for stress-testing the workspace switcher (the
// sidebar header and its recent-projects menu). Production builds always read
// "demo" — `import.meta.env.DEV` is statically false there, so every fixture
// branch and the toggle itself are dropped from the bundle.
//
// The selection lives in the `?data=` URL param so a reload keeps it.

// No "huge" state: the switcher shows at most three recent projects.
export const FIXTURE_MODES = ["demo", "worst", "empty", "one"] as const;
export type FixtureMode = (typeof FIXTURE_MODES)[number];

function fromUrl(): FixtureMode {
  if (typeof location === "undefined") return "demo";
  const value = new URLSearchParams(location.search).get("data");
  return (FIXTURE_MODES as readonly string[]).includes(value ?? "") ? (value as FixtureMode) : "demo";
}

class FixtureModeStore {
  mode = $state<FixtureMode>(import.meta.env.DEV ? fromUrl() : "demo");

  set(mode: FixtureMode) {
    if (!import.meta.env.DEV) return;
    this.mode = mode;
    const url = new URL(location.href);
    if (mode === "demo") url.searchParams.delete("data");
    else url.searchParams.set("data", mode);
    history.replaceState(history.state, "", url);
  }
}

export const fixtureMode = new FixtureModeStore();
