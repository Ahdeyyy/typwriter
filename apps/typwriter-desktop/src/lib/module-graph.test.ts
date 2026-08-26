import { describe, expect, it } from 'bun:test';
import {
    computeDocumentScope,
    extractBibliographySources,
    extractImports,
    extractLetValues,
    extractModuleRefs,
    resolveModulePath,
    type FileScopeFacts,
} from './module-graph';

const str = (value: string) => ({ kind: 'str' as const, value });
const ident = (value: string) => ({ kind: 'ident' as const, value });

describe('extractModuleRefs', () => {
    it('is empty for empty input', () => {
        expect(extractModuleRefs('')).toEqual([]);
    });

    it('reads an include and an import', () => {
        const src = '#include "chapters/one.typ"\n#import "utils.typ": helpers\n';
        expect(extractModuleRefs(src)).toEqual([str('chapters/one.typ'), str('utils.typ')]);
    });

    it('reads a root-relative path', () => {
        expect(extractModuleRefs('#include "/lib/setup.typ"\n')).toEqual([
            str('/lib/setup.typ'),
        ]);
    });

    it('reads a variable-indirect include as an identifier', () => {
        expect(extractModuleRefs('#let chapter = "ch1.typ"\n#include chapter\n')).toEqual([
            ident('chapter'),
        ]);
    });

    it('ignores strings that are not module sources', () => {
        const src = [
            '#import "real.typ": *',
            '// #include "in-a-comment.typ"',
            '/* #include "in-block.typ" */',
            '```typ\n#include "in-raw.typ"\n```',
            '#let s = "just a string.typ"',
        ].join('\n');
        expect(extractModuleRefs(src)).toEqual([str('real.typ')]);
    });
});

describe('extractBibliographySources', () => {
    it('is empty for empty input', () => {
        expect(extractBibliographySources('')).toEqual([]);
    });

    it('reads a single positional source', () => {
        expect(extractBibliographySources('#bibliography("refs.bib", style: "ieee")')).toEqual([
            str('refs.bib'),
        ]);
    });

    it('reads the array form with several sources', () => {
        expect(
            extractBibliographySources('#bibliography(("a.bib", "refs.yml"))')
        ).toEqual([str('a.bib'), str('refs.yml')]);
    });

    it('reads identifier arguments awaiting resolution', () => {
        const src = [
            '#let refs = ("ref.bib", "ref.yml")',
            '#bibliography(refs, style: "ieee")',
        ].join('\n');
        expect(extractBibliographySources(src)).toEqual([ident('refs')]);
    });

    it('skips named arguments so style values are not mistaken for sources', () => {
        // `style: "ieee"` is a string too — only positional arguments count.
        expect(extractBibliographySources('#bibliography(style: "ieee")')).toEqual([]);
    });

    it('ignores other function calls', () => {
        expect(extractBibliographySources('#cite(<knuth>) #emph("x.bib")')).toEqual([]);
    });
});

describe('extractLetValues', () => {
    it('is empty for empty input', () => {
        expect(extractLetValues('')).toEqual({});
    });

    it('reads a string binding', () => {
        expect(extractLetValues('#let refs = "ref.bib"\n')).toEqual({
            refs: ['ref.bib'],
        });
    });

    it('reads an array-of-strings binding', () => {
        expect(
            extractLetValues('#let refs = ("ref.bib", "ref.yml")\n')
        ).toEqual({ refs: ['ref.bib', 'ref.yml'] });
    });

    it('skips non-literal bindings', () => {
        expect(
            extractLetValues([
                '#let n = 3',
                '#let f(x) = x',
                '#let computed = json("config.json").refs',
                '#let real = "actual.bib"',
            ].join('\n'))
        ).toEqual({ real: ['actual.bib'] });
    });

    it('lets the last binding shadow an earlier one', () => {
        expect(
            extractLetValues('#let refs = "old.bib"\n#let refs = "new.bib"\n')
        ).toEqual({ refs: ['new.bib'] });
    });

    it('ignores strings that are not let bindings', () => {
        expect(extractLetValues('// #let commented = "x"\n')).toEqual({});
    });
});

