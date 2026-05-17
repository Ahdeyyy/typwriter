import type { EditorView } from '@codemirror/view';
import {
    SearchQuery,
    setSearchQuery,
    findNext,
    findPrevious,
    replaceNext,
    replaceAll,
} from '@codemirror/search';

/**
 * Counting every match in a huge document blocks the main thread, but users
 * only need a rough sense of "how many" beyond a small ceiling — they navigate
 * with next/prev, not by jumping to "match #3217 of 9842". Cap counting and
 * raise the `totalMatchesCapped` flag so the UI can render "5000+".
 */
const MAX_MATCH_COUNT = 5000;

class EditorSearchStore {
    open = $state(false);
    replaceVisible = $state(false);
    query = $state('');
    replace = $state('');
    caseSensitive = $state(false);
    wholeWord = $state(false);
    regex = $state(false);
    regexError = $state<string | null>(null);
    totalMatches = $state(0);
    totalMatchesCapped = $state(false);
    currentMatch = $state(0);

    private _view: EditorView | null = null;

    setActiveView(view: EditorView | null) {
        this._view = view;
        if (view && this.open) this.applyQuery();
    }

    getActiveView(): EditorView | null {
        return this._view;
    }

    openPanel(withReplace = false) {
        const view = this._view;
        if (view) {
            const sel = view.state.selection.main;
            if (!sel.empty && sel.to - sel.from < 200) {
                const text = view.state.doc.sliceString(sel.from, sel.to);
                if (!text.includes('\n')) this.query = text;
            }
        }
        if (withReplace) this.replaceVisible = true;
        this.open = true;
        this.applyQuery();
    }

    closePanel() {
        this.open = false;
        const view = this._view;
        if (view) {
            view.dispatch({
                effects: setSearchQuery.of(new SearchQuery({ search: '' })),
            });
            view.focus();
        }
    }

    toggleReplace() {
        this.replaceVisible = !this.replaceVisible;
    }

    /** Ctrl/Cmd+H semantics: if the panel is closed, open it with replace
     *  visible; if it's already open, toggle the replace row. */
    toggleReplacePanel() {
        if (this.open) {
            this.toggleReplace();
        } else {
            this.openPanel(true);
        }
    }

    /** Ctrl/Cmd+F semantics: toggle the panel open/closed. */
    toggleFindPanel() {
        if (this.open) {
            this.closePanel();
        } else {
            this.openPanel(false);
        }
    }

    setQuery(q: string) {
        this.query = q;
        this.applyQuery();
    }

    setReplace(r: string) {
        this.replace = r;
        this.applyQuery();
    }

    toggleCaseSensitive() {
        this.caseSensitive = !this.caseSensitive;
        this.applyQuery();
    }

    toggleWholeWord() {
        this.wholeWord = !this.wholeWord;
        this.applyQuery();
    }

    toggleRegex() {
        this.regex = !this.regex;
        this.applyQuery();
    }

    private buildQuery(): SearchQuery {
        return new SearchQuery({
            search: this.query,
            replace: this.replace,
            caseSensitive: this.caseSensitive,
            wholeWord: this.wholeWord,
            regexp: this.regex,
        });
    }

    applyQuery() {
        const view = this._view;
        if (!view) return;
        const q = this.buildQuery();
        view.dispatch({ effects: setSearchQuery.of(q) });
        this.refreshCounts();
    }

    refreshCounts() {
        const view = this._view;
        if (!view || !this.query) {
            this.totalMatches = 0;
            this.totalMatchesCapped = false;
            this.currentMatch = 0;
            this.regexError = null;
            return;
        }
        const q = this.buildQuery();
        if (!q.valid) {
            this.totalMatches = 0;
            this.totalMatchesCapped = false;
            this.currentMatch = 0;
            this.regexError = this.regex ? 'Invalid regular expression' : null;
            return;
        }
        this.regexError = null;
        const cursor = q.getCursor(view.state);
        const sel = view.state.selection.main;
        let count = 0;
        let current = 0;
        let capped = false;
        let item = cursor.next();
        while (!item.done) {
            count++;
            if (item.value.from === sel.from && item.value.to === sel.to) {
                current = count;
            }
            if (count >= MAX_MATCH_COUNT) {
                // Keep scanning a tiny bit further only if we still need to
                // locate the current selection's match index; otherwise stop.
                if (current > 0) {
                    capped = true;
                    break;
                }
            }
            item = cursor.next();
        }
        this.totalMatches = count;
        this.totalMatchesCapped = capped;
        this.currentMatch = current;
    }

    next() {
        const view = this._view;
        if (!view || !this.query) return;
        findNext(view);
        this.refreshCounts();
    }

    prev() {
        const view = this._view;
        if (!view || !this.query) return;
        findPrevious(view);
        this.refreshCounts();
    }

    replaceCurrent() {
        const view = this._view;
        if (!view || !this.query) return;
        replaceNext(view);
        this.refreshCounts();
    }

    replaceAllMatches() {
        const view = this._view;
        if (!view || !this.query) return;
        replaceAll(view);
        this.refreshCounts();
    }
}

export const editorSearch = new EditorSearchStore();
