import type { SerializedDiagnostic } from '$lib/types';
import { onCompileDiagnostics, type UnlistenFn } from '$lib/ipc/events';

class DiagnosticsStore {
    errors   = $state<SerializedDiagnostic[]>([]);
    warnings = $state<SerializedDiagnostic[]>([]);

    private _unlisten: UnlistenFn | null = null;

    async init(): Promise<void> {
        const result = await onCompileDiagnostics(({ errors, warnings }) => {
            this.errors   = errors;
            this.warnings = warnings;
        });
        if (result.isOk()) this._unlisten = result.value;
        else console.error('diagnostics: listener failed:', result.error);
    }

    destroy(): void {
        this._unlisten?.();
        this._unlisten = null;
    }
}

export const diagnostics = new DiagnosticsStore();
