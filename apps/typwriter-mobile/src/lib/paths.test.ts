import { describe, expect, it } from "bun:test";
import { basename, parentDir, remapPath, workspaceLocation } from "./paths";

describe("basename", () => {
  it("returns the last segment", () => {
    expect(basename("notes/ch1.typ")).toBe("ch1.typ");
    expect(basename("a/b/c/d.typ")).toBe("d.typ");
  });

  it("returns the path unchanged at the workspace root", () => {
    expect(basename("main.typ")).toBe("main.typ");
    expect(basename("")).toBe("");
  });
});

describe("parentDir", () => {
  it("returns the parent folder", () => {
    expect(parentDir("notes/ch1.typ")).toBe("notes");
    expect(parentDir("a/b/c.typ")).toBe("a/b");
  });

  it("returns / at the workspace root, since it is rendered as a subtitle", () => {
    expect(parentDir("main.typ")).toBe("/");
  });
});

describe("remapPath", () => {
  it("remaps the renamed entry itself", () => {
    expect(remapPath("a.typ", "a.typ", "b.typ")).toEqual({ kind: "moved", to: "b.typ" });
    expect(remapPath("a.typ", "a.typ", null)).toEqual({ kind: "gone" });
  });

  it("remaps paths inside a renamed or moved folder", () => {
    expect(remapPath("notes/ch1.typ", "notes", "archive/notes")).toEqual({
      kind: "moved",
      to: "archive/notes/ch1.typ",
    });
    expect(remapPath("notes/sub/deep.typ", "notes", "book")).toEqual({
      kind: "moved",
      to: "book/sub/deep.typ",
    });
    expect(remapPath("notes/ch1.typ", "notes", null)).toEqual({ kind: "gone" });
  });

  it("leaves unrelated and prefix-lookalike paths alone", () => {
    expect(remapPath("other.typ", "a.typ", "b.typ")).toEqual({ kind: "unaffected" });
    expect(remapPath("notes-old.typ", "notes", "book")).toEqual({ kind: "unaffected" });
    expect(remapPath("notesy/x.typ", "notes", null)).toEqual({ kind: "unaffected" });
  });

  it("moves a file into the workspace root", () => {
    expect(remapPath("sub/a.typ", "sub/a.typ", "a.typ")).toEqual({ kind: "moved", to: "a.typ" });
  });
});

describe("workspaceLocation", () => {
  const managed = ["/storage/emulated/0/Documents/Typwriter"];
  const roots = [
    { path: "/storage/emulated/0", label: "" },
    { path: "/storage/emulated/0/Documents", label: "Documents" },
  ];

  it("hides the shared managed folder", () => {
    expect(workspaceLocation("/storage/emulated/0/Documents/Typwriter/notes", managed, roots)).toBeNull();
    expect(workspaceLocation("/storage/emulated/0/Documents/Typwriter/notes/", managed, roots)).toBeNull();
  });

  it("shows the parent folder relative to the storage root", () => {
    expect(workspaceLocation("/storage/emulated/0/Download/2024/thesis", managed, roots)).toBe("Download/2024");
    expect(workspaceLocation("/storage/emulated/0/Documents/Typwriter/a/b", managed, roots)).toBe(
      "Documents/Typwriter/a",
    );
  });

  it("keeps the full path outside every root", () => {
    expect(workspaceLocation(String.raw`C:\Users\me\Code Repository\typwriter`, [], [])).toBe(
      "C:/Users/me/Code Repository",
    );
  });

  it("compares Windows roots case-insensitively", () => {
    expect(workspaceLocation("C:/Users/Me/Typwriter/notes", ["c:/users/me/typwriter"], [])).toBeNull();
  });

  it("returns null when there is no parent to name", () => {
    expect(workspaceLocation("/storage/emulated/0/notes", managed, roots)).toBeNull();
    expect(workspaceLocation("/notes", managed, roots)).toBeNull();
    expect(workspaceLocation("notes", managed, roots)).toBeNull();
  });
});
