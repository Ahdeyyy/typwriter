import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { AndroidFs } from 'tauri-plugin-android-fs-api';
import type { Result } from 'neverthrow';

import { importFiles, importFilesFromUris } from '$lib/ipc/commands';
import { platform } from '$lib/stores/platform.svelte';

export interface WorkspaceImportService {
    importFiles(destDir: string): Promise<Result<void, string> | null>;
}

const androidImportService: WorkspaceImportService = {
    async importFiles(destDir) {
        const uris = await AndroidFs.showOpenFilePicker({ multiple: true });
        if (!uris || uris.length === 0) return null;
        return importFilesFromUris(uris, destDir);
    },
};

const desktopImportService: WorkspaceImportService = {
    async importFiles(destDir) {
        const selected = await openDialog({ multiple: true, directory: false });
        if (!selected) return null;

        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length === 0) return null;
        return importFiles(paths, destDir);
    },
};

export function workspaceImportService(): WorkspaceImportService {
    return platform.isMobile ? androidImportService : desktopImportService;
}

export async function importFilesToWorkspace(destDir: string): Promise<void> {
    const result = await workspaceImportService().importFiles(destDir);
    if (!result) return;
    if (result.isErr()) throw new Error(result.error);
}
