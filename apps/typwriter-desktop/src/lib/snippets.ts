// Snippets: a starter set of Typst boilerplate, plus whatever the user adds.
//
// Bodies are written in CodeMirror's snippet syntax — `${}` is a tab stop and
// `${name}` is a named placeholder — which is the same syntax the existing
// typst-ide completions are converted into, so the two feel identical once
// inserted.
//
// User snippets live in `.typwriter/snippets.json` inside the workspace, so
// they travel with the project rather than with the machine. Parsing is
// deliberately forgiving: one malformed entry reports itself and the rest still
// load, because a JSON typo should not silently remove every snippet.

export interface Snippet {
    /** Typed to summon the snippet, and its identity for overriding. */
    name: string;
    /** Shown in the completion list. */
    label: string;
    description?: string;
    /** CodeMirror snippet template. */
    body: string;
}

export const BUILTIN_SNIPPETS: Snippet[] = [
    {
        name: 'figure',
        label: 'figure',
        description: 'Figure with a caption and a label',
        body: '#figure(\n  image("${path}", width: ${70}%),\n  caption: [${caption}],\n) <fig-${name}>\n${}',
    },
    {
        name: 'table',
        label: 'table',
        description: 'Table with a header row',
        body: '#figure(\n  table(\n    columns: ${3},\n    table.header([${A}], [${B}], [${C}]),\n    [${}], [], [],\n  ),\n  caption: [${caption}],\n) <tab-${name}>\n',
    },
    {
        name: 'theorem',
        label: 'theorem',
        description: 'Theorem block with a statement and proof',
        body: '#block(\n  fill: luma(${240}),\n  inset: 8pt,\n  radius: 4pt,\n)[\n  *Theorem ${1}.* ${statement}\n]\n\n_Proof._ ${proof} #h(1fr) $square$\n${}',
    },
    {
        name: 'letter',
        label: 'letter',
        description: 'Letter scaffold with sender, recipient and date',
        body: '#set page(margin: 2.5cm)\n#set text(size: 11pt)\n\n#align(right)[\n  ${Sender Name} \\\\\n  ${Street} \\\\\n  #datetime.today().display()\n]\n\n${Recipient} \\\\\n${Address}\n\n#v(1em)\n\n${Dear ...},\n\n${}\n\n#v(2em)\n${Yours sincerely,} \\\\\n${Sender Name}\n',
    },
    {
        name: 'import',
        label: 'import',
        description: 'Import from a Typst Universe package',
        body: '#import "@preview/${package}:${0.1.0}": ${*}\n${}',
    },
    {
        name: 'grid',
        label: 'grid',
        description: 'Grid layout with equal columns',
        body: '#grid(\n  columns: (${1fr}, ${1fr}),\n  gutter: ${1em},\n  [${left}],\n  [${right}],\n)\n${}',
    },
    {
        name: 'codeblock',
        label: 'code',
        description: 'Raw block with a language',
        body: '```${rust}\n${}\n```\n',
    },
    {
        name: 'equation',
        label: 'equation',
        description: 'Numbered block equation with a label',
        body: '$ ${x = y} $ <eq-${name}>\n${}',
    },
    {
        name: 'bibliography',
        label: 'bibliography',
        description: 'Bibliography section',
        body: '#bibliography("${refs.bib}", style: "${ieee}")\n',
    },
    {
        name: 'outline',
        label: 'outline',
        description: 'Table of contents',
        body: '#outline(\n  title: [${Contents}],\n  depth: ${3},\n)\n${}',
    },
    {
        name: 'note',
        label: 'note',
        description: 'Callout block',
        body: '#block(\n  fill: ${rgb("#eef")},\n  stroke: (left: 2pt + ${blue}),\n  inset: 8pt,\n  width: 100%,\n)[\n  *${Note.}* ${}\n]\n',
    },
];

export interface SnippetParseResult {
    snippets: Snippet[];
    /** One message per rejected entry, for surfacing to the user. */
    errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/**
 * Read a user snippet file.
 *
 * Accepts either an array of entries or an object keyed by name — both are
 * shapes people reach for, and rejecting one over a formatting preference
 * would be pointless pedantry.
 */
export function parseUserSnippets(json: string): SnippetParseResult {
    const errors: string[] = [];
    if (!json.trim()) return { snippets: [], errors };

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        return { snippets: [], errors: [`snippets.json is not valid JSON: ${error}`] };
    }

    let raw: unknown[];
    if (Array.isArray(parsed)) {
        raw = parsed;
    } else if (parsed && typeof parsed === 'object') {
        // Object form: the key supplies the name, so entries need not repeat it.
        raw = Object.entries(parsed as Record<string, unknown>).map(([name, value]) =>
            value && typeof value === 'object' ? { name, ...value } : value
        );
    } else {
        return { snippets: [], errors: ['snippets.json must be an array or an object'] };
    }

    const snippets: Snippet[] = [];
    for (const [index, entry] of raw.entries()) {
        if (!entry || typeof entry !== 'object') {
            errors.push(`snippet ${index + 1} is not an object`);
            continue;
        }
        const candidate = entry as Record<string, unknown>;
        if (!isNonEmptyString(candidate.name)) {
            errors.push(`snippet ${index + 1} has no "name"`);
            continue;
        }
        if (!isNonEmptyString(candidate.body)) {
            errors.push(`snippet "${candidate.name}" has no "body"`);
            continue;
        }
        snippets.push({
            name: candidate.name,
            label: isNonEmptyString(candidate.label) ? candidate.label : candidate.name,
            description: isNonEmptyString(candidate.description)
                ? candidate.description
                : undefined,
            body: candidate.body,
        });
    }

    return { snippets, errors };
}

/**
 * Combine the built-in set with the user's.
 *
 * A user snippet with the same name replaces the built-in one, which is how a
 * user disagrees with a default without having to edit the app.
 */
export function mergeSnippets(
    builtin: readonly Snippet[],
    user: readonly Snippet[]
): Snippet[] {
    const byName = new Map<string, Snippet>();
    for (const snippet of builtin) byName.set(snippet.name, snippet);
    for (const snippet of user) byName.set(snippet.name, snippet);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A starter file to write when the user has no `snippets.json` yet. */
export function exampleSnippetFile(): string {
    return JSON.stringify(
        [
            {
                name: 'todo',
                label: 'todo',
                description: 'Inline TODO marker',
                body: '#text(fill: red)[TODO: ${}]',
            },
        ],
        null,
        2
    );
}
