import { describe, expect, it } from "bun:test";

// Tauri puts a nonce on every inline <style> and adds it to the CSP's
// style-src, which makes the WebView ignore 'unsafe-inline'. CodeMirror's
// runtime <style> elements carry no nonce, so the editor loses all of its CSS —
// only on device, never in a browser.
describe("app.html", () => {
  it("has no inline <style>", async () => {
    const html = await Bun.file(new URL("./app.html", import.meta.url)).text();
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
    expect(withoutComments).not.toMatch(/<style[\s>]/i);
  });
});
