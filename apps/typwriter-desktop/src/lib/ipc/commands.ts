import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';

import type {
    FileTreeEntry,
    RecentWorkspaceEntry,
    FileContentResponse,
    CompletionsResponse,
    TooltipResponse,
    JumpResponse,
    PreviewPositionResponse,
    PdfExportConfig,
    PngExportConfig,
    SvgExportConfig
} from '$lib/types';

const toErrString = (e: unknown): string => String(e);

// ─── Workspace ────────────────────────────────────────────────────────────────

export function openFolder(path: string) {
    return ResultAsync.fromPromise(invoke<string | null>('open_folder', { path }), toErrString);
}

export function setMainFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('set_main_file', { path }), toErrString);
}

export function getFileTree() {
    return ResultAsync.fromPromise(invoke<FileTreeEntry[]>('get_file_tree'), toErrString);
}

export function createFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('create_file', { path }), toErrString);
}

export function createFolder(path: string) {
    return ResultAsync.fromPromise(invoke<void>('create_folder', { path }), toErrString);
}

export function deleteFile(path: string) {
    return ResultAsync.fromPromise(invoke<void>('delete_file', { path }), toErrString);
}

export function deleteFolder(path: string) {
    return ResultAsync.fromPromise(invoke<void>('delete_folder', { path }), toErrString);
}

export function renameFile(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('rename_file', { src, dst }), toErrString);
}

export function moveFile(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('move_file', { src, dst }), toErrString);
}

export function moveFolder(src: string, dst: string) {
    return ResultAsync.fromPromise(invoke<void>('move_folder', { src, dst }), toErrString);
}

export function importFiles(sources: string[], destDir: string) {
    return ResultAsync.fromPromise(invoke<void>('import_files', { sources, destDir }), toErrString);
}

export function getRecentWorkspaces() {
    return ResultAsync.fromPromise(
        invoke<RecentWorkspaceEntry[]>('get_recent_workspaces'),
        toErrString
    );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export function readFile(path: string) {
    return ResultAsync.fromPromise(invoke<FileContentResponse>('read_file', { path }), toErrString);
}

export function updateFileContent(path: string, content: string) {
    return ResultAsync.fromPromise(
        invoke<void>('update_file_content', { path, content }),
        toErrString
    );
}

export function saveFile(path: string, content: string) {
    return ResultAsync.fromPromise(invoke<void>('save_file', { path, content }), toErrString);
}

export function discardShadow(path: string) {
    return ResultAsync.fromPromise(invoke<void>('discard_shadow', { path }), toErrString);
}

export function getCompletions(path: string, cursor: number, explicit: boolean) {
    return ResultAsync.fromPromise(
        invoke<CompletionsResponse>('get_completions', { path, cursor, explicit }),
        toErrString
    );
}

export function getTooltip(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<TooltipResponse | null>('get_tooltip', { path, cursor }),
        toErrString
    );
}

export function getDefinitions(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<JumpResponse | null>('get_definitions', { path, cursor }),
        toErrString
    );
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export function triggerPreview() {
    return ResultAsync.fromPromise(invoke<void>('trigger_preview'), toErrString);
}

export function setZoom(scale: number) {
    return ResultAsync.fromPromise(invoke<void>('set_zoom', { scale }), toErrString);
}

export function getZoom() {
    return ResultAsync.fromPromise(invoke<number>('get_zoom'), toErrString);
}

// ─── Click / Jump ─────────────────────────────────────────────────────────────

export function jumpFromClick(page: number, x: number, y: number) {
    return ResultAsync.fromPromise(
        invoke<JumpResponse | null>('jump_from_click', { page, x, y }),
        toErrString
    );
}

export function jumpFromCursor(path: string, cursor: number) {
    return ResultAsync.fromPromise(
        invoke<PreviewPositionResponse[]>('jump_from_cursor', { path, cursor }),
        toErrString
    );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportPdf(config: PdfExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_pdf', { config }), toErrString);
}

export function exportPng(config: PngExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_png', { config }), toErrString);
}

export function exportSvg(config: SvgExportConfig) {
    return ResultAsync.fromPromise(invoke<void>('export_svg', { config }), toErrString);
}
