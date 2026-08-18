// Snippets: a starter set of Typst boilerplate, plus whatever the user adds.
//
// Bodies are written in CodeMirror's snippet syntax — `${}` is a tab stop and
// `${name}` is a named placeholder — which is the same syntax the existing
// typst-ide completions are converted into, so the two feel identical once
// inserted.
//
// Snippets come from three layers, most specific winning: the built-ins below,
// an app-wide set that follows the user, and a per-project set in the
// workspace's `.typwriter/snippets.json` so it travels with the document.
//
// Both writable layers are editable in-app. The project file stays plain JSON
// anyway, so it can be reviewed and committed like any other project asset —
// and because it can therefore be hand-edited, parsing is deliberately
// forgiving: one malformed entry reports itself and the rest still load.

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
 * Where a snippet came from, in increasing order of precedence.
 *
 * `builtin` ships with the app, `app` follows the user across every project,
 * and `project` lives in the workspace and travels with it. Shown in the editor
 * so it is obvious why a name resolves the way it does.
 */
export type SnippetScope = 'builtin' | 'app' | 'project';

export interface ResolvedSnippet extends Snippet {
    scope: SnippetScope;
    /** Set when this entry shadows one from a lower scope. */
    overrides?: SnippetScope;
}

/**
 * Layer the three sources into the active set.
 *
 * More specific wins: a project snippet beats an app-wide one, which beats a
 * built-in. That ordering is what makes a name overridable at all — it is how
 * someone disagrees with a default without editing the app, and how one project
 * can disagree with their own global set.
 */
export function resolveSnippets(
    builtin: readonly Snippet[],
    app: readonly Snippet[],
    project: readonly Snippet[]
): ResolvedSnippet[] {
    const byName = new Map<string, ResolvedSnippet>();

    const layer = (snippets: readonly Snippet[], scope: SnippetScope) => {
        for (const snippet of snippets) {
            const shadowed = byName.get(snippet.name);
            byName.set(snippet.name, {
                ...snippet,
                scope,
                // Only record a shadow when the scope actually differs;
                // a duplicate within one layer is not an override.
                overrides:
                    shadowed && shadowed.scope !== scope ? shadowed.scope : shadowed?.overrides,
            });
        }
    };

    layer(builtin, 'builtin');
    layer(app, 'app');
    layer(project, 'project');

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Serialise snippets for storage — the array form, stably ordered. */
export function serializeSnippets(snippets: readonly Snippet[]): string {
    const ordered = [...snippets].sort((a, b) => a.name.localeCompare(b.name));
    return JSON.stringify(
        ordered.map((snippet) => ({
            name: snippet.name,
            label: snippet.label,
            ...(snippet.description ? { description: snippet.description } : {}),
            body: snippet.body,
        })),
        null,
        2
    );
}

/**
 * Validate a snippet the user is authoring.
 *
 * Returns a field-keyed map of problems so the editor can mark the offending
 * input rather than showing one opaque message.
 */
export function validateSnippet(
    draft: { name: string; body: string },
    existingNames: readonly string[] = []
): Partial<Record<'name' | 'body', string>> {
    const problems: Partial<Record<'name' | 'body', string>> = {};
    const name = draft.name.trim();

    if (!name) {
        problems.name = 'Give the snippet a name to type.';
    } else if (/\s/.test(name)) {
        // The completion matches on the typed word, which cannot contain a space.
        problems.name = 'Names cannot contain spaces.';
    } else if (existingNames.some((existing) => existing === name)) {
        problems.name = 'A snippet with this name already exists in this scope.';
    }

    if (!draft.body.trim()) problems.body = 'Give the snippet a body to insert.';

    return problems;
}

/** Insert or replace `snippet` by name, keeping the list sorted. */
export function upsertSnippet(
    snippets: readonly Snippet[],
    snippet: Snippet,
    /** Name being replaced, when the editor renamed it. */
    replacing?: string
): Snippet[] {
    const drop = new Set([snippet.name, ...(replacing ? [replacing] : [])]);
    const kept = snippets.filter((existing) => !drop.has(existing.name));
    return [...kept, snippet].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeSnippet(snippets: readonly Snippet[], name: string): Snippet[] {
    return snippets.filter((snippet) => snippet.name !== name);
}

