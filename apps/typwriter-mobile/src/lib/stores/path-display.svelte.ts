import { appDataDir, documentDir, homeDir } from "@tauri-apps/api/path";
import { displayPath, type DisplayPathRoot } from "$lib/paths";

class PathDisplayStore {
  private roots = $state<DisplayPathRoot[]>([]);

  constructor() {
    if (typeof window === "undefined") return;

    // Home may be unavailable on Android. Resolve each directory separately
    // so managed storage and Documents still get readable labels.
    void Promise.allSettled([homeDir(), documentDir(), appDataDir()]).then((results) => {
      const labels = ["", "Documents", "Typwriter"];
      this.roots = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [{ path: result.value, label: labels[index]! }] : [],
      );
    });
  }

  format(path: string): string {
    return displayPath(path, this.roots);
  }
}

export const pathDisplay = new PathDisplayStore();
