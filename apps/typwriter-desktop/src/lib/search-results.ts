// Shaping search hits for display.
//
// Rust returns a flat, file-ordered list; the panel shows it grouped by file
// with a collapsible header. Grouping lives here rather than in the component
// so it can be tested.

import type { SearchHit } from '$lib/types';

export interface HitGroup {
    /** Workspace-relative path, the group's identity. */
    path: string;
    /** Basename, shown as the header. */
    name: string;
    /** Directory portion, shown dimmed beside it. Empty at the root. */
    dir: string;
    hits: SearchHit[];
}

/**
 * Group hits by file, preserving the order Rust returned.
 *
 * Insertion order matters: the backend already sorts by path then line, so
 * preserving it keeps the panel stable and avoids re-sorting a list that may
 * hold thousands of rows.
 */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
    const groups = new Map<string, HitGroup>();

    for (const hit of hits) {
        let group = groups.get(hit.path);
        if (!group) {
            const slash = hit.path.lastIndexOf('/');
            group = {
                path: hit.path,
                name: slash === -1 ? hit.path : hit.path.slice(slash + 1),
                dir: slash === -1 ? '' : hit.path.slice(0, slash),
                hits: [],
            };
            groups.set(hit.path, group);
        }
        group.hits.push(hit);
    }

    return [...groups.values()];
}

/** Total hits across groups — what the summary line reports. */
export function totalHits(groups: readonly HitGroup[]): number {
    return groups.reduce((sum, group) => sum + group.hits.length, 0);
}
