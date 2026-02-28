import { ResultAsync } from 'neverthrow';
import { convertFileSrc } from '@tauri-apps/api/core';
import { updateFileContent, saveFile, readFile } from '$lib/ipc/commands';
import { workspace } from './workspace.svelte';

// ─── File type detection ───────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
    '.typ', '.txt', '.md', '.markdown', '.json', '.toml',
    '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',
    , '.xml', '.csv', '.ini', '.env', '.sh', '.rs','.bib'
]);

const IMAGE_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', 'svg','.ico', '.avif', '.tiff', '.svg'
]);

export type ViewMode = 'text' | 'image' | 'unsupported';

function extOf(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

// ─── Store ────────────────────────────────────────────────────────────────────

class EditorStore {
    filePath          = $state<string | null>(null);
    fileContent       = $state('');
    imageSrc          = $state<string | null>(null);
    viewMode          = $state<ViewMode>('text');
    isEditable        = $state(true);
    isLoading         = $state(false);
    hasUnsavedChanges = $state(false);

    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  loadFile(relPath: string): ResultAsync<void, string> {
    const path = workspace.toAbs(relPath);
        this.filePath = path;
        this.hasUnsavedChanges = false;
        this.isLoading = true;

        const ext = extOf(path);

        if (IMAGE_EXTS.has(ext)) {
            this.viewMode = 'image';
            this.isEditable = false;
            // this.imageSrc = convertFileSrc(path);

            // this.fileContent = '';
            // this.isLoading = false;
          return ResultAsync.fromSafePromise<void, string>(readFile(path).then(r => {
                if (r.isErr()) throw new Error(`Error reading file ${path} : ${r.error}`);
                if (r.value.type !== 'image') throw new Error(`Expected binary file, got ${r.value.type}`);
                this.imageSrc = `data:${r.value.mime};base64,${r.value.base64}`;
                this.fileContent = '';
                this.isLoading = false;
            })).mapErr(e => String(e));
        }

        if (TEXT_EXTS.has(ext)) {
            this.viewMode = 'text';
            this.isEditable = true;
            this.imageSrc = null;
            // const url = convertFileSrc(path);
            return ResultAsync.fromPromise<string,string>(
                readFile(path).then(r => {
                    // if (!r.ok) throw new Error(`HTTP ${r.status} reading file`);
                    // return r.text();
                    if (r.isErr()) throw new Error(`Error reading file ${path} : ${r.error}`);
                    if (r.value.type !== 'text') throw new Error(`Expected text file, got ${r.value.type}`);
                    return r.value.content;
                }),
                (e) => String(e)
            ).map(content => {
                this.fileContent = content;
                this.isLoading = false;
            });
        }

        // Unsupported binary
        this.viewMode = 'unsupported';
        this.isEditable = false;
        this.imageSrc = null;
        this.fileContent = '';
        this.isLoading = false;
        return ResultAsync.fromSafePromise(Promise.resolve());
    }

    handleContentChange(content: string): void {
        this.fileContent = content;
        this.hasUnsavedChanges = true;

        if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            if (this.filePath) {
                updateFileContent(this.filePath, content).mapErr(err =>
                    console.error('updateFileContent error:', err)
                );
            }
        }, 300);
    }

    saveCurrentFile(): ResultAsync<void, string> {
        if (!this.filePath) return ResultAsync.fromSafePromise(Promise.resolve());
        return saveFile(this.filePath, this.fileContent).map(() => {
            this.hasUnsavedChanges = false;
        });
    }
}

export const editor = new EditorStore();
