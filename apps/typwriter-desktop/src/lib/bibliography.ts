// Display helpers for citation completions.
//
// Parsing lives in Rust (`commands/bibliography.rs`, via hayagriva — the
// compiler's own reader), which hands over fully-parsed entries. This module
// keeps the shared `BibEntry` shape and turns an entry into the one-line
// description a completion row shows.

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
