// Semantic-token highlighting for tinymist.
//
// `@codemirror/lsp-client` does not implement semantic tokens, so this file
// does, as a `ViewPlugin`. It requests `textDocument/semanticTokens/full` and
// decodes the LSP delta-encoded integer stream into decorated ranges. These
// tokens *supplement* the Lezer syntax highlighting: the highlighter is given a
// higher precedence than the base highlight style so its decorations render as
// the inner DOM nodes and win where they apply, while the always-on Lezer layer
// fills everything they don't colour.

import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type PluginValue,
    type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, Prec, type Text } from '@codemirror/state';
import { LSPPlugin, type WorkspaceMapping } from '@codemirror/lsp-client';

const REFRESH_DELAY = 300; // debounce after an edit
const RETRY_DELAY = 600; // backoff while plugin/server capabilities aren't ready
const MAX_RETRIES = 25;

// tokenType 'text' inherits the theme default (no explicit color) — see themes.
// 'comment' is handled synchronously by Lezer highlighting and typstCommentDecorations;
// decorating comments with semantic tokens causes stale comment styling to linger over
// uncommented text until the next server refresh arrives.
export const SKIP_TOKEN_TYPES = new Set(['text', 'comment']);

const setTokens = StateEffect.define<DecorationSet>();

const tokenField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(deco, tr) {
        // Map existing decorations through the edit so they stay roughly aligned
        // between refreshes, then apply a fresh set when one arrives.
        deco = deco.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(setTokens)) deco = effect.value;
        }
        return deco;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export interface SemanticTokensLegend {
    tokenTypes: string[];
    tokenModifiers: string[];
}
export interface SemanticTokensResult {
    data: number[];
}

export function buildSemanticTokens(
    uri: string,
    mapping: Pick<WorkspaceMapping, 'mapPos'> | null,
    syncedDoc: Text,
    docLength: number,
    legend: SemanticTokensLegend,
    data: number[],
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    let line = 0;
    let char = 0;
    let lastTo = -1;

    for (let i = 0; i + 4 < data.length; i += 5) {
        const deltaLine = data[i];
        const deltaChar = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];
        const tokenModifiers = data[i + 4];

        if (deltaLine > 0) {
            line += deltaLine;
            char = deltaChar;
        } else {
            char += deltaChar;
        }

        const typeName = legend.tokenTypes[tokenType];
        if (!typeName || SKIP_TOKEN_TYPES.has(typeName) || length <= 0) continue;
        if (line < 0 || line >= syncedDoc.lines) continue;

        const lineObj = syncedDoc.line(line + 1);
        const rawFrom = lineObj.from + char;
        if (rawFrom > lineObj.to) continue;
        const rawTo = Math.min(rawFrom + length, lineObj.to);

        const from = mapping ? mapping.mapPos(uri, rawFrom, 1) : rawFrom;
        const to = mapping ? mapping.mapPos(uri, rawTo, -1) : rawTo;
        if (to <= from || from < 0 || to > docLength) continue;
        // RangeSetBuilder needs non-decreasing, non-overlapping starts.
        if (from < lastTo) continue;

        const classes = [`cm-tok-${typeName}`];
        for (let bit = 0; bit < legend.tokenModifiers.length; bit++) {
            if (tokenModifiers & (1 << bit)) classes.push(`cm-tokmod-${legend.tokenModifiers[bit]}`);
        }
        builder.add(from, to, Decoration.mark({ class: classes.join(' ') }));
        lastTo = to;
    }

    return builder.finish();
}

class SemanticTokenRequester implements PluginValue {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private retries = 0;
    private generation = 0;

    constructor(private readonly view: EditorView) {
        this.schedule(REFRESH_DELAY);
    }

    update(update: ViewUpdate): void {
        if (update.docChanged) this.schedule(REFRESH_DELAY);
    }

    destroy(): void {
        this.generation++;
        if (this.timer !== null) clearTimeout(this.timer);
    }

    private schedule(delay: number): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.refresh();
        }, delay);
    }

    private async refresh(): Promise<void> {
        const generation = ++this.generation;
        const plugin = LSPPlugin.get(this.view);
        if (!plugin) {
            this.retryLater(generation);
            return;
        }

        try {
            await plugin.client.initializing;
        } catch {
            return; // never connected; the fallback path owns highlighting
        }
        if (generation !== this.generation) return;

        const provider = plugin.client.serverCapabilities?.semanticTokensProvider as
            | { full?: boolean | object; legend?: SemanticTokensLegend }
            | undefined;
        if (!provider || !provider.full || !provider.legend) {
            this.retryLater(generation);
            return;
        }
        const legend = provider.legend;

        // Push any unsynced changes to the server so tinymist computes tokens against
        // the current document version, and track in-flight edits with WorkspaceMapping.
        plugin.client.sync();
        const syncedDoc = plugin.syncedDoc;

        let deco: DecorationSet | null = null;
        try {
            deco = await plugin.client.withMapping(async (mapping) => {
                const result = await plugin.client.request<
                    { textDocument: { uri: string } },
                    SemanticTokensResult | null
                >('textDocument/semanticTokens/full', { textDocument: { uri: plugin.uri } });
                if (generation !== this.generation) return null;
                const data = result?.data ?? [];
                if (data.length === 0) return Decoration.none;
                return buildSemanticTokens(
                    plugin.uri,
                    mapping,
                    syncedDoc,
                    this.view.state.doc.length,
                    legend,
                    data,
                );
            });
        } catch {
            this.retryLater(generation);
            return;
        }
        if (generation !== this.generation || deco === null) return;

        this.retries = 0;
        this.view.dispatch({ effects: setTokens.of(deco) });
    }

    private retryLater(generation: number): void {
        if (generation !== this.generation) return;
        if (this.retries >= MAX_RETRIES) return;
        this.retries++;
        this.schedule(RETRY_DELAY);
    }
}

// Higher precedence than the base Lezer highlighting so these decorations nest
// as the inner DOM nodes and win where they colour text (CodeMirror renders
// higher-precedence mark decorations inside lower-precedence ones).
export const semanticTokenHighlighter = Prec.high([
    tokenField,
    ViewPlugin.fromClass(SemanticTokenRequester),
]);
