// Turning a registry entry into the line a user actually wants in their file.
//
// Small, but it is the part of the package browser that can be wrong in a way
// the user has to debug, so it is separated out and tested rather than inlined
// in the component.

/** Semver-ish comparison for the registry's `major.minor.patch` strings. */
export function compareVersions(a: string, b: string): number {
    const parse = (version: string) =>
        version.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** Newest version from a list, or undefined when the list is empty. */
export function latestVersion(versions: readonly string[]): string | undefined {
    if (versions.length === 0) return undefined;
    return [...versions].sort(compareVersions).at(-1);
}

/**
 * The `#import` line for a package.
 *
 * Typst requires the version in the spec — `@preview/cetz` alone does not
 * resolve — so it is always written out. `: *` pulls the package's exports into
 * scope, which is what almost every package's own README shows first; narrowing
 * the import list is an edit the user can make afterwards, and is much easier
 * than working out the syntax from scratch.
 */
export function importLineFor(namespace: string, name: string, version: string): string {
    return `#import "@${namespace}/${name}:${version}": *\n`;
}
