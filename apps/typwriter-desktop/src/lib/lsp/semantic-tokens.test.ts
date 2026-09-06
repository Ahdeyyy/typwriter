import { describe, expect, it } from 'bun:test';
import { Text } from '@codemirror/state';
import {
    buildSemanticTokens,
    SKIP_TOKEN_TYPES,
    type SemanticTokensLegend,
} from './semantic-tokens';

describe('semantic tokens decoder', () => {
    const legend: SemanticTokensLegend = {
        tokenTypes: ['comment', 'keyword', 'variable', 'text', 'function'],
        tokenModifiers: ['strong', 'math'],
    };

    it('skips comment and text tokens to let Lezer handle comments synchronously', () => {
        expect(SKIP_TOKEN_TYPES.has('comment')).toBe(true);
        expect(SKIP_TOKEN_TYPES.has('text')).toBe(true);

        const doc = Text.of(['// this is a comment', 'let x = 1']);
        // data: line 0, char 0, len 20, tokenType 0 (comment), modifier 0
        const data = [0, 0, 20, 0, 0];
        const deco = buildSemanticTokens('file:///test.typ', null, doc, doc.length, legend, data);

        let count = 0;
        const iter = deco.iter();
        while (iter.value !== null) {
            count++;
            iter.next();
        }
        expect(count).toBe(0);
    });

    it('emits decorations for code tokens with correct classes', () => {
        const doc = Text.of(['#let x = 1']);
        // deltaLine 0, deltaChar 0, length 4, tokenType 1 (keyword), mod 1 (strong)
        // deltaLine 0, deltaChar 5, length 1, tokenType 2 (variable), mod 0
        const data = [
            0, 0, 4, 1, 1,
            0, 5, 1, 2, 0,
        ];
        const deco = buildSemanticTokens('file:///test.typ', null, doc, doc.length, legend, data);

        const ranges: Array<{ from: number; to: number; cls: string }> = [];
        const iter = deco.iter();
        while (iter.value !== null) {
            ranges.push({
                from: iter.from,
                to: iter.to,
                cls: (iter.value.spec as { class?: string }).class ?? '',
            });
            iter.next();
        }

        expect(ranges).toEqual([
            { from: 0, to: 4, cls: 'cm-tok-keyword cm-tokmod-strong' },
            { from: 5, to: 6, cls: 'cm-tok-variable' },
        ]);
    });

    it('maps token positions through in-flight edits using WorkspaceMapping', () => {
        const doc = Text.of(['let x = 1']);
        // Suppose 3 characters were inserted at pos 0 in the live document:
        const mockMapping = {
            mapPos: (_uri: string, pos: number, _assoc?: number) => pos + 3,
        };
        const liveDocLength = doc.length + 3;

        // Token at 0..3 in syncedDoc ('let')
        const data = [0, 0, 3, 1, 0];
        const deco = buildSemanticTokens(
            'file:///test.typ',
            mockMapping,
            doc,
            liveDocLength,
            legend,
            data,
        );

        const ranges: Array<{ from: number; to: number }> = [];
        const iter = deco.iter();
        while (iter.value !== null) {
            ranges.push({ from: iter.from, to: iter.to });
            iter.next();
        }

        expect(ranges).toEqual([{ from: 3, to: 6 }]);
    });
});
