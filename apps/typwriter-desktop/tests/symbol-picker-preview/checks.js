// Runs against the production component in Chromium or system WebKitGTK.
(async () => {
  /** @type {{ name: string, ok: boolean }[]} */
  const results = [];
  let legacyLayout;
  /** @param {string} name @param {boolean} ok */
  const check = (name, ok) => {
    results.push({ name, ok });
    if (!ok) throw new Error(name);
  };
  /** @param {string} selector @param {ParentNode} [root] */
  const element = (selector, root = document) => {
    const found = root.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
    return found;
  };
  /** @returns {Promise<void>} */
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const dialog = () => element('[role="dialog"]');
  /** @param {string} value */
  const search = async (value) => {
    const input = /** @type {HTMLInputElement} */ (element('input[aria-label="Search symbols"]'));
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  };
  /** @param {string} value */
  const key = async (value) => {
    element('input[aria-label="Search symbols"]').dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
    await settle();
  };
  try {
    let panel = dialog();
    const scroller = element(".overflow-y-auto", panel);
    check("all 131 symbols render", panel.querySelectorAll('button[data-slot="tooltip-trigger"]').length === 131);
    check("content-based flex basis", getComputedStyle(scroller).flexBasis === "auto");
    check("full grid scrolls within viewport", scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight && panel.getBoundingClientRect().bottom <= innerHeight);
    // Record the previous layout in this engine, then restore production CSS.
    // Chromium and newer WebKit versions can mask the reported collapse.
    const header = element("input", panel).parentElement;
    if (!header) throw new Error("Missing search header");
    const footer = /** @type {HTMLElement} */ (panel.lastElementChild);
    const elements = [panel, scroller, header, footer];
    const styles = elements.map((element) => element.style.cssText);
    panel.style.height = "fit-content";
    scroller.style.flex = "1";
    header.style.flexShrink = footer.style.flexShrink = "1";
    await settle();
    legacyLayout = { bodyHeight: scroller.clientHeight, dialogHeight: panel.clientHeight };
    elements.forEach((element, index) => { element.style.cssText = styles[index]; });
    await settle();
    scroller.scrollTop = scroller.scrollHeight;
    await settle();
    const last = element('button[aria-label="yen: ¥"]', panel).getBoundingClientRect();
    check("last symbol is reachable", last.bottom <= scroller.getBoundingClientRect().bottom + 1 && last.top >= scroller.getBoundingClientRect().top);
    await search("not equal");
    panel = dialog();
    const cell = element('button[aria-label="eq.not: ≠"]', panel);
    const rect = cell.getBoundingClientRect();
    check("search result is visible and square", rect.height > 40 && Math.abs(rect.width - rect.height) < 1 && rect.bottom <= panel.getBoundingClientRect().bottom);
    cell.click();
    await settle();
    check("click inserts markup", !document.querySelector('[role="dialog"]') && element(".cm-content").textContent === "#sym.eq.not");
    element("#math").click();
    await settle();
    await search("not equal");
    await key("Enter");
    check("Enter inserts math", !document.querySelector('[role="dialog"]') && element(".cm-content").textContent === "$eq.not $");
    element("#markup").click();
    await settle();
    await search("xyzzy-no-such-symbol");
    check("empty state is visible", dialog().innerText.includes("No symbol matches") && element(".overflow-y-auto", dialog()).clientHeight > 0);
    await search("");
    check("clearing search restores symbols", dialog().querySelectorAll('button[data-slot="tooltip-trigger"]').length === 131);
    await key("Escape");
    check("Escape restores editor focus", !document.querySelector('[role="dialog"]') && document.activeElement?.classList.contains("cm-content") === true);
    Object.assign(globalThis, { __pickerChecks: { results, legacyLayout } });
  } catch (error) {
    Object.assign(globalThis, { __pickerChecks: { results, legacyLayout, error: String(error) } });
  }
})();
