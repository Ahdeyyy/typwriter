import { snippet, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import type { CompletionsResponse } from '$lib/types';
import { completionScope, completionTree, referenceContextAt } from './completion-context';

/** Escape literal Typst braces while preserving IDE placeholders as tab stops. */
export function typstApplyToSnippet(apply: string): string {
    let out = '';
    for (let i = 0; i < apply.length; i++) {
        const ch = apply[i];
        if (ch === '$' && apply[i + 1] === '{') {
            const end = apply.indexOf('}', i + 2);
            if (end !== -1) {
                out += '${' + apply.slice(i + 2, end).replace(/[{}]/g, '\\$&') + '}';
                i = end;
                continue;
            }
        }
        out += ch === '{' || ch === '}' ? '\\' + ch : ch;
    }
    return out;
}

const COMPLETION_TYPES: Record<string, string> = {
    syntax: 'syntax', func: 'function', type: 'type', param: 'property',
    constant: 'constant', path: 'path', package: 'package', label: 'label',
    font: 'font', symbol: 'symbol',
};

function completionKind(kind: string): Completion['type'] {
    const variant = kind.split('(')[0].trim().toLowerCase();
    if (COMPLETION_TYPES[variant]) return COMPLETION_TYPES[variant];
    if (variant.includes('func')) return 'function';
    if (variant.includes('type')) return 'type';
    if (variant.includes('param') || variant.includes('field')) return 'property';
    if (variant.includes('var')) return 'variable';
    if (variant.includes('module') || variant.includes('namespace')) return 'namespace';
    if (variant.includes('constant')) return 'constant';
    if (variant.includes('keyword')) return 'keyword';
    return 'text';
}

/** The IDE determines candidates and the replacement range from the same buffer. */
export function typstCompletionSource(
    request: (text: string, pos: number, explicit: boolean) => Promise<CompletionsResponse | null>,
): CompletionSource {
    return semanticCompletionSource(async (context) => {
        const text = context.state.doc.toString();
        const payload = await request(text, context.pos, context.explicit);
        if (!payload || payload.completions.length === 0) return null;
        if (payload.from < 0 || payload.from > context.pos) return null;

        let from = payload.from;
        // Explicit markup snippets are anchored at the cursor by typst-ide.
        // Replace a matching partial name instead of appending to it.
        if (context.explicit && from === context.pos &&
            completionScope(text, context.pos, completionTree(context.state)) === 'markup') {
            const word = context.matchBefore(/[\p{L}\p{M}\p{N}_-]+/u);
            if (word && payload.completions.some((item) => item.label.toLowerCase().startsWith(word.text.toLowerCase()))) {
                from = word.from;
            }
        }

        return {
            from,
            options: payload.completions.map((item) => {
                const apply = item.apply ?? item.label;
                return {
                    label: item.label,
                    type: completionKind(item.kind),
                    apply: apply.includes('${') ? snippet(typstApplyToSnippet(apply)) : apply,
                    detail: item.detail ?? undefined,
                };
            }),
        };
    });
}

/** Apply the same syntax and request-lifetime rules to built-in and LSP results. */
export function semanticCompletionSource(source: CompletionSource): CompletionSource {
    return async (context) => {
        const { scope, ref, cite } = referenceContextAt(context.state, context.pos);
        if (scope === 'comment' || scope === 'raw' || ref || cite) return null;
        // Semantic candidates depend on more than the word being completed.
        context.addEventListener('abort', () => {}, { onDocChange: true });
        const result = await source(context);
        if (context.aborted || !result) return null;
        return { ...result, validFor: undefined };
    };
}
