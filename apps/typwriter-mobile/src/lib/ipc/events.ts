// Backend-pushed events. The only place `listen` is called, mirroring the way
// `commands.ts` is the only place `invoke` is called.

import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { ResultAsync } from "neverthrow";
import type { WorkspaceFilesChangedPayload } from "./types";

export type { UnlistenFn };

const toErrString = (e: unknown): string => String(e);

/** Files in the open workspace changed on disk without the app doing it —
 *  see `src-tauri/src/watcher.rs`. */
export function onWorkspaceFilesChanged(
  handler: (payload: WorkspaceFilesChangedPayload) => void,
): ResultAsync<UnlistenFn, string> {
  return ResultAsync.fromPromise(
    listen<WorkspaceFilesChangedPayload>(
      "workspace:files-changed",
      (event: Event<WorkspaceFilesChangedPayload>) => handler(event.payload),
    ),
    toErrString,
  );
}
