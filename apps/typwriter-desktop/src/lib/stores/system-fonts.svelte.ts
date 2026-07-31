// Font families installed on the user's device.
//
// These come from an OS font scan on the Rust side and are offered in the
// settings pickers *in addition to* the families Typwriter bundles. Only fonts
// installed at the OS level are listed: the WebView resolves those by name,
// whereas Typst's embedded fonts and the user's custom font directories are
// only known to the compiler, so picking one for the interface would silently
// fall back to a generic family.

import { ResultAsync, okAsync } from 'neverthrow';
import { listSystemFontFamilies, type SystemFontFamily } from '$lib/ipc/commands';
import { logError } from '$lib/logger';

/** A labelled section of a font picker. */
export interface FontGroup {
    label: string;
    families: readonly string[];
}

class SystemFontsStore {
    families = $state<SystemFontFamily[]>([]);
    loading = $state(false);
    /** `true` once a scan has come back — even if it found nothing. */
    loaded = $state(false);
    error = $state<string | null>(null);

    /** All installed families, sorted case-insensitively by the backend. */
    get names(): string[] {
        return this.families.map((f) => f.name);
    }

    get monospaceNames(): string[] {
        return this.families.filter((f) => f.monospace).map((f) => f.name);
    }

    get proportionalNames(): string[] {
        return this.families.filter((f) => !f.monospace).map((f) => f.name);
    }

    /** Fetch the installed families once. Safe to call from every pane that
     *  shows a picker — repeat calls after the first are a no-op. */
    load(): ResultAsync<void, string> {
        if (this.loaded || this.loading) return okAsync(undefined);
        this.loading = true;
        return listSystemFontFamilies()
            .map((families) => {
                this.families = families;
                this.loaded = true;
                this.loading = false;
                this.error = null;
            })
            .mapErr((err) => {
                this.loading = false;
                this.error = err;
                logError('systemFonts.load failed:', err);
                return err;
            });
    }
}

export const systemFonts = new SystemFontsStore();

/** Drop installed families that Typwriter already bundles, so a name never
 *  shows up in two groups of the same picker. */
export function withoutBundled(names: readonly string[], bundled: readonly string[]): string[] {
    const seen = new Set(bundled.map((f) => f.toLowerCase()));
    return names.filter((name) => !seen.has(name.toLowerCase()));
}
