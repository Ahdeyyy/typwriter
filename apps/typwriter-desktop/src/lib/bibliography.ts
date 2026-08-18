// Minimal BibTeX reader, for citation completion.
//
// In Typst `@key` resolves to *either* a `<label>` or a bibliography entry, so
// citations belong in the same completion list as references rather than in a
// mechanism of their own.
//
// This reads enough to identify and describe an entry — key, type, and the
// handful of fields worth showing — and deliberately no more. It is not a
// BibTeX implementation: no `@string` expansion, no crossrefs, no LaTeX accent
// decoding. Typst itself does the real parsing at compile time; if an entry is
// malformed, the compiler is the thing that should say so.

export interface BibEntry {
    /** Citation key — what `@key` has to match. */
    key: string;
    /** Entry type, lowercased: `book`, `article`, … */
    type: string;
    title?: string;
    author?: string;
    year?: string;
    /** File the entry came from. */
    path: string;
    line: number;
}

/** Entry types that carry no citation key. */
const NON_ENTRY_TYPES = new Set(['string', 'comment', 'preamble']);

/** Fields worth keeping; everything else is skipped without being parsed. */
const WANTED_FIELDS = new Set(['title', 'author', 'year', 'date']);

/**
 * Read a braced or quoted field value starting at `start`, returning the value
 * and the offset just past it.
 *
 * Brace counting is the part that matters: `title = {The {TeX}book}` must come
 * back whole, and stopping at the first `}` would truncate it.
 */
function readValue(text: string, start: number): { value: string; end: number } {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;

    if (text[i] === '{') {
        let depth = 0;
        const from = i + 1;
        for (; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
                depth--;
                if (depth === 0) return { value: text.slice(from, i), end: i + 1 };
            }
        }
        // Unterminated: take the rest rather than losing the entry entirely.
        return { value: text.slice(from), end: text.length };
    }

    if (text[i] === '"') {
        const from = i + 1;
        for (i = from; i < text.length; i++) {
            if (text[i] === '"' && text[i - 1] !== '\\') {
                return { value: text.slice(from, i), end: i + 1 };
            }
        }
        return { value: text.slice(from), end: text.length };
    }

    // Bare value (a number, or a @string macro name we do not expand).
    const from = i;
    while (i < text.length && !/[,}\n]/.test(text[i])) i++;
    return { value: text.slice(from, i).trim(), end: i };
}

/** Collapse the whitespace and strip the braces BibTeX uses for capitalisation. */
function cleanValue(raw: string): string {
    return raw.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** "Knuth, Donald E. and Lamport, Leslie" -> "Knuth & Lamport" */
export function shortAuthor(raw: string): string {
    const authors = raw
        .split(/\s+and\s+/i)
        .map((name) => {
            const trimmed = name.trim();
            // "Last, First" -> Last; "First Last" -> Last
            if (trimmed.includes(',')) return trimmed.split(',')[0].trim();
            const parts = trimmed.split(/\s+/);
            return parts[parts.length - 1] ?? trimmed;
        })
        .filter(Boolean);

    if (authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
    return `${authors[0]} et al.`;
}

export function parseBibtex(text: string, path = ''): BibEntry[] {
    const entries: BibEntry[] = [];
    if (!text) return entries;

    // Line numbers are wanted for only a few offsets, so count lazily rather
    // than building a full line table for a file that may have no entries.
    const lineOf = (offset: number) => {
        let line = 1;
        for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === '\n') line++;
        }
        return line;
    };

    const entryStart = /@([A-Za-z]+)\s*[{(]\s*([^,\s{}]+)\s*,/g;
    let match: RegExpExecArray | null;

    while ((match = entryStart.exec(text)) !== null) {
        const type = match[1].toLowerCase();
        if (NON_ENTRY_TYPES.has(type)) continue;

        const entry: BibEntry = {
            key: match[2],
            type,
            path,
            line: lineOf(match.index),
        };

        // Walk the fields until the entry's closing brace.
        let i = entryStart.lastIndex;
        let depth = 1;
        while (i < text.length && depth > 0) {
            const char = text[i];
            if (char === '{') {
                depth++;
                i++;
                continue;
            }
            if (char === '}') {
                depth--;
                i++;
                continue;
            }

            const field = /^([A-Za-z][A-Za-z0-9_-]*)\s*=/.exec(text.slice(i));
            if (!field) {
                i++;
                continue;
            }

            const name = field[1].toLowerCase();
            const { value, end } = readValue(text, i + field[0].length);
            if (WANTED_FIELDS.has(name)) {
                const clean = cleanValue(value);
                if (name === 'title') entry.title = clean;
                else if (name === 'author') entry.author = clean;
                // Typst's `date = {2024-01-01}` also answers "what year".
                else if (name === 'year' || name === 'date') {
                    entry.year ??= clean.slice(0, 4);
                }
            }
            i = end;
        }

        entries.push(entry);
        // Resume scanning after the entry we just consumed.
        entryStart.lastIndex = Math.max(entryStart.lastIndex, i);
    }

    return entries;
}

/** One-line description for a completion row: "Knuth & Lamport 1984 — The TeXbook". */
export function describeEntry(entry: BibEntry): string {
    const parts: string[] = [];
    const author = entry.author ? shortAuthor(entry.author) : '';
    if (author) parts.push(author);
    if (entry.year) parts.push(entry.year);
    const prefix = parts.join(' ');
    if (entry.title) return prefix ? `${prefix} — ${entry.title}` : entry.title;
    return prefix || entry.type;
}
