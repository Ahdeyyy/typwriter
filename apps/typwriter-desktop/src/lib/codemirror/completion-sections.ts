import type { CompletionSection } from '@codemirror/autocomplete';

function hiddenSectionHeader(): HTMLElement {
    const header = document.createElement('span');
    header.style.display = 'none';
    return header;
}

/** Fixed source order for the editor completion list, without visible headers. */
export const typstCompletionSection: CompletionSection = {
    name: 'Typst',
    rank: 0,
    header: hiddenSectionHeader,
};

export const snippetCompletionSection: CompletionSection = {
    name: 'Snippets',
    rank: 1,
    header: hiddenSectionHeader,
};

export const referenceCompletionSection: CompletionSection = {
    name: 'References',
    rank: 2,
    header: hiddenSectionHeader,
};
