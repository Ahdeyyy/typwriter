import { EditorView, ViewPlugin } from '@codemirror/view';

/** Keep assistive-technology navigation out of CodeMirror's keymaps. Printable
 * AltGr input must still reach the editor on international keyboard layouts. */
export function isAssistiveNavigation(event: KeyboardEvent): boolean {
    return event.ctrlKey && event.altKey && !event.metaKey &&
        !event.getModifierState('AltGraph') && event.key.length > 1;
}

export function editorAccessibility(enabled: boolean, label: string, descriptionId: string) {
    return [
        EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-describedby': descriptionId,
        }),
        ViewPlugin.define((view) => {
            view.setTabFocusMode(enabled);
            // Capture before the contentDOM key handler. Stop propagation only:
            // browser/assistive-technology defaults remain available.
            const reserveNavigation = (event: KeyboardEvent) => {
                if (enabled && isAssistiveNavigation(event)) event.stopPropagation();
            };
            view.dom.addEventListener('keydown', reserveNavigation, true);
            return {
                destroy() {
                    view.dom.removeEventListener('keydown', reserveNavigation, true);
                    view.setTabFocusMode(false);
                },
            };
        }),
    ];
}
