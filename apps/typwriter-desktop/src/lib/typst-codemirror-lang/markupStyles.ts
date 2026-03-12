import { RangeSetBuilder } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
} from "@codemirror/view";

export type TypstMarkupStyleRange = {
    from: number;
    to: number;
    className: "cm-typst-heading" | "cm-typst-strong" | "cm-typst-emph";
};

const headingMark = Decoration.mark({ class: "cm-typst-heading" });
const strongMark = Decoration.mark({ class: "cm-typst-strong" });
const emphMark = Decoration.mark({ class: "cm-typst-emph" });

function getHeadingPrefixLength(line: string) {
    let index = 0;
    while (line.charCodeAt(index) === 61) index++;
    if (index === 0) return 0;

    const next = line.charCodeAt(index);
    if (Number.isNaN(next) || next === 32 || next === 9) return index;

    return 0;
}

function collectDelimitedRanges(
    line: string,
    lineStart: number,
    fromIndex: number,
    delimiter: "*" | "_",
    className: "cm-typst-strong" | "cm-typst-emph",
) {
    const ranges: TypstMarkupStyleRange[] = [];

    for (let index = fromIndex; index < line.length; index++) {
        if (line[index] === "\\") {
            index++;
            continue;
        }

        if (line[index] !== delimiter) continue;

        let close = index + 1;
        while (close < line.length) {
            if (line[close] === "\\") {
                close += 2;
                continue;
            }

            if (line[close] === delimiter) {
                if (close > index + 1) {
                    ranges.push({
                        from: lineStart + index,
                        to: lineStart + close + 1,
                        className,
                    });
                }
                index = close;
                break;
            }

            close++;
        }
    }

    return ranges;
}

export function collectTypstMarkupStyleRanges(line: string, lineStart = 0) {
    const ranges: TypstMarkupStyleRange[] = [];
    const headingPrefixLength = getHeadingPrefixLength(line);

    if (headingPrefixLength > 0) {
        ranges.push({
            from: lineStart,
            to: lineStart + line.length,
            className: "cm-typst-heading",
        });
    }

    const scanFrom = headingPrefixLength;

    ranges.push(
        ...collectDelimitedRanges(
            line,
            lineStart,
            scanFrom,
            "*",
            "cm-typst-strong",
        ),
    );
    ranges.push(
        ...collectDelimitedRanges(
            line,
            lineStart,
            scanFrom,
            "_",
            "cm-typst-emph",
        ),
    );

    return ranges;
}

function decorationForClass(className: TypstMarkupStyleRange["className"]) {
    switch (className) {
        case "cm-typst-heading":
            return headingMark;
        case "cm-typst-strong":
            return strongMark;
        case "cm-typst-emph":
            return emphMark;
    }
}

function buildMarkupStyleDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const seenLines = new Set<number>();

    for (const { from, to } of view.visibleRanges) {
        const startLine = view.state.doc.lineAt(from).number;
        const endLine = view.state.doc.lineAt(to).number;

        for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
            if (seenLines.has(lineNumber)) continue;
            seenLines.add(lineNumber);

            const line = view.state.doc.line(lineNumber);
            const lineRanges = collectTypstMarkupStyleRanges(line.text, line.from);
            lineRanges.sort((a, b) => a.from - b.from || b.to - a.to);
            for (const range of lineRanges) {
                builder.add(range.from, range.to, decorationForClass(range.className));
            }
        }
    }

    return builder.finish();
}

export const typstMarkupStyleOverlay = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildMarkupStyleDecorations(view);
        }

        update(update: ViewUpdate) {
            if (!update.docChanged && !update.viewportChanged) return;
            this.decorations = buildMarkupStyleDecorations(update.view);
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
    },
);
