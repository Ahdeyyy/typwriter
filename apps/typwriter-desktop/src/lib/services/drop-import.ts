// External drag-and-drop: turning an OS drop into files inside the workspace.
//
// The window runs with `dragDropEnabled: false` (see tauri.conf.json) so the
// webview keeps the HTML5 drag-and-drop APIs — Pierre's file tree and the tab
// bar both drag internally, and Tauri's own handler would swallow those. The
// trade-off is that a drop gives us `File` objects and no paths at all, so the
// bytes have to be read here and shipped to Rust rather than copied on the
// Rust side (which is what `import_files` does for the file picker).

import { importDropped } from '$lib/ipc/commands';

/** One file from an external drop. `path` is relative to the drop target: a
 *  plain file is just its name, while a dropped folder contributes entries
 *  like `assets/logos/mark.png`. */
export interface DroppedFile {
    path: string;
    file: File;
}

/** Ceiling on a single drop. The payload is held in memory three times over
 *  (the File buffers, the framed body, Rust's copy), so this is deliberately
 *  well below what the process could technically allocate. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 2000;

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Whether a drag carries files from outside the app (as opposed to an
 *  internal tree/tab drag, which only sets `text/plain`). */
export function hasExternalFiles(transfer: DataTransfer | null): boolean {
    if (!transfer) return false;
    return Array.from(transfer.types).includes('Files');
}

/** The image files in a drop, read synchronously.
 *
 *  Safe to call from `dragover` too: item `kind`/`type` are readable while the
 *  drag is in flight even though `getAsFile` only works on drop. Dropped
 *  *folders* report an empty type and are deliberately not treated as images —
 *  the editor only handles direct image drops. */
export function imageFilesFrom(transfer: DataTransfer | null): File[] {
    if (!transfer) return [];
    const files: File[] = [];
    for (const item of Array.from(transfer.items ?? [])) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
    }
    if (files.length > 0) return files;
    // No usable `items` — the flat file list can't describe folders, but it's
    // enough to recognize a plain image drop.
    return Array.from(transfer.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/** Whether a drag carries at least one image. Usable during `dragover`, where
 *  the files themselves are still unreadable. */
export function hasImageItems(transfer: DataTransfer | null): boolean {
    if (!transfer) return false;
    return (
        Array.from(transfer.items ?? []).some(
            (item) => item.kind === 'file' && item.type.startsWith('image/')
        ) || Array.from(transfer.files ?? []).some((file) => file.type.startsWith('image/'))
    );
}

/** Flatten a drop into files, walking any dropped directories.
 *
 *  `DataTransfer.items` is emptied as soon as the drop handler returns, so
 *  every entry is pulled out synchronously up front; the entry objects stay
 *  valid afterwards and are what the async traversal walks. Call this before
 *  the first `await` in a drop handler. */
export async function collectDroppedFiles(transfer: DataTransfer): Promise<DroppedFile[]> {
    const entries: FileSystemEntry[] = [];
    const looseFiles: File[] = [];
    for (const item of Array.from(transfer.items ?? [])) {
        if (item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry?.() ?? null;
        if (entry) {
            entries.push(entry);
            continue;
        }
        const file = item.getAsFile();
        if (file) looseFiles.push(file);
    }
    // No `items` at all (or nothing usable in it) — fall back to the flat file
    // list, which can't describe folders but covers plain file drops.
    if (entries.length === 0 && looseFiles.length === 0) {
        looseFiles.push(...Array.from(transfer.files ?? []));
    }

    const collected: DroppedFile[] = looseFiles.map((file) => ({ path: file.name, file }));
    for (const entry of entries) {
        await walkEntry(entry, '', collected);
    }
    return collected;
}

async function walkEntry(
    entry: FileSystemEntry,
    prefix: string,
    out: DroppedFile[]
): Promise<void> {
    if (out.length > MAX_FILES) return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => {
            (entry as FileSystemFileEntry).file(
                (f) => resolve(f),
                () => resolve(null)
            );
        });
        if (file) out.push({ path, file });
        return;
    }
    if (!entry.isDirectory) return;

    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
        await walkEntry(child, path, out);
    }
}

/** `readEntries` yields at most a page of children per call and signals the end
 *  with an empty batch, so a directory has to be drained in a loop. */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
            reader.readEntries(
                (entries) => resolve(entries),
                () => resolve([])
            );
        });
        if (batch.length === 0) return all;
        all.push(...batch);
        if (all.length > MAX_FILES) return all;
    }
}

/** Copy dropped files into `destDir` (workspace-relative; `''` = the workspace
 *  root). Resolves to the workspace-relative paths that were written, which
 *  may differ from the dropped names when a collision was renamed away.
 *
 *  The whole drop goes over in one raw IPC body — see `import_dropped` in
 *  `commands/workspace.rs` for the framing. */
export async function importDroppedFiles(
    destDir: string,
    files: DroppedFile[]
): Promise<string[]> {
    if (files.length === 0) return [];
    // The traversal stops adding past the cap, so the exact count isn't known
    // here — only that the drop went over it.
    if (files.length > MAX_FILES) {
        throw new Error(
            `That drop holds more than ${MAX_FILES} files, which is the most that can be imported at once.`
        );
    }

    const buffers = await Promise.all(files.map((entry) => entry.file.arrayBuffer()));
    const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
            `That drop is ${formatBytes(totalBytes)}; ${formatBytes(MAX_TOTAL_BYTES)} is the most that can be imported at once.`
        );
    }

    const header = new TextEncoder().encode(
        JSON.stringify({
            destDir,
            files: files.map((entry, i) => ({ path: entry.path, len: buffers[i].byteLength }))
        })
    );

    const body = new Uint8Array(4 + header.byteLength + totalBytes);
    new DataView(body.buffer).setUint32(0, header.byteLength, true);
    body.set(header, 4);
    let offset = 4 + header.byteLength;
    for (const buffer of buffers) {
        body.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    const result = await importDropped(body);
    if (result.isErr()) throw new Error(result.error);
    return result.value;
}
