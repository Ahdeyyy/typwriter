// Named export configurations, persisted app-wide.
//
// App-wide rather than per-project because a preset encodes *how you publish*
// — "camera-ready PDF/A", "web PNGs at 288 DPI" — which is a habit that follows
// the person across documents.

import {
    normalizePresetList,
    removePreset as removeFrom,
    upsertPreset as upsertInto,
    type ExportPreset,
} from '$lib/export-presets';
import { getExportPresets, setExportPresets } from '$lib/ipc/commands';
import { logError } from '$lib/logger';

class ExportPresetStore {
    presets = $state<ExportPreset[]>([]);
    loaded = $state(false);

    /** Name of the preset last applied, for showing which one is active. */
    activeName = $state<string | null>(null);

    async load(): Promise<void> {
        const result = await getExportPresets();
        result.match(
            (value) => {
                // Whatever is on disk is validated and repaired here rather
                // than trusted — it may have been written by another version.
                this.presets = normalizePresetList(value);
                this.loaded = true;
            },
            (err) => {
                logError('export presets: load failed:', err);
                this.presets = [];
                this.loaded = true;
            }
        );
    }

    /** Save or replace a preset by name, then persist. */
    async save(preset: ExportPreset): Promise<void> {
        this.presets = upsertInto(this.presets, preset);
        this.activeName = preset.name;
        await this.persist();
    }

    async remove(name: string): Promise<void> {
        this.presets = removeFrom(this.presets, name);
        if (this.activeName?.toLowerCase() === name.toLowerCase()) this.activeName = null;
        await this.persist();
    }

    private async persist(): Promise<void> {
        const result = await setExportPresets(this.presets);
        result.mapErr((err) => logError('export presets: save failed:', err));
    }
}

export const exportPresets = new ExportPresetStore();
