import type { SerializedDiagnostic } from '$lib/types';
import { onCompileDiagnostics, type UnlistenFn } from '$lib/ipc/events';
import { logError } from '$lib/logger';

class DiagnosticsStore {
    errors   = $state<SerializedDiagnostic[]>([]);
    warnings = $state<SerializedDiagnostic[]>([]);
    paneOpen = $state(false);

    /** When true, tinymist owns diagnostics: the Rust compile-pipeline stream is
     *  ignored and `errors`/`warnings` are recomputed from `_lspByFile`. */
    lspActive = $state(false);
    private _lspByFile = new Map<string, SerializedDiagnostic[]>();

    togglePane() { this.paneOpen = !this.paneOpen; }

    private _unlisten: UnlistenFn | null = null;

    async init(): Promise<void> {
        const result = await onCompileDiagnostics(({ errors, warnings }) => {
            // While the LSP is active, compile-pipeline diagnostics are ignored.
            if (this.lspActive) return;
            this.errors   = errors;
            this.warnings = warnings;
        });
        if (result.isOk()) this._unlisten = result.value;
        else logError('diagnostics: listener failed:', result.error);
    }

    /** Toggle the diagnostics source. Clears stale diagnostics on both edges:
     *  turning on drops compile diagnostics, turning off drops LSP diagnostics
     *  (the next compile event repopulates them). */
    setLspActive(active: boolean): void {
        if (active === this.lspActive) return;
        this.lspActive = active;
        this._lspByFile.clear();
        this.errors = [];
        this.warnings = [];
    }

    /** Replace (or, when empty, clear) one file's LSP diagnostics — matching how
     *  `publishDiagnostics` clears a file with an empty array. */
    setLspDiagnostics(filePath: string, diags: SerializedDiagnostic[]): void {
        if (!this.lspActive) return;
        if (diags.length === 0) this._lspByFile.delete(filePath);
        else this._lspByFile.set(filePath, diags.map((d) => ({ ...d, file_path: filePath })));
        this._recomputeFromLsp();
    }

    private _recomputeFromLsp(): void {
        const errors: SerializedDiagnostic[] = [];
        const warnings: SerializedDiagnostic[] = [];
        for (const diags of this._lspByFile.values()) {
            for (const d of diags) {
                if (d.severity === 'error') errors.push(d);
                else warnings.push(d);
            }
        }
        this.errors = errors;
        this.warnings = warnings;
    }

    destroy(): void {
        this._unlisten?.();
        this._unlisten = null;
        this.errors = [];
        this.warnings = [];
        this._lspByFile.clear();
    }
}

export const diagnostics = new DiagnosticsStore();
