import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { editorAccessibility } from '../../src/lib/codemirror/accessibility';

const accessibility = new Compartment();
const view = new EditorView({
    parent: document.getElementById('editor')!,
    state: EditorState.create({
        doc: 'Hello',
        extensions: [
            accessibility.of(editorAccessibility(false, 'Test source editor', 'help')),
            keymap.of([
                indentWithTab,
                { key: 'Ctrl-Alt-ArrowDown', run: () => { calls++; return true; } },
                { key: 'Ctrl-Alt-a', run: () => { altGrCalls++; return true; } },
            ]),
        ],
    }),
});
let calls = 0;
let altGrCalls = 0;
const mode = document.getElementById('mode') as HTMLInputElement;
function setMode(enabled: boolean) {
    mode.checked = enabled;
    view.dispatch({ effects: accessibility.reconfigure(editorAccessibility(enabled, 'Test source editor', 'help')) });
}
mode.addEventListener('change', () => setMode(mode.checked));

function press(key: string, keyCode: number, modifiers: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true, ...modifiers });
    view.contentDOM.dispatchEvent(event);
    return event;
}

const results: string[] = [];
function check(name: string, condition: boolean) {
    results.push(`${condition ? 'PASS' : 'FAIL'}: ${name}`);
    document.getElementById('results')!.textContent = results.join('\n');
    if (!condition) throw new Error(name);
}

check('Editor exposes its accessible name', view.contentDOM.getAttribute('aria-label') === 'Test source editor');
check('Editor instructions resolve', !!document.getElementById(view.contentDOM.getAttribute('aria-describedby')!));
view.focus();
check('Default Tab still indents', press('Tab', 9).defaultPrevented && view.state.doc.toString() !== 'Hello');
press('ArrowDown', 40, { ctrlKey: true, altKey: true });
check('Default Control+Alt binding still runs', calls === 1);

setMode(true);
const before = view.state.doc.toString();
check('Mode releases Tab', !press('Tab', 9).defaultPrevented);
check('Mode releases Shift+Tab', !press('Tab', 9, { shiftKey: true }).defaultPrevented);
check('Released Tab never changes the document', view.state.doc.toString() === before);
check('Mode reserves Control+Alt navigation without canceling defaults', !press('ArrowDown', 40, { ctrlKey: true, altKey: true }).defaultPrevented && calls === 1);
press('a', 65, { ctrlKey: true, altKey: true });
check('Printable international keyboard chords reach the editor', altGrCalls === 1);
setMode(false);
check('Turning mode off restores indentation', press('Tab', 9).defaultPrevented);
press('Escape', 27);
check('Default Escape then Tab escape hatch works', !press('Tab', 9).defaultPrevented);

// Reconfigure twice to catch stale plugin cleanup or a reset of tab-focus mode.
setMode(true);
setMode(true);
check('Repeated reconfiguration retains Tab navigation', !press('Tab', 9).defaultPrevented);

// Leave the fixture ready for real Tab/Shift+Tab browser automation.
document.getElementById('before')!.focus();
