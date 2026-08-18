// The catalog of things the command palette can run.
//
// Distinct from `$lib/keybindings/registry.ts`, which answers "what keystroke
// is this bound to". This answers "what happens when you pick it". The two are
// linked by `shortcut`: a command naming a keybinding id shows whatever that id
// is currently bound to, so a rebind in settings is reflected here without
// touching this file.
//
// Actions that live in component scope (toggling the preview pane, leaving the
// workspace) arrive through `CommandContext` rather than being reached for
// globally, which keeps this list unit-testable with a stub context.

import type { EditorView } from '@codemirror/view';

import { editor } from '$lib/stores/editor.svelte';
import { editorSearch } from '$lib/stores/editor-search.svelte';
import { editorFormat } from '$lib/stores/editor-format.svelte';
import { preview } from '$lib/stores/preview.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { workspace } from '$lib/stores/workspace.svelte';
import { ui } from '$lib/stores/ui.svelte';
import { openSettingsWindow } from '$lib/windows';
import { logError } from '$lib/logger';
import {
    insertCodeBlock,
    insertImage,
    insertLink,
    insertTable,
    setHeadingLevel,
    toggleBold,
    toggleBulletList,
    toggleItalic,
    toggleNumberedList,
    toggleRawInline,
    toggleStrikethrough,
} from '$lib/typst-codemirror-lang';

