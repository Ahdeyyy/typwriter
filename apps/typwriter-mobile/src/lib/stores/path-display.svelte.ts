import { appDataDir, documentDir, homeDir, join } from "@tauri-apps/api/path";
import { displayPath, workspaceLocation, type DisplayPathRoot } from "$lib/paths";

class PathDisplayStore {
  private roots = $state<DisplayPathRoot[]>([]);
  /** Where managed workspaces live — mirrors `workspaces_root` in
   *  src-tauri/src/workspace.rs (`<documents>/Typwriter`, else
   *  `<app data>/workspaces`). Both candidates are listed: which one the
   *  backend picked depends on whether Documents resolved there. */
  private workspaceRoots = $state<string[]>([]);

  constructor() {
    if (typeof window === "undefined") return;

    // Home may be unavailable on Android. Resolve each directory separately
    // so managed storage and Documents still get readable labels.
    void Promise.allSettled([homeDir(), documentDir(), appDataDir()]).then(async (results) => {
      const labels = ["", "Documents", "Typwriter"];
      const roots = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [{ path: result.value, label: labels[index]! }] : [],
      );
      const [, documents, appData] = results;
      // Android has no usable home, so shared storage (Documents' parent,
      // `/storage/emulated/0`) stands in for it: `Download/…` rather than the
      // full mount path.
      if (documents.status === "fulfilled") {
        const docs = documents.value.replace(/\\/g, "/").replace(/\/+$/, "");
        if (docs.endsWith("/Documents")) roots.push({ path: docs.slice(0, -"/Documents".length), label: "" });
      }
      this.roots = roots;
      const managed = await Promise.allSettled([
        documents.status === "fulfilled" ? join(documents.value, "Typwriter") : Promise.reject(),
        appData.status === "fulfilled" ? join(appData.value, "workspaces") : Promise.reject(),
      ]);
      this.workspaceRoots = managed.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    });
  }

  format(path: string): string {
    return displayPath(path, this.roots);
  }

  /** The workspace's containing folder for the switcher, relative to the
   *  storage root, or `null` when it is the shared managed folder (or not yet
   *  known). */
  location(path: string): string | null {
    if (this.workspaceRoots.length === 0) return null;
    return workspaceLocation(path, this.workspaceRoots, this.roots);
  }
}

export const pathDisplay = new PathDisplayStore();
