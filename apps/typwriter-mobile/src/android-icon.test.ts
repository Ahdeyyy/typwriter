import { describe, expect, it } from "bun:test";

// Launchers mask adaptive icons to any shape that contains the 66dp safe-zone
// circle. A glyph corner outside it gets clipped on some phone — the bug that
// shipped when the whole tile sat in the foreground layer.
const drawables = new URL("../src-tauri/android-icon/drawable/", import.meta.url);

async function glyphPoints(name: string): Promise<[number, number][]> {
  const xml = await Bun.file(new URL(name, drawables)).text();
  const data = xml.match(/android:pathData="([^"]+)"/)![1];
  // Each bar is `Mx0,y0Hx1Vy1Hx0Z`.
  return [...data.matchAll(/M([\d.]+),([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+Z/g)].flatMap((m) => {
    const [x0, y0, x1, y1] = m.slice(1).map(Number);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][];
  });
}

describe("android adaptive icon", () => {
  for (const name of ["typwriter_icon_foreground.xml", "typwriter_icon_monochrome.xml"]) {
    it(`${name} stays inside the safe zone`, async () => {
      const points = await glyphPoints(name);
      expect(points.length).toBe(24);
      for (const [x, y] of points) expect(Math.hypot(x - 54, y - 54)).toBeLessThanOrEqual(33);
    });
  }

  it("foreground and monochrome share one glyph", async () => {
    expect(await glyphPoints("typwriter_icon_monochrome.xml")).toEqual(
      await glyphPoints("typwriter_icon_foreground.xml"),
    );
  });
});
