import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { AndroidFs } from 'tauri-plugin-android-fs-api';
import type { Result } from 'neverthrow';

import {
    exportHtml,
    exportHtmlToUri,
    exportPdf,
    exportPdfToUri,
    exportPng,
    exportPngToDirUri,
    exportSvg,
    exportSvgToDirUri,
    exportWorkspaceToDirUri,
} from '$lib/ipc/commands';
import { platform } from '$lib/stores/platform.svelte';
import type {
    HtmlExportConfig,
    PdfExportConfig,
    PngExportConfig,
    SvgExportConfig,
} from '$lib/types';

type MaybeResult<T> = Promise<Result<T, string> | null>;

export interface WorkspaceFileService {
    exportWorkspace(): MaybeResult<number>;
    exportPdf(defaultPath: string, config: Omit<PdfExportConfig, 'path'>): MaybeResult<void>;
    exportPng(config: Omit<PngExportConfig, 'dir'>): MaybeResult<void>;
    exportSvg(config: Omit<SvgExportConfig, 'dir'>): MaybeResult<void>;
    exportHtml(defaultPath: string, config: Omit<HtmlExportConfig, 'path'>): MaybeResult<void>;
}

const androidFileService: WorkspaceFileService = {
    async exportWorkspace() {
        const dirUri = await AndroidFs.showOpenDirPicker();
        if (!dirUri) return null;
        return exportWorkspaceToDirUri(dirUri);
    },
    async exportPdf(defaultPath, config) {
        const fileUri = await AndroidFs.showSaveFilePicker(defaultPath, 'application/pdf');
        if (!fileUri) return null;
        return exportPdfToUri(fileUri, { ...config, path: '' });
    },
    async exportPng(config) {
        const dirUri = await AndroidFs.showOpenDirPicker();
        if (!dirUri) return null;
        return exportPngToDirUri(dirUri, { ...config, dir: '' });
    },
    async exportSvg(config) {
        const dirUri = await AndroidFs.showOpenDirPicker();
        if (!dirUri) return null;
        return exportSvgToDirUri(dirUri, { ...config, dir: '' });
    },
    async exportHtml(defaultPath, config) {
        const fileUri = await AndroidFs.showSaveFilePicker(defaultPath, 'text/html');
        if (!fileUri) return null;
        return exportHtmlToUri(fileUri, { ...config, path: '' });
    },
};

const desktopFileService: WorkspaceFileService = {
    async exportWorkspace() {
        return null;
    },
    async exportPdf(defaultPath, config) {
        const path = await saveDialog({
            title: 'Export PDF',
            defaultPath,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!path) return null;
        return exportPdf({ ...config, path });
    },
    async exportPng(config) {
        const dir = await openDialog({
            directory: true,
            title: 'Select PNG output folder',
        });
        if (!dir) return null;
        return exportPng({ ...config, dir: Array.isArray(dir) ? dir[0] : dir });
    },
    async exportSvg(config) {
        const dir = await openDialog({
            directory: true,
            title: 'Select SVG output folder',
        });
        if (!dir) return null;
        return exportSvg({ ...config, dir: Array.isArray(dir) ? dir[0] : dir });
    },
    async exportHtml(defaultPath, config) {
        const path = await saveDialog({
            title: 'Export HTML',
            defaultPath,
            filters: [{ name: 'HTML', extensions: ['html'] }],
        });
        if (!path) return null;
        return exportHtml({ ...config, path });
    },
};

export function workspaceFileService(): WorkspaceFileService {
    return platform.isMobile ? androidFileService : desktopFileService;
}

export async function exportPdfWithPicker(defaultPath: string, config: Omit<PdfExportConfig, 'path'>) {
    return workspaceFileService().exportPdf(defaultPath, config);
}

export async function exportPngWithPicker(config: Omit<PngExportConfig, 'dir'>) {
    return workspaceFileService().exportPng(config);
}

export async function exportSvgWithPicker(config: Omit<SvgExportConfig, 'dir'>) {
    return workspaceFileService().exportSvg(config);
}

export async function exportHtmlWithPicker(
    defaultPath: string,
    config: Omit<HtmlExportConfig, 'path'>
) {
    return workspaceFileService().exportHtml(defaultPath, config);
}

export async function exportWorkspaceWithPicker() {
    return workspaceFileService().exportWorkspace();
}
