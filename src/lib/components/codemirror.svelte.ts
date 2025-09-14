import { defaultKeymap } from "@codemirror/commands";
import { EditorState, type EditorStateConfig, type Extension } from "@codemirror/state";
import { keymap, ViewUpdate } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror"


type CursorPosition = {
    line: number;
    column: number;
}

type ConstructorArgs = {
    onDocChange?: (view: ViewUpdate) => Promise<void>;
    text?: string;
    parent?: HTMLElement;
    extraExtensions?: Array<Extension>
}

export class CodeMirrorEditor {
    view: EditorView | undefined = $state(undefined);
    private cursor_position: CursorPosition = $state({ line: 0, column: 0 })

    constructor({ onDocChange, text = "", parent, extraExtensions }: ConstructorArgs) {

        if (this.view) this.view.destroy()
        const fixedHeight = EditorView.theme({
            "&": { height: "92svh" },
            ".cm-scroller": { overflow: "auto" }
        })

        const editorWidth = EditorView.theme({
            "&": { width: "100%" },
        })

        const updateHandler = EditorView.updateListener.of(
            async (view) => {
                if (view.docChanged && onDocChange) {
                    onDocChange(view);
                }

                if (view.selectionSet) {
                    const selection = view.state.selection.main;
                    const line = view.state.doc.lineAt(selection.from)
                    const column = selection.from - line.from + 1
                    this.cursor_position = { line: line.number, column: column }
                }
            }
        )

        if (!extraExtensions) extraExtensions = []

        const extensions = [
            keymap.of(defaultKeymap),
            basicSetup,
            updateHandler,
            fixedHeight,
            editorWidth,
            EditorView.lineWrapping,
            ...extraExtensions
        ]

        this.view = new EditorView({
            state: EditorState.create({
                doc: text,
                extensions: extensions,
            }),

            parent: parent
        })

        const selection = this.view.state.selection.main;
        const line = this.view.state.doc.lineAt(selection.from)
        const column = selection.from - line.from + 1
        this.cursor_position = { line: line.number, column: column }
        this.view.focus()

    }

    moveCursorToPosition(line: number, column: number) {
        if (!this.view) return
        const pos = this.view.state.doc.line(line).from + column - 1
        this.view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: true
        })
        this.view.focus()

    }

    getCursorPosition(): CursorPosition {
        return this.cursor_position
    }


    // fix the onDocChange, should not repass the it again
    newFile({ onDocChange, text = "", parent, extraExtensions }: ConstructorArgs) {

        if (this.view) this.view.destroy()
        const fixedHeight = EditorView.theme({
            "&": { height: "92svh" },
            ".cm-scroller": { overflow: "auto" }
        })

        const editorWidth = EditorView.theme({
            "&": { width: "100%" },
        })

        const updateHandler = EditorView.updateListener.of(
            async (view) => {
                if (view.docChanged && onDocChange) {
                    onDocChange(view);
                }

                if (view.selectionSet) {
                    const selection = view.state.selection.main;
                    const line = view.state.doc.lineAt(selection.from)
                    const column = selection.from - line.from + 1
                    this.cursor_position = { line: line.number, column: column }
                }
            }
        )

        if (!extraExtensions) extraExtensions = []

        const extensions = [
            keymap.of(defaultKeymap),
            basicSetup,
            updateHandler,
            fixedHeight,
            editorWidth,
            EditorView.lineWrapping,
            ...extraExtensions
        ]

        this.view = new EditorView({
            state: EditorState.create({
                doc: text,
                extensions: extensions,
            }),

            parent: parent
        })

        const selection = this.view.state.selection.main;
        const line = this.view.state.doc.lineAt(selection.from)
        const column = selection.from - line.from + 1
        this.cursor_position = { line: line.number, column: column }
        this.view.focus()

    }


}
