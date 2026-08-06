// Cross-cutting search for the settings window.
//
// There is deliberately no hand-written index of settings: the panes *are* the
// index. Every `SettingRow` — and every `SettingMatch` block, for the chunks of
// a pane that aren't rows — decides for itself whether it matches the current
// query, hides when it doesn't, and reports a hit so the nav can show counts
// and groups with nothing to show can drop out of the page. Adding a setting
// therefore makes it searchable with no extra bookkeeping; the only thing worth
// adding by hand is `keywords`, for synonyms the visible copy doesn't contain.
//
// The text matching itself lives in `search-text.ts` (no runes, unit-tested).

import { getContext, setContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { queryTerms, textMatches, type Haystack } from './search-text';

export class SettingsSearch {
    query = $state('');

    /** Lowercased query words; every one has to appear for an item to match. */
    readonly terms = $derived(queryTerms(this.query));

    readonly active = $derived(this.terms.length > 0);

    /** group id → keys of the items matching inside it. */
    #hits = new SvelteMap<string, SvelteSet<string>>();
    /** Groups whose own title / description / keywords matched the query. */
    #groupMatches = new SvelteSet<string>();

    readonly hasResults = $derived.by(() => {
        if (this.#groupMatches.size > 0) return true;
        for (const keys of this.#hits.values()) {
            if (keys.size > 0) return true;
        }
        return false;
    });

    /** True when every query word appears somewhere in `text`. Always false
     *  while the box is empty — "not searching" is a separate case for callers,
     *  since then everything is visible regardless. */
    matches(...text: Haystack[]): boolean {
        return textMatches(this.terms, text);
    }

    setHit(group: string, key: string, hit: boolean) {
        let keys = this.#hits.get(group);
        if (!keys) {
            if (!hit) return;
            keys = new SvelteSet();
            this.#hits.set(group, keys);
        }
        if (hit) keys.add(key);
        else keys.delete(key);
    }

    hitCount(group: string): number {
        return this.#hits.get(group)?.size ?? 0;
    }

    setGroupMatch(group: string, matched: boolean) {
        if (matched) this.#groupMatches.add(group);
        else this.#groupMatches.delete(group);
    }

    /** Did the group's own heading match? Then everything inside it stays
     *  visible — searching "grammar" should show the whole Grammar pane, not
     *  just the rows that happen to repeat the word. */
    groupMatched(group: string): boolean {
        return this.#groupMatches.has(group);
    }

    /** Does this group have anything to show for the current query? */
    groupVisible(group: string): boolean {
        return !this.active || this.groupMatched(group) || this.hitCount(group) > 0;
    }

    clear() {
        this.query = '';
    }
}

const SEARCH_KEY = Symbol('settings-search');
const GROUP_KEY = Symbol('settings-group');
const FORCED_KEY = Symbol('settings-forced-visible');

/** Stand-in for components rendered outside the settings window, so they don't
 *  have to care whether a search exists. It never goes active. */
const INERT = new SettingsSearch();

export function setSettingsSearch(search: SettingsSearch) {
    setContext(SEARCH_KEY, search);
}

export function getSettingsSearch(): SettingsSearch {
    return getContext<SettingsSearch | undefined>(SEARCH_KEY) ?? INERT;
}

export function setSettingsGroupId(id: string) {
    setContext(GROUP_KEY, id);
}

export function getSettingsGroupId(): string {
    return getContext<string | undefined>(GROUP_KEY) ?? 'unknown';
}

/** Publish "this whole subtree already counts as a match" to descendants. A
 *  group sets it when its heading matched; a `SettingMatch` sets it when its
 *  block did, so the rows inside a matched block aren't filtered a second
 *  time. */
export function setForcedVisible(forced: () => boolean) {
    setContext(FORCED_KEY, forced);
}

export function getForcedVisible(): () => boolean {
    return getContext<(() => boolean) | undefined>(FORCED_KEY) ?? (() => false);
}

let itemSeq = 0;

/** Report an item's match state to the group it lives in. Call during
 *  component init; the item stays registered for as long as it is mounted. */
export function reportSettingHit(matched: () => boolean): void {
    const search = getSettingsSearch();
    const group = getSettingsGroupId();
    const key = `item-${++itemSeq}`;
    $effect(() => {
        search.setHit(group, key, search.active && matched());
        return () => search.setHit(group, key, false);
    });
}

export { highlightSegments } from './search-text';
