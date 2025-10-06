import type { DiagnosticResponse, CompletionResponse, RenderResponse } from "../types";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { compile, get_cursor_position, page_click, render } from "../ipc";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

type PreviewPosition = {
    x: number;
    y: number;
    page: number;
}

type CompilationStatus = "idle" | "compiling" | "success" | "error";
export class EditorDocument {
    path: string;
    content = $state("");
    diagnostics = $state<DiagnosticResponse[]>([]);
    completions = $state<CompletionResponse[]>([]);
    renderedContent = $state<RenderResponse[]>([]);
    previewPosition = $state<PreviewPosition>({ x: 0, y: 0, page: 0 });
    compilationStatus = $state<CompilationStatus>("idle");


    constructor(path: string = "") {
        this.path = path;
    }

    // save the document
    async save() {
        if (!this.path) return;
        await writeTextFile(this.path, this.content);
    }

    // compile the document
    async compile() {
        if (!this.path) return;
        this.compilationStatus = "compiling";

        try {
            const result = await invoke<DiagnosticResponse[]>("compile", { file_path: this.path, source: this.content });
            if (result instanceof Array) {
                this.compilationStatus = "success";
                this.diagnostics = result;
                // console.log("Document compiled successfully", result);
                return;
            } else {
                this.compilationStatus = "error";
                console.error("Compilation error: Invalid response");
                return;
            }
        }
        catch (error) {
            this.compilationStatus = "error";
            console.error("Compilation error:", error);
            return;
        }
        // const result = await compile(this.path, this.content);
        // if (result.isErr()) {
        //     this.compilationStatus = "error";
        //     console.error("Compilation error:", result.error);
        //     return;
        // }
        // this.compilationStatus = "success";
        // // on successful compilation, update diagnostics
        // this.diagnostics = result.value;

    }

    // render the document
    // get the rendered images
    async render(): Promise<RenderResponse[]> {
        if (!this.path) return [];

        // const result = await render();
        // if (result.isErr()) {
        //     console.error("Render error:", result.error);
        //     this.renderedContent = [];
        //     return;
        // }

        try {
            const result = await invoke<RenderResponse[]>("render", {});
            this.renderedContent = result;
            // console.log("Document rendered successfully", result);
            return result;
        } catch (error) {

            console.error("Render error:", error);
            this.renderedContent = [];
            return [];
        }

    }

    async getPreviewPosition(cursor_position: number) {
        if (!this.path) return;
        const result = await get_cursor_position(cursor_position, this.content);
        if (result.isErr()) {
            console.error("Get cursor position error:", result.error);
            return;
        }
        this.previewPosition = result.value;


    }

    async previewPageClick(x: number, y: number, page: number) {
        let result = await page_click(page, this.content, x, y)

        if (result.isErr()) {
            console.error(result.error)
            return
        }
        switch (result.value.type) {
            case "FileJump":
                //   appState.moveEditorCursor(result.value.position)
                console.log(result.value)
                break
            case "PositionJump":
                this.previewPosition = {
                    page: result.value.page,
                    x: result.value.x,
                    y: result.value.y,
                }
                console.log(result.value)
                break
            case "UrlJump":
                openUrl(result.value.url)
                break
            case "NoJump":
                console.log("no jump")
                break
        }

        console.log("Result from page_click:", result)
    }

}