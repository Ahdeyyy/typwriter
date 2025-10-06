import { invoke } from "@tauri-apps/api/core";
import { Err, Result, ResultAsync } from "neverthrow";
import type { DocumentClickResponseType, CompletionResponse, TooltipResponse, TypstSourceDiagnostic, RenderResponse, PreviewPosition } from "./types"


type InvokeError = { message: string }
const toInvokeError = (): InvokeError => ({ message: "Invoke failed" })

/**
 * Compile a file with its source text
 * @param file_path The path to the file to compile
 * @param source The source text of the file
 * @returns A Result containing an array of diagnostics or an error
 */
export async function compile(file_path: string, source: string) {
    const inv = ResultAsync.fromThrowable(
        invoke<TypstSourceDiagnostic[]>,
        (): InvokeError => ({ message: `failed to compile file ${file_path}` })
    );
    const result = await inv("compile", {
        file_path,
        source
    });
    return result;
}

/**
 * Render the currently cached compilation result
 * @returns A Result containing an array of rendered pages or an error
 */
export async function render() {
    const inv = ResultAsync.fromThrowable(
        invoke<RenderResponse[]>,
        (e: any): InvokeError => ({ message: `failed to render pages ${e}` })
    );
    const result = await inv("render", {});
    return result;
}

/**
 * Get the preview position for a cursor position in the source
 * @param cursor_position The character position of the cursor in the source
 * @param source The source text of the file
 * @returns A Result containing the preview position or an error
 */
export async function get_cursor_position(cursor_position: number, source: string) {
    const inv = ResultAsync.fromThrowable(
        invoke<PreviewPosition>,
        (): InvokeError => ({ message: `failed to get cursor position at ${cursor_position}` })
    );
    const result = await inv("get_cursor_position", {
        cursor_position,
        source
    });
    return result;
}

export async function compile_file(source: string, file_path: string, scale: number, cursor_position: number): Promise<InvokeError | undefined> {
    const inv = ResultAsync.fromThrowable(invoke<void>, (): InvokeError => ({ message: `failed to compile file ${file_path}` }));
    const result = await inv("compile_file", {
        source,
        file_path,
        scale,
        cursor_position
    });

    if (result.isErr()) {
        return result.error;
    }

}

export async function page_click(page_number: number, source_text: string, x: number, y: number) {
    const inv = ResultAsync.fromThrowable(invoke<DocumentClickResponseType>, (): InvokeError => ({ message: `failed to handle page click on page ${page_number}` }));
    const result = await inv("page_click", {
        page_number,
        source_text,
        x,
        y
    });
    return result;
}

export async function open_workspace(path: string) {
    const inv = ResultAsync.fromThrowable(invoke<void>, (): InvokeError => ({ message: `failed to open workspace at ${path}` }));
    const result = await inv("open_workspace", {
        path
    });
    return result;
}

/**
 * 
 *  file_path: String,
    export_path: String,
    source: String,
 */
export async function export_to(file_path: string, export_path: string, source: string) {
    const inv = ResultAsync.fromThrowable(invoke<void>, (): InvokeError => ({ message: `failed to export file ${file_path}` }));
    console.log("exporting to", { file_path, export_path, source });
    const result = await inv("export_to", {
        file_path,
        export_path,
        source
    });
    return result;
}

/**
 * Get autocomplete suggestions at the cursor position
 * @param source_text The full source text of the document
 * @param cursor_position The character position of the cursor
 * @param explicit Whether the completion was explicitly requested (e.g., Ctrl+Space)
 * @returns A Result containing the completion response or an error
 */
export async function autocomplete(source_text: string, cursor_position: number, explicit: boolean) {
    const inv = ResultAsync.fromThrowable(
        invoke<CompletionResponse | null>,
        (): InvokeError => ({ message: `failed to get autocomplete at position ${cursor_position}` })
    );
    const result = await inv("autocomplete", {
        source_text,
        cursor_position,
        explicit
    });
    return result;
}

/**
 * Get tooltip information at the cursor position
 * @param source_text The full source text of the document
 * @param cursor_position The character position of the cursor
 * @returns A Result containing the tooltip response or an error
 */
export async function tooltip(source_text: string, cursor_position: number) {
    const inv = ResultAsync.fromThrowable(
        invoke<TooltipResponse | null>,
        (): InvokeError => ({ message: `failed to get tooltip at position ${cursor_position}` })
    );
    const result = await inv("tooltip", {
        source_text,
        cursor_position
    });
    return result;
}
