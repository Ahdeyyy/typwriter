import { describe, expect, it } from "bun:test";
import { flattenFiles, fuzzyScore, searchFiles, type FileEntry } from "./file-search";
import type { FileNode } from "$lib/ipc/types";

const dir = (name: string, relPath: string, children: FileNode[]): FileNode => ({
  name,
  relPath,
  isDir: true,
  children,
});
const file = (name: string, relPath: string): FileNode => ({
  name,
  relPath,
  isDir: false,
  children: [],
});

describe("flattenFiles", () => {
  it("returns only files, depth-first", () => {
    const tree = dir("root", "", [
      dir("chapters", "chapters", [file("intro.typ", "chapters/intro.typ")]),
      file("main.typ", "main.typ"),
    ]);
    expect(flattenFiles(tree).map((f) => f.relPath)).toEqual([
      "chapters/intro.typ",
      "main.typ",
    ]);
  });

  it("handles a null tree", () => {
    expect(flattenFiles(null)).toEqual([]);
  });
});

describe("fuzzyScore", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyScore("main.typ", "mn")).not.toBeNull();
    expect(fuzzyScore("main.typ", "xyz")).toBeNull();
  });

  it("empty query matches everything", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  it("scores a contiguous prefix higher than a scattered match", () => {
    const prefix = fuzzyScore("main.typ", "main")!;
    const scattered = fuzzyScore("margin.typ", "main")!;
    expect(prefix).toBeGreaterThan(scattered);
  });
});

describe("searchFiles", () => {
  const entries: FileEntry[] = [
    { name: "main.typ", relPath: "main.typ" },
    { name: "intro.typ", relPath: "chapters/intro.typ" },
    { name: "margins.typ", relPath: "styles/margins.typ" },
  ];

  it("returns everything for an empty query", () => {
    expect(searchFiles(entries, "  ")).toHaveLength(3);
  });

  it("ranks a basename match first", () => {
    const res = searchFiles(entries, "main");
    expect(res[0].relPath).toBe("main.typ");
  });

  it("matches on the path too", () => {
    const res = searchFiles(entries, "chapters");
    expect(res.map((r) => r.relPath)).toContain("chapters/intro.typ");
  });
});