describe('extractImports', () => {
    it('is empty for empty input', () => {
        expect(extractImports('')).toEqual([]);
    });

    it('records named items', () => {
        expect(extractImports('#import "template.typ": conf, refs\n')).toEqual([
            { module: 'template.typ', name: 'conf', local: 'conf' },
            { module: 'template.typ', name: 'refs', local: 'refs' },
        ]);
    });

    it('records renames and star imports', () => {
        const src = [
            '#import "template.typ": bibliography as bib',
            '#import "all.typ": *',
        ].join('\n');
        expect(extractImports(src)).toEqual([
            { module: 'template.typ', name: 'bibliography', local: 'bib' },
            { module: 'all.typ', name: null, local: '*' },
        ]);
    });

    it('skips plain module imports without an item list', () => {
        expect(extractImports('#import "utils.typ"\n')).toEqual([]);
    });
});

describe('resolveModulePath', () => {
    it('resolves relative to the importing file', () => {
        expect(resolveModulePath('chapters/one.typ', 'two.typ')).toBe(
            'chapters/two.typ'
        );
    });

    it('resolves root-relative paths against the workspace root', () => {
        expect(resolveModulePath('chapters/one.typ', '/lib/setup.typ')).toBe(
            'lib/setup.typ'
        );
    });

    it('resolves from a root-level file without a directory', () => {
        expect(resolveModulePath('main.typ', 'chapters/one.typ')).toBe(
            'chapters/one.typ'
        );
    });

    it('rejects package imports', () => {
        expect(resolveModulePath('main.typ', '@preview/fletcher:0.5.8')).toBeNull();
    });

    it('rejects paths escaping the workspace', () => {
        expect(resolveModulePath('chapters/one.typ', '../../secrets.typ')).toBeNull();
    });

    it('rejects empty paths', () => {
        expect(resolveModulePath('main.typ', '')).toBeNull();
    });
});

