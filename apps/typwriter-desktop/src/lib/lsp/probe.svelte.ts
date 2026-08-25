// What we know about the installed `tinymist` CLI.
//
// Split out of `client.svelte.ts` on purpose: that module owns the
// `@codemirror/lsp-client` machinery, so importing it costs ~330 KB of
// CodeMirror. Settings › Editor only wants the probe's answer — is tinymist on
// PATH, which version, does its Typst match ours — and the settings window has
// no editor in it. Keeping the two apart is what lets that window skip the
// whole CodeMirror graph.

import { lspProbe } from '$lib/ipc/commands';
import { logError, logInfo } from '$lib/logger';

class LspProbeStore {
    /** Whether the `tinymist` CLI is installed. `null` until the first probe
     *  resolves — the settings indicator shows "checking" for that window. */
    isInstalled = $state<boolean | null>(null);
    /** tinymist's own release version, when the probe could read it. */
    installedVersion = $state<string | null>(null);
    /** The Typst version tinymist embeds — it compiles with its own copy, not
     *  ours, so its answers can diverge from what the app actually renders. */
    installedTypstVersion = $state<string | null>(null);
    /** The Typst version this app compiles with. */
    bundledTypstVersion = $state<string | null>(null);
    /** `false` when tinymist's Typst differs from ours; `null` while unknown
     *  (not probed yet, or tinymist reported no Typst version). */
    typstCompatible = $state<boolean | null>(null);
    /** True while a probe is in flight (drives the indicator's refresh spinner). */
    probing = $state(false);

    /** tinymist is installed but built against a different Typst than ours, so
     *  completions/hovers/diagnostics may not match what the app compiles. */
    readonly typstMismatch = $derived(this.isInstalled === true && this.typstCompatible === false);

    /** Forget everything the last probe told us about tinymist's build. */
    clearVersions(): void {
        this.installedVersion = null;
        this.installedTypstVersion = null;
        this.typstCompatible = null;
    }

    /** Ask the backend whether the tinymist CLI is on `PATH`. Cheap (one
     *  `--version` run) and safe to call whenever the settings page opens; the
     *  user may install tinymist without restarting the app. */
    async probeInstalled(): Promise<void> {
        if (this.probing) return;
        this.probing = true;
        const result = await lspProbe();
        this.probing = false;
        result.match(
            ({ available, version, typstVersion, bundledTypstVersion, typstCompatible }) => {
                this.isInstalled = available;
                this.installedVersion = version;
                this.installedTypstVersion = typstVersion;
                this.bundledTypstVersion = bundledTypstVersion;
                this.typstCompatible = typstCompatible;
                if (available && typstCompatible === false) {
                    logInfo(
                        `tinymist targets Typst ${typstVersion} but this app bundles Typst ${bundledTypstVersion}; language-server results may not match`,
                    );
                }
            },
            (err) => {
                logError('tinymist probe failed:', err);
                this.isInstalled = false;
                this.clearVersions();
            },
        );
    }
}

export const lspProbeState = new LspProbeStore();
