// Window-level UI state that more than one component has to agree on.
//
// The sidebar's active section used to be local to `app-sidebar.svelte`, which
// was fine while only the sidebar's own footer buttons could change it. The
// command palette and "go to heading" both need to *reveal* a section from
// outside the sidebar, so the selection lives here instead.

export type SidebarSection =
    | 'files'
    | 'search'
    | 'outline'
    | 'diagnostics'
    | 'grammar'
    | 'history';

/** Which list the palette is showing. The user switches with a prefix
 *  character, the way VS Code does. */
export type PaletteMode = 'files' | 'commands' | 'outline';

class UiStore {
    sidebarSection = $state<SidebarSection>('files');

    /**
     * Bumped whenever something *outside* the sidebar asks for a section.
     *
     * The sidebar's open/closed state belongs to shadcn's `Sidebar.Provider`
     * context, which is only reachable from inside the provider — so this is
     * the signal the sidebar watches to know it should open itself. A counter
     * rather than a boolean because the same section can be requested twice in
     * a row and each request must still be seen.
     */
    sectionRequest = $state(0);

    /** The Typst symbol picker overlay. */
    symbolPickerOpen = $state(false);
    packageBrowserOpen = $state(false);

    paletteOpen = $state(false);
    paletteMode = $state<PaletteMode>('files');

    /** Reveal a sidebar section, opening the sidebar if it is collapsed. */
    showSection(section: SidebarSection): void {
        this.sidebarSection = section;
        this.sectionRequest++;
    }

    openPalette(mode: PaletteMode = 'files'): void {
        this.paletteMode = mode;
        this.paletteOpen = true;
    }

    closePalette(): void {
        this.paletteOpen = false;
    }

    togglePalette(mode: PaletteMode = 'files'): void {
        if (this.paletteOpen && this.paletteMode === mode) this.closePalette();
        else this.openPalette(mode);
    }
}

export const ui = new UiStore();
