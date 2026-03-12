import { describe, expect, test } from "bun:test";
import { getStyleTags } from "@lezer/highlight";
import { parser as baseParser } from "./parser.js";
import { typstHighlighting, typstTags } from "./highlight";
import { collectTypstMarkupStyleRanges } from "./markupStyles";

const parser = baseParser.configure({ props: [typstHighlighting] });

function collectTaggedNodes(source: string) {
    const tree = parser.parse(source);
    const cursor = tree.cursor();
    const nodes: Array<{ name: string; from: number; to: number; tags: string[] }> = [];

    for (;;) {
        const style = getStyleTags(cursor);
        if (style) {
            nodes.push({
                name: cursor.name,
                from: cursor.from,
                to: cursor.to,
                tags: style.tags.map((tag) => tag.toString()),
            });
        }

        if (cursor.firstChild()) continue;
        for (;;) {
            if (cursor.nextSibling()) break;
            if (!cursor.parent()) return { tree, nodes };
        }
    }
}

// ─── Parser tree tests ──────────────────────────────────────────────────────

describe("Parser tree structure", () => {
    test("parses plain text", () => {
        const tree = parser.parse("hello");
        expect(tree.toString()).toBe("Document(Text)");
    });

    test("heading wraps content until end of line", () => {
        const tree = parser.parse("= hello");
        expect(tree.toString()).toBe(
            "Document(Heading(HeadingMarker,Space,Text,HeadingEnd))",
        );
    });

    test("heading with bold markers (flat — no Strong wrapper)", () => {
        const tree = parser.parse("= *AB*");
        expect(tree.toString()).toBe(
            "Document(Heading(HeadingMarker,Space,Star,Text,Star,HeadingEnd))",
        );
    });

    test("numbers in markup are text, not Int", () => {
        const tree = parser.parse("hello 42 world");
        expect(tree.toString()).toBe("Document(Text,Space,Text,Space,Text)");
    });

    test("numbers in code mode are Int", () => {
        const { nodes } = collectTaggedNodes("#let x = 42");
        const intNode = nodes.find((n) => n.name === "Int");
        expect(intNode).toBeDefined();
        expect(intNode!.tags).toContain(typstTags.number.toString());
    });

    test("enum marker at line start", () => {
        const tree = parser.parse("1. item");
        expect(tree.toString()).toContain("EnumMarker");
    });

    test("multi-level heading", () => {
        const tree = parser.parse("== subtitle");
        expect(tree.toString()).toBe(
            "Document(Heading(HeadingMarker,Space,Text,HeadingEnd))",
        );
    });
});

// ─── Highlight tag tests ────────────────────────────────────────────────────

describe("Highlight tags", () => {
    test("Heading node gets heading tag", () => {
        const { nodes } = collectTaggedNodes("= hello");
        const heading = nodes.find((n) => n.name === "Heading");
        expect(heading).toBeDefined();
        expect(heading!.tags).toContain(typstTags.heading.toString());
    });

    test("HeadingMarker gets heading tag", () => {
        const { nodes } = collectTaggedNodes("= hello");
        const marker = nodes.find((n) => n.name === "HeadingMarker");
        expect(marker).toBeDefined();
        expect(marker!.tags).toContain(typstTags.heading.toString());
    });

    test("EnumMarker gets listMarker tag", () => {
        const { nodes } = collectTaggedNodes("1. item");
        const marker = nodes.find((n) => n.name === "EnumMarker");
        expect(marker).toBeDefined();
        expect(marker!.tags).toContain(typstTags.listMarker.toString());
    });
});

// ─── Decoration overlay tests ───────────────────────────────────────────────

describe("Markup style ranges", () => {
    test("bold on a regular line", () => {
        const ranges = collectTypstMarkupStyleRanges("hello *bold* world");
        expect(ranges).toEqual([
            { from: 6, to: 12, className: "cm-typst-strong" },
        ]);
    });

    test("italic on a regular line", () => {
        const ranges = collectTypstMarkupStyleRanges("hello _italic_ world");
        expect(ranges).toEqual([
            { from: 6, to: 14, className: "cm-typst-emph" },
        ]);
    });

    test("heading with bold", () => {
        const ranges = collectTypstMarkupStyleRanges("= *bold title*");
        expect(ranges).toEqual([
            { from: 0, to: 14, className: "cm-typst-heading" },
            { from: 2, to: 14, className: "cm-typst-strong" },
        ]);
    });

    test("heading with italic", () => {
        const ranges = collectTypstMarkupStyleRanges("= _italic title_");
        expect(ranges).toEqual([
            { from: 0, to: 16, className: "cm-typst-heading" },
            { from: 2, to: 16, className: "cm-typst-emph" },
        ]);
    });

    test("escaped delimiters produce no ranges", () => {
        const ranges = collectTypstMarkupStyleRanges("\\*not bold\\*");
        expect(ranges).toEqual([]);
    });

    test("adjacent bold pairs", () => {
        const ranges = collectTypstMarkupStyleRanges("*a* *b*");
        expect(ranges).toEqual([
            { from: 0, to: 3, className: "cm-typst-strong" },
            { from: 4, to: 7, className: "cm-typst-strong" },
        ]);
    });

    test("bold containing italic", () => {
        const ranges = collectTypstMarkupStyleRanges("*bold _and italic_*");
        expect(ranges).toContainEqual(
            { from: 0, to: 19, className: "cm-typst-strong" },
        );
        expect(ranges).toContainEqual(
            { from: 6, to: 18, className: "cm-typst-emph" },
        );
    });

    test("non-heading line without delimiters returns empty", () => {
        const ranges = collectTypstMarkupStyleRanges("plain text here");
        expect(ranges).toEqual([]);
    });
});
