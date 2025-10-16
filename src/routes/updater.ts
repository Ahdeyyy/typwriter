import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "svelte-sonner";

export async function updateApp() {
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
          toast.info("started downloading update", {
            description: `downloading ${contentLength} bytes`,
          });
          console.log(`started downloading ${event.data.contentLength} bytes`);
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          // toast.info("downloading update", {
          //   description: `downloaded ${downloaded} from ${contentLength}`,
          // });
          console.log(`downloaded ${downloaded} from ${contentLength}`);
          break;
        case "Finished":
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
}