/** Groups are rendered as headers in the palette, in this order. */
export const COMMAND_GROUPS = [
    'File',
    'Edit',
    'Format',
    'Go',
    'View',
    'Preview',
    'Application',
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface AppCommand {
    id: string;
    title: string;
    group: CommandGroup;
    /** Extra words the palette matches against but does not display. */
    keywords?: string[];
    /** Keybinding command id, for the shortcut hint. */
    shortcut?: string;
    /** When present and false the row is shown greyed out and cannot run. */
    enabled?: () => boolean;
    run: () => void | Promise<void>;
}

/** Component-scoped actions the palette cannot reach on its own. */
export interface CommandContext {
    toggleSidebar(): void;
    togglePreview(): void;
    popoutPreview(): void;
    startPresentation(): void;
    returnHome(): void;
}

/** Run a CodeMirror command against the focused editor, as the toolbar does. */
function inEditor(run: (view: EditorView) => boolean): () => void {
    return () => {
        const view = editorSearch.getActiveView();
        if (!view) return;
        run(view);
        editorFormat.refresh(view);
        view.focus();
    };
}

/** A .typ buffer is focused — what the markup commands need. */
function hasTypstBuffer(): boolean {
    const tab = editor.activeTab;
    return !!tab && tab.viewMode === 'text' && tab.relPath.endsWith('.typ');
}

function hasTextBuffer(): boolean {
    const tab = editor.activeTab;
    return !!tab && tab.viewMode === 'text';
}

export function buildCommands(ctx: CommandContext): AppCommand[] {
    const commands: AppCommand[] = [
        // ── File ────────────────────────────────────────────────────────────
        {
            id: 'file.save',
            title: 'Save file',
            group: 'File',
            shortcut: 'editor.save',
            enabled: hasTextBuffer,
            run: () => {
                editor.saveCurrentFile().mapErr((err) => logError('palette save failed:', err));
            },
        },
        {
            id: 'file.saveAll',
            title: 'Save all files',
            group: 'File',
            keywords: ['flush', 'write'],
            enabled: () => editor.tabs.some((tab) => tab.hasUnsavedChanges),
            run: () => void editor.flushAllTabs(),
        },
        {
            id: 'file.close',
            title: 'Close file',
            group: 'File',
            enabled: () => !!editor.activeTabId,
            run: () => {
                if (editor.activeTabId) void editor.closeTab(editor.activeTabId);
            },
        },
        {
            id: 'file.closeOthers',
            title: 'Close other files',
            group: 'File',
            enabled: () => editor.tabs.length > 1,
            run: () => {
                if (editor.activeTabId) void editor.closeOtherTabs(editor.activeTabId);
            },
        },
        {
            id: 'file.setMain',
            title: 'Set as main file',
            group: 'File',
            keywords: ['entry', 'root', 'compile target'],
            enabled: () => hasTypstBuffer() && workspace.mainFile !== workspace.activeFilePath,
            run: () => {
                const path = workspace.activeFilePath;
                if (!path) return;
                workspace
                    .setMainFileAction(path)
                    .mapErr((err) => logError('palette set main file failed:', err));
            },
        },
        {
            id: 'file.reloadFromDisk',
            title: 'Reload all files from disk',
            group: 'File',
            keywords: ['revert', 'discard'],
            run: () => void editor.reloadAllTabsFromDisk(),
        },

        // ── Edit ────────────────────────────────────────────────────────────
        {
            id: 'edit.find',
            title: 'Find in file',
            group: 'Edit',
            shortcut: 'editor.find',
            enabled: hasTextBuffer,
            run: () => editorSearch.openPanel(false),
        },
        {
            id: 'edit.replace',
            title: 'Find and replace in file',
            group: 'Edit',
            shortcut: 'editor.replace',
            enabled: hasTextBuffer,
            run: () => editorSearch.openPanel(true),
        },
        {
            id: 'edit.format',
            title: 'Format document',
            group: 'Edit',
            keywords: ['typstyle', 'pretty', 'tidy'],
            shortcut: 'editor.format',
            enabled: hasTypstBuffer,
            run: () => {
                editor.formatActiveFile().mapErr((err) => logError('palette format failed:', err));
            },
        },

        // ── Format (Typst markup) ───────────────────────────────────────────
        {
            id: 'format.bold',
            title: 'Toggle bold',
            group: 'Format',
            shortcut: 'typst.toggleBold',
            enabled: hasTypstBuffer,
            run: inEditor(toggleBold),
        },
        {
            id: 'format.italic',
            title: 'Toggle italic',
            group: 'Format',
            shortcut: 'typst.toggleItalic',
            enabled: hasTypstBuffer,
            run: inEditor(toggleItalic),
        },
        {
            id: 'format.strikethrough',
            title: 'Toggle strikethrough',
            group: 'Format',
            enabled: hasTypstBuffer,
            run: inEditor(toggleStrikethrough),
        },
        {
            id: 'format.rawInline',
            title: 'Toggle inline code',
            group: 'Format',
            keywords: ['raw', 'monospace'],
            shortcut: 'typst.toggleRawInline',
            enabled: hasTypstBuffer,
            run: inEditor(toggleRawInline),
        },
        {
            id: 'format.bulletList',
            title: 'Toggle bullet list',
            group: 'Format',
            keywords: ['unordered'],
            enabled: hasTypstBuffer,
            run: inEditor(toggleBulletList),
        },
        {
            id: 'format.numberedList',
            title: 'Toggle numbered list',
            group: 'Format',
            keywords: ['ordered', 'enum'],
            enabled: hasTypstBuffer,
            run: inEditor(toggleNumberedList),
        },
        {
            id: 'format.codeBlock',
            title: 'Insert code block',
            group: 'Format',
            keywords: ['fence', 'raw'],
            enabled: hasTypstBuffer,
            run: inEditor(insertCodeBlock),
        },
        {
            id: 'format.link',
            title: 'Insert link',
            group: 'Format',
            keywords: ['url', 'href'],
            enabled: hasTypstBuffer,
            run: inEditor(insertLink),
        },
        {
            id: 'format.image',
            title: 'Insert image',
            group: 'Format',
            keywords: ['figure', 'picture'],
            enabled: hasTypstBuffer,
            run: inEditor(insertImage),
        },
        {
            id: 'format.table',
            title: 'Insert table',
            group: 'Format',
            keywords: ['grid'],
            enabled: hasTypstBuffer,
            run: inEditor(insertTable),
        },

        // ── Go ──────────────────────────────────────────────────────────────
        {
            id: 'go.file',
            title: 'Go to file…',
            group: 'Go',
            keywords: ['open', 'quick', 'switcher'],
            shortcut: 'global.quickOpen',
            run: () => ui.openPalette('files'),
        },
        {
            id: 'go.heading',
            title: 'Go to heading…',
            group: 'Go',
            keywords: ['outline', 'section', 'symbol'],
            enabled: hasTypstBuffer,
            run: () => ui.openPalette('outline'),
        },

        // ── View ────────────────────────────────────────────────────────────
        {
            id: 'view.toggleSidebar',
            title: 'Toggle sidebar',
            group: 'View',
            shortcut: 'global.toggleSidebar',
            run: () => ctx.toggleSidebar(),
        },
        {
            id: 'view.files',
            title: 'Show files',
            group: 'View',
            keywords: ['explorer', 'tree'],
            run: () => ui.showSection('files'),
        },
        {
            id: 'view.outline',
            title: 'Show outline',
            group: 'View',
            keywords: ['headings', 'toc', 'contents'],
            run: () => ui.showSection('outline'),
        },
        {
            id: 'view.diagnostics',
            title: 'Show diagnostics',
            group: 'View',
            keywords: ['errors', 'warnings', 'problems'],
            run: () => ui.showSection('diagnostics'),
        },
        {
            id: 'view.grammar',
            title: 'Show grammar',
            group: 'View',
            keywords: ['spelling', 'lint', 'harper'],
            run: () => ui.showSection('grammar'),
        },
        {
            id: 'view.history',
            title: 'Show history',
            group: 'View',
            keywords: ['vcs', 'snapshots', 'restore'],
            run: () => ui.showSection('history'),
        },
        {
            id: 'view.wordWrap',
            title: 'Toggle word wrap',
            group: 'View',
            run: () => settings.setWordWrap(!settings.wordWrap),
        },
        {
            id: 'view.lineNumbers',
            title: 'Toggle line numbers',
            group: 'View',
            run: () => settings.setShowLineNumbers(!settings.showLineNumbers),
        },

        // ── Preview ─────────────────────────────────────────────────────────
        {
            id: 'preview.toggle',
            title: 'Toggle preview pane',
            group: 'Preview',
            run: () => ctx.togglePreview(),
        },
        {
            id: 'preview.popout',
            title: 'Open preview in a new window',
            group: 'Preview',
            keywords: ['detach', 'popout'],
            run: () => ctx.popoutPreview(),
        },
        {
            id: 'preview.present',
            title: 'Start presentation mode',
            group: 'Preview',
            keywords: ['slides', 'fullscreen', 'projector'],
            run: () => ctx.startPresentation(),
        },
        {
            id: 'preview.zoomIn',
            title: 'Zoom in preview',
            group: 'Preview',
            run: () => void preview.zoomIn(),
        },
        {
            id: 'preview.zoomOut',
            title: 'Zoom out preview',
            group: 'Preview',
            run: () => void preview.zoomOut(),
        },
        {
            id: 'preview.togglePaginated',
            title: 'Toggle paginated preview',
            group: 'Preview',
            keywords: ['continuous', 'scroll'],
            run: () => preview.togglePaginated(),
        },

        // ── Application ─────────────────────────────────────────────────────
        {
            id: 'app.settings',
            title: 'Open settings',
            group: 'Application',
            keywords: ['preferences', 'options', 'config'],
            run: () => void openSettingsWindow(),
        },
        {
            id: 'app.home',
            title: 'Close workspace and return home',
            group: 'Application',
            keywords: ['leave', 'exit', 'project'],
            run: () => ctx.returnHome(),
        },
    ];

    // Heading levels are mechanical — generating them keeps the list above
    // readable and guarantees the seven rows stay identically worded.
    commands.push({
        id: 'format.heading0',
        title: 'Set normal text',
        group: 'Format',
        keywords: ['paragraph', 'body'],
        enabled: hasTypstBuffer,
        run: inEditor(setHeadingLevel(0)),
    });
    for (let level = 1; level <= 6; level++) {
        commands.push({
            id: `format.heading${level}`,
            title: `Set heading ${level}`,
            group: 'Format',
            keywords: ['title', 'section'],
            enabled: hasTypstBuffer,
            run: inEditor(setHeadingLevel(level)),
        });
    }

    return commands;
}
