// Worst-case data for the workspace screens, shaped exactly like what
// `list_workspaces` returns. Every value is something a real user produces:
// the backend accepts any folder name that has no path separator or reserved
// character, so the only real length limit is the filesystem's 255 bytes.
//
// The first rows are what's on screen, so each one carries a different
// failure rather than stacking them all into row 1.

import type { WorkspaceMeta } from "$lib/ipc/types";
import { fixtureMode } from "./fixture-mode.svelte";

const ROOT = "/storage/emulated/0/Documents/Typwriter";
const now = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;

const meta = (name: string, lastOpenedMs: number | null, path = `${ROOT}/${name}`): WorkspaceMeta => ({
  name,
  path,
  lastOpenedMs,
  system: false,
});

const WORST: WorkspaceMeta[] = [
  // Long, breakable, with diacritics — the "Jump back in" hero.
  meta("Praca magisterska — Wiśniewska-Kowalczyk, rozdział 3 (poprawki promotora) v12", now - 2 * MIN),
  // Two letters, never opened.
  meta("Jo", null),
  // Unbreakable folder name, the shape exports and sync clients produce.
  meta("northwind-industries-holdings_quarterly-report_FY2026_FINAL_final2", now - 3 * DAY),
  // Emoji first: initials/first-grapheme code breaks here.
  meta("📐 Geometry homework", now - 40 * MIN),
  // RTL.
  meta("עבודה סמינריונית בסוציולוגיה", now - 9 * DAY),
  // Tall stacked diacritics (clip test for tight line-height).
  meta("Luận văn tốt nghiệp — Trường Đại học Bách khoa", now - 400 * DAY),
  // CJK, no spaces to break on.
  meta("数学ノート二〇二六年度後期期末試験対策まとめ", now - 3 * 365 * DAY),
  // Outside the managed folder (SAF or a future import): the location line shows.
  meta("thesis", now - 5 * DAY, "/storage/emulated/0/Download/Aleksandra Wiśniewska-Kowalczyk — shared drafts/thesis"),
  {
    name: "Packages",
    path: `${ROOT}/Packages`,
    lastOpenedMs: null,
    system: true,
  },
];

const ONE: WorkspaceMeta[] = [meta("notes", now - 5 * MIN)];

// Unpaginated list: the realistic upper bound for someone who makes one
// workspace per assignment over a few years.
const HUGE: WorkspaceMeta[] = Array.from({ length: 200 }, (_, i) =>
  meta(`Assignment ${String(i + 1).padStart(3, "0")} — ${["Calculus", "Linear algebra", "Physics lab", "Essay draft"][i % 4]}`, now - i * 7 * 3_600_000),
);

/** The workspace list a screen should render: the live list in "demo" mode
 *  (and always in production), otherwise the selected fixture. */
export function fixtureWorkspaces(live: WorkspaceMeta[]): WorkspaceMeta[] {
  if (!import.meta.env.DEV) return live;
  switch (fixtureMode.mode) {
    case "worst":
      return WORST;
    case "empty":
      return [];
    case "one":
      return ONE;
    case "huge":
      return HUGE;
    default:
      return live;
  }
}

/** The open workspace as the file-tree footer and switcher header show it. */
export function fixtureCurrent<T extends { name: string | null; root: string | null; files: number; folders: number }>(
  live: T,
): Pick<T, "name" | "root" | "files" | "folders"> {
  if (!import.meta.env.DEV) return live;
  switch (fixtureMode.mode) {
    case "worst":
      return {
        name: "northwind-industries-holdings_quarterly-report_FY2026_FINAL_final2",
        root: `/storage/emulated/0/Download/Aleksandra Wiśniewska-Kowalczyk — shared drafts/northwind-industries-holdings_quarterly-report_FY2026_FINAL_final2`,
        files: 1284,
        folders: 0,
      };
    case "empty":
      return { name: "Untitled", root: `${ROOT}/Untitled`, files: 0, folders: 0 };
    case "one":
      return { name: "notes", root: `${ROOT}/notes`, files: 1, folders: 1 };
    case "huge":
      return { name: "Assignment 001 — Calculus", root: `${ROOT}/Assignment 001 — Calculus`, files: 12, folders: 3 };
    default:
      return live;
  }
}
