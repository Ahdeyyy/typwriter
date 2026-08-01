// Dropping an image onto the editor imports it into the workspace and writes
// an `#image(…)` call as the document's first line.
//
// Only direct image drops are claimed — anything else (text, a dropped folder,
// a non-image file) falls through to CodeMirror's own drop handling.

import { EditorView } from '@codemirror/view';
import { toast } from 'svelte-sonner';

import { hasImageItems, imageFilesFrom } from '$lib/services/drop-import';
import { workspace } from '$lib/stores/workspace.svelte';

/** Build the Typst call for an imported image. Paths are written root-absolute
 *  (`/logo.png`) so they resolve the same no matter which sub-directory the
 *  document lives in. `JSON.stringify` supplies the quoting and the `\"` / `\\`
 *  escapes, which Typst string literals share. */
function imageCall(relPath: string): string {
    return `#image(${JSON.stringify(`/${relPath}`)})`;
}

async function importAndInsert(files: File[], view: EditorView): Promise<void> {
    const toastId = toast.loading(
        `Importing ${files.length} image${files.length === 1 ? '' : 's'}…`
    );
    try {
        // Images land in the workspace root, so a root-absolute Typst path is
        // always just the file name the import settled on.
        const written = await workspace.importDroppedAction(
            '',
            files.map((file) => ({ path: file.name, file }))
        );
        if (written.length === 0) {
            toast.dismiss(toastId);
            return;
        }

        const snippet = written.map(imageCall).join('\n');
        // Always the document's first line. Anchoring to the cursor made the
        // insertion point depend on a selection the drop never sets — an
        // editor that wasn't focused when the drag started would take the
        // image wherever the caret happened to be left.
        const insert = view.state.doc.length > 0 ? `${snippet}\n` : snippet;

        // No explicit selection: CodeMirror maps the existing one through the
        // change, so the caret stays on the text the user left it on rather
        // than jumping to the top of the file.
        view.dispatch({ changes: { from: 0, insert }, scrollIntoView: false });
        view.focus();

        toast.success(
            `Imported ${written.length} image${written.length === 1 ? '' : 's'} into the workspace root`,
            { id: toastId }
        );
    } catch (err) {
        toast.error(`Image import failed: ${err instanceof Error ? err.message : String(err)}`, {
            id: toastId
        });
    }
}

export function imageDrop() {
    return EditorView.domEventHandlers({
        dragover(event) {
            // `getAsFile` is unavailable mid-drag, so the decision is made off
            // the item types alone — which is all `hasImageItems` reads.
            if (!hasImageItems(event.dataTransfer) || !workspace.rootPath) return false;
            event.preventDefault();
            // Keep the window-level backstop (see +layout.svelte) from
            // downgrading the cursor back to "no drop" behind us.
            event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            return true;
        },
        drop(event, view) {
            if (!workspace.rootPath) return false;
            const files = imageFilesFrom(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            event.stopPropagation();
            void importAndInsert(files, view);
            return true;
        }
    });
}
