// Worst-case data for the workspace switcher, shaped exactly like what
// `get_recent_workspaces` returns. Names are folder names, so the only limit
// is the filesystem's (255 bytes); Windows paths stop at 260 characters unless
// long paths are enabled, and Linux/macOS allow 4,096.
//
// The menu shows three recents, so those three each carry a different
// failure: a long breakable name under a long OneDrive path, and two folders
// that share a name and differ only by where they live.

import type { RecentWorkspaceEntry } from "$lib/types";
import { fixtureMode } from "./fixture-mode.svelte";

const HOME = "C:/Users/Aleksandra Wiśniewska-Kowalczyk";
const ONEDRIVE = `${HOME}/OneDrive - Northwind Industries Holdings/Dokumenty`;

const entry = (path: string): RecentWorkspaceEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  thumbnail: null,
});

const WORST: RecentWorkspaceEntry[] = [
  entry(`${ONEDRIVE}/Praca magisterska — rozdział 3 (poprawki promotora) v12`),
  entry(`${HOME}/notes`),
  entry("D:/Archive/2024/notes"),
];

const ONE: RecentWorkspaceEntry[] = [entry(`${HOME}/Documents/thesis`)];

/** The recent-projects list the switcher renders: the live list in "demo"
 *  mode (and always in production), otherwise the selected fixture. */
export function fixtureRecents(live: RecentWorkspaceEntry[]): RecentWorkspaceEntry[] {
  if (!import.meta.env.DEV) return live;
  switch (fixtureMode.mode) {
    case "worst":
      return WORST;
    case "empty":
      return [];
    case "one":
      return ONE;
    default:
      return live;
  }
}

/** The open workspace's absolute path as the switcher header shows it. */
export function fixtureCurrentPath(live: string): string {
  if (!import.meta.env.DEV) return live;
  switch (fixtureMode.mode) {
    // Unbreakable, and its parent is the long OneDrive folder.
    case "worst":
      return `${ONEDRIVE}/northwind-industries-holdings_quarterly-report_FY2026_FINAL_final2`;
    // A workspace directly in home: the subtitle is just `~`.
    case "one":
      return `${HOME}/Jo`;
    default:
      return live;
  }
}

/** The home directory to resolve fixture paths against. */
export function fixtureHome(live: string | null): string | null {
  if (!import.meta.env.DEV || fixtureMode.mode === "demo" || fixtureMode.mode === "empty") return live;
  return HOME;
}
