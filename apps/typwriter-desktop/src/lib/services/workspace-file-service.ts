import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { Result } from 'neverthrow';

import { importFiles } from '$lib/ipc/commands';

export interface WorkspaceImportService {
    importFiles(destDir: string): Promise<Result<void, string> | null>;
}

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
    return desktopImportService;
}

export async function importFilesToWorkspace(destDir: string): Promise<void> {
    const result = await workspaceImportService().importFiles(destDir);
    if (!result) return;
    if (result.isErr()) throw new Error(result.error);
}