describe('computeDocumentScope', () => {
    const facts = (
        moduleRefs: FileScopeFacts['moduleRefs'] = [],
        bibSources: FileScopeFacts['bibSources'] = [],
        extra: Partial<FileScopeFacts> = {}
    ): FileScopeFacts => ({
        moduleRefs,
        bibSources,
        letValues: {},
        imports: [],
        ...extra,
    });

    const project = new Map<string, FileScopeFacts>([
        ['main.typ', facts([str('chapters/one.typ')], [str('refs.bib')])],
        ['chapters/one.typ', facts([str('/lib/template.typ')], [])],
        ['lib/template.typ', facts([], [str('assets/extra.yml')])],
        ['orphan.typ', facts([], [str('orphan.yml')])],
    ]);
    const factsFor = (path: string) => project.get(path) ?? null;

    it('unions bibliography sources across the reachable set', () => {
        const scope = computeDocumentScope('main.typ', factsFor);
        expect(scope.reachableFiles).toEqual(
            new Set(['main.typ', 'chapters/one.typ', 'lib/template.typ'])
        );
        expect(scope.scopedBibPaths).toEqual(
            new Set(['refs.bib', 'lib/assets/extra.yml'])
        );
    });

    it('excludes bibliographies of unreachable files', () => {
        const scope = computeDocumentScope('main.typ', factsFor);
        expect(scope.scopedBibPaths.has('orphan.yml')).toBe(false);
    });

    it('drops keys when the buffer removes a bibliography call', () => {
        // The open buffer no longer cites extra.yml — its keys must vanish.
        const edited = new Map(project);
        edited.set('lib/template.typ', facts());
        const scope = computeDocumentScope('main.typ', (p) => edited.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['refs.bib']));
    });

    it('shrinks reachability when an include disappears', () => {
        const edited = new Map(project);
        edited.set('chapters/one.typ', facts());
        const scope = computeDocumentScope('main.typ', (p) => edited.get(p) ?? null);
        expect(scope.reachableFiles).toEqual(new Set(['main.typ', 'chapters/one.typ']));
    });

    it('prefers buffer facts over a stale disk copy', () => {
        const diskOnly = (p: string) => (p === 'main.typ' ? facts([], [str('old.bib')]) : null);
        const layered = (p: string) =>
            p === 'main.typ' ? facts([], [str('new.bib')]) : diskOnly(p);
        const scope = computeDocumentScope('main.typ', layered);
        expect(scope.scopedBibPaths).toEqual(new Set(['new.bib']));
    });

    it('offers nothing without a main file — no fallback to everything', () => {
        const scope = computeDocumentScope(null, factsFor);
        expect(scope.reachableFiles.size).toBe(0);
        expect(scope.scopedBibPaths.size).toBe(0);
    });

    it('offers nothing when the main file is unknown to the lookup', () => {
        const scope = computeDocumentScope('ghost.typ', factsFor);
        expect(scope.reachableFiles.size).toBe(0);
        expect(scope.scopedBibPaths.size).toBe(0);
    });

    it('seeds the active file so an unreachable chapter keeps its own labels', () => {
        const scope = computeDocumentScope('main.typ', factsFor, ['orphan.typ']);
        expect(scope.reachableFiles.has('orphan.typ')).toBe(true);
        // ...but its bibliography does not join global citation scope.
        expect(scope.scopedBibPaths.has('orphan.yml')).toBe(false);
    });

    it('rebuilds scope per item when a refs array changes', () => {
        const edited = new Map(project);
        // Array in template.typ grows from one entry to two.
        edited.set(
            'lib/template.typ',
            facts([], [str('assets/extra.yml'), str('more.bib')])
        );
        let scope = computeDocumentScope('main.typ', (p) => edited.get(p) ?? null);
        expect(scope.scopedBibPaths.has('lib/assets/extra.yml')).toBe(true);
        expect(scope.scopedBibPaths.has('lib/more.bib')).toBe(true);

        // Removing an item drops exactly that item's path.
        edited.set('lib/template.typ', facts());
        scope = computeDocumentScope('main.typ', (p) => edited.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['refs.bib']));
    });

    // ─── Variable-indirect sources ─────────────────────────────────────────

    it('resolves a single-string #let through the call-site identifier', () => {
        // The exact pattern from the bug report, variant 1:
        //   #let refs = "ref.bib"
        //   #bibliography(refs, style: "ieee")
        const project2 = new Map<string, FileScopeFacts>([
            [
                'main.typ',
                facts([], [ident('refs')], { letValues: { refs: ['ref.bib'] } }),
            ],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['ref.bib']));
    });

    it('resolves an array-valued #let item by item', () => {
        // Variant 2:
        //   #let refs = ("ref.bib", "ref.yml")
        //   #bibliography(refs, style: "ieee")
        const project2 = new Map<string, FileScopeFacts>([
            [
                'main.typ',
                facts([], [ident('refs')], {
                    letValues: { refs: ['ref.bib', 'ref.yml'] },
                }),
            ],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['ref.bib', 'ref.yml']));
    });

    it('rebuilds when an array-bound #let gains or loses an item', () => {
        const project2 = new Map<string, FileScopeFacts>();
        project2.set('main.typ', facts([], [ident('refs')], {
            letValues: { refs: ['a.bib'] },
        }));
        const factsFor2 = (p: string) => project2.get(p) ?? null;

        // Item added to the array literal.
        project2.set('main.typ', facts([], [ident('refs')], {
            letValues: { refs: ['a.bib', 'b.yml'] },
        }));
        expect(computeDocumentScope('main.typ', factsFor2).scopedBibPaths).toEqual(
            new Set(['a.bib', 'b.yml'])
        );

        // Item removed again — only the remaining one stays offered.
        project2.set('main.typ', facts([], [ident('refs')], {
            letValues: { refs: ['b.yml'] },
        }));
        expect(computeDocumentScope('main.typ', factsFor2).scopedBibPaths).toEqual(
            new Set(['b.yml'])
        );
    });

    it('follows imports to resolve a name defined in another file', () => {
        // The common template setup: main imports the name from template.typ,
        // where the array is bound.
        const project2 = new Map<string, FileScopeFacts>([
            ['main.typ', facts([str('template.typ')], [ident('refs')], {
                imports: [{ module: 'template.typ', name: 'refs', local: 'refs' }],
            })],
            ['template.typ', facts([], [], { letValues: { refs: ['shared.bib'] } })],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['shared.bib']));
    });

    it('applies import renames (`a as b`)', () => {
        const project2 = new Map<string, FileScopeFacts>([
            ['main.typ', facts([], [ident('sources')], {
                imports: [{ module: 't.typ', name: 'refs', local: 'sources' }],
            })],
            ['t.typ', facts([], [], { letValues: { refs: ['r.bib'] } })],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['r.bib']));
    });

    it('expands star imports against the target file’s bindings', () => {
        const project2 = new Map<string, FileScopeFacts>([
            ['main.typ', facts([str('t.typ')], [ident('refs')], {
                imports: [{ module: 't.typ', name: null, local: '*' }],
            })],
            ['t.typ', facts([], [], { letValues: { refs: ['r.bib'] } })],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['r.bib']));
    });

    it('resolves variable-indirect includes for reachability', () => {
        const project2 = new Map<string, FileScopeFacts>([
            ['main.typ', facts([ident('chapterFile')], [] , {
                letValues: { chapterFile: ['chapters/one.typ'] },
            })],
            ['chapters/one.typ', facts([], [str('one.bib')])],
        ]);
        const scope = computeDocumentScope('main.typ', (p) => project2.get(p) ?? null);
        expect(scope.reachableFiles.has('chapters/one.typ')).toBe(true);
        expect(scope.scopedBibPaths.has('chapters/one.bib')).toBe(true);
    });

    it('leaves unresolvable identifiers silent instead of guessing', () => {
        // Computed / unknown values cannot be seen statically; they contribute
        // no paths rather than wrong ones.
        const project2 = new Map<string, FileScopeFacts>([
            ['main.typ', facts([], [ident('mystery')], {})],
        ]);
        expect(computeDocumentScope('main.typ', (p) => project2.get(p) ?? null).scopedBibPaths.size).toBe(0);
    });

    it('survives binding/import cycles', () => {
        const cyclic = new Map<string, FileScopeFacts>([
            ['a.typ', facts([str('b.typ')], [ident('refs')], {
                imports: [{ module: 'b.typ', name: 'refs', local: 'refs' }],
            })],
            ['b.typ', facts([str('a.typ')], [], {
                letValues: { refs: ['b.bib'] },
                imports: [{ module: 'a.typ', name: 'refs', local: 'refs' }],
            })],
        ]);
        const scope = computeDocumentScope('a.typ', (p) => cyclic.get(p) ?? null);
        expect(scope.scopedBibPaths).toEqual(new Set(['b.bib']));
        expect(scope.reachableFiles).toEqual(new Set(['a.typ', 'b.typ']));
    });

    it('tolerates a reachable file whose facts have not loaded yet', () => {
        // During early workspace open, the main file's buffer is available but
        // included files may not have been read from disk yet — factsFor
        // returns null for them. The scope computation must not crash.
        const partial = new Map<string, FileScopeFacts>([
            ['main.typ', facts([str('chapter.typ')], [str('refs.bib')])],
            // chapter.typ is NOT in the map — simulates an unloaded file.
        ]);
        const scope = computeDocumentScope('main.typ', (p) => partial.get(p) ?? null);
        // The main file's own bibliography is still found.
        expect(scope.scopedBibPaths).toEqual(new Set(['refs.bib']));
        // chapter.typ is reachable even though its facts are unknown.
        expect(scope.reachableFiles.has('chapter.typ')).toBe(true);
    });
});
