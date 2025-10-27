import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "svelte-sonner";

export const downloadProgress = $state({
  downloaded: 0,
  totalLength: 0,
});

export async function updateApp() {
  try {
    const update = await check();
    if (update) {
      toast.info("found update", {
        description: `found update ${update.version} from ${update.date}`,
      });
      console.log(
        `found update ${update.version} from ${update.date} with notes ${update.body}`,
      );
      let downloaded = 0;
      let contentLength = 0;
      // alternatively we could also call update.download() and update.install() separately
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength || 0;
            downloadProgress.totalLength = contentLength;
            console.log(
              `started downloading ${event.data.contentLength} bytes`,
            );
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            downloadProgress.downloaded = downloaded;

            console.log(`downloaded ${downloaded} from ${contentLength}`);
            break;
          case "Finished":
            toast.success("download finished");
            console.log("download finished");
            break;
        }
      });

      console.log("update installed");
      await relaunch();
    } else {
      toast.success("app is up to date", {
        description: "no updates found",
      });
      console.log("app is up to date");
    }
  } catch (e) {
    toast.error("error checking for updates", {
      description: e instanceof Error ? e.message : String(e),
    });
    console.error("error checking for updates:", e);
  }
}
