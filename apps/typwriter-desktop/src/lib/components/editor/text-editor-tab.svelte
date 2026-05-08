<script lang="ts">
  import {
    EditorView,
    hoverTooltip,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    type Tooltip,
  } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
    insertTab,
    lineComment,
    lineUncomment,
  } from "@codemirror/commands";
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completeFromList,
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
  } from "@codemirror/autocomplete";
  import {
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    StreamLanguage,
  } from "@codemirror/language";
  import { json } from "@codemirror/lang-json";
  import { xml } from "@codemirror/lang-xml";
  import { yaml } from "@codemirror/lang-yaml";
  import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";

  import {
    lintGutter,
    setDiagnostics,
    type Diagnostic as CMDiagnostic,
  } from "@codemirror/lint";
  import { search } from "@codemirror/search";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import {
    typst,
    light,
    dark,
    typstSpellcheck,
    typstCommentDecorations,
    typstKeymap,
  } from "$lib/typst-codemirror-lang";
  import { Compartment } from "@codemirror/state";
  import { mode, systemPrefersMode } from "mode-watcher";
  import { languages } from "@codemirror/language-data";
  // import {
  //   githubLightTheme,
  //   githubLightHighlightStyle,
  // } from "$lib/typst-codemirror-lang/lightTheme.js";
  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import {
    getCompletions,
    getTooltip as getTooltipIpc,
  } from "$lib/ipc/commands";
  import type { SerializedDiagnostic, TooltipResponse } from "$lib/types";
  import { ayuLight } from "thememirror";
  import { indentationMarkers } from "@replit/codemirror-indentation-markers";
  import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
  import { logError } from "$lib/logger";


  let editorHost = $state<HTMLDivElement | null>(null);
  const tabViews = new Map<string, EditorView>();
  let mountedTabId = $state<string | null>(null);

  const themeCompartment = new Compartment();

  function resolvedTheme() {
    const m = mode.current;
    const sys = systemPrefersMode.current;
    return m === "dark" ||  sys === "dark" ? dark : light;
  }

  function mapBackendCompletionKind(kind: string): Completion["type"] {
    const normalizedKind = kind.toLowerCase();
    if (normalizedKind.includes("func")) return "function";
    if (normalizedKind.includes("type")) return "type";
    if (normalizedKind.includes("param") || normalizedKind.includes("field"))
      return "property";
    if (normalizedKind.includes("var")) return "variable";
    if (
      normalizedKind.includes("module") ||
      normalizedKind.includes("namespace")
    )
      return "namespace";
    if (normalizedKind.includes("constant")) return "constant";
    if (normalizedKind.includes("keyword")) return "keyword";
    if (normalizedKind.includes("string")) return "text";
    return "text";
  }

  async function getLanguageCompletionResults(
    context: CompletionContext,
  ): Promise<CompletionResult[]> {
    const rawSources = context.state.languageDataAt<unknown>(
      "autocomplete",
      context.pos,
    );
    const completionSources: CompletionSource[] = rawSources
      .map((source): CompletionSource | null => {
        if (typeof source === "function") {
          return source as CompletionSource;
        }
        if (Array.isArray(source)) {
          return completeFromList(source as readonly Completion[]);
        }
        return null;
      })
      .filter((source): source is CompletionSource => source !== null);

    const results: CompletionResult[] = [];
    for (const source of completionSources) {
      const result = await source(context);
      if (result) results.push(result);
    }
    return results;
  }

  function mergedTypstCompletionsForTab(tabId: string): CompletionSource {
    return async (context: CompletionContext) => {
      const hasWordBeforeCursor = context.matchBefore(/[\w\-]+/);
      if (
        !context.explicit &&
        (!hasWordBeforeCursor ||
          hasWordBeforeCursor.from === hasWordBeforeCursor.to)
      ) {
        return null;
      }

      const tab = editor.tabs.find((t) => t.id === tabId);
      if (!tab || tab.viewMode !== "text") return null;

      const [languageResults, backendResult] = await Promise.all([
        getLanguageCompletionResults(context),
        getCompletions(tab.absPath, context.pos, context.explicit ),
      ]);

      const languageOptions = languageResults.flatMap(
        (result) => result.options ?? [],
      );
      const backendPayload = backendResult.isOk() ? backendResult.value : null;
      const backendOptions: Completion[] = backendPayload
        ? backendPayload.completions.map((item) => ({
            label: item.label,
            type: mapBackendCompletionKind(item.kind),
            apply: item.apply ?? item.label,
            detail: item.detail ?? undefined,
          }))
        : [];

      const seenKeys = new Set<string>();
      const mergedOptions: Completion[] = [];
      const pushUnique = (option: Completion) => {
        const key = `${option.label}::${option.apply ?? ""}::${option.type ?? ""}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        mergedOptions.push(option);
      };

      backendOptions.forEach(pushUnique);
      languageOptions.forEach(pushUnique);

      if (mergedOptions.length === 0) return null;

      const fromCandidates = [
        ...languageResults.map((result) => result.from),
        ...(backendPayload ? [backendPayload.from] : []),
      ];
      const from =
        fromCandidates.length > 0 ? Math.min(...fromCandidates) : context.pos;

      return {
        from,
        options: mergedOptions,
      };
    };
  }

  function toCMDiagnostic(
    d: SerializedDiagnostic,
    view: EditorView,
  ): CMDiagnostic | null {
    if (!d.range) return null;
    const doc = view.state.doc;
    const sl = Math.min(d.range.start_line + 1, doc.lines);
    const el = Math.min(d.range.end_line + 1, doc.lines);
    const startLine = doc.line(sl);
    const endLine = doc.line(el);
    const from = Math.min(startLine.from + d.range.start_col, startLine.to);
    const to = Math.max(
      Math.min(endLine.from + d.range.end_col, endLine.to),
      from + 1,
    );
    return {
      from,
      to,
      severity: d.severity === "error" ? "error" : "warning",
      message:
        d.hints.length > 0 ? `${d.message}\n${d.hints.join("\n")}` : d.message,
    };
  }

  function getLanguageExtension(relPath: string) {
    const dot = relPath.lastIndexOf(".");
    const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : "";
    switch (ext) {
      case ".typ":
        return typst({ codeLanguages: languages });
      case ".json":
        return json();
      case ".xml":
        return xml();
      case ".yaml":
      case ".yml":
        return yaml();
      case ".toml":
        return StreamLanguage.define(tomlMode);
      default:
        return null;
    }
  }

  function makeExtensions(tabId: string) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    const relPath = tab?.relPath ?? tabId;
    const isTypst = relPath.endsWith(".typ");
    const langExt = getLanguageExtension(relPath);

    return [
      lintGutter(),
      // lineNumbers(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      highlightActiveLine(),
      history(),
      drawSelection(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      // .typ: merged Typst language + backend IPC completions
      // others: let the language package supply its own completions
      isTypst
        ? autocompletion({ override: [mergedTypstCompletionsForTab(tabId)] })
        : autocompletion(),
      indentOnInput(),
      // githubLightTheme,
      // syntaxHighlighting(githubLightHighlightStyle),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      themeCompartment.of(resolvedTheme()),
      // Language extension chosen by file extension; null = plain text
      ...(langExt ? [langExt] : []),
      ...(isTypst ? [typstCommentDecorations, typstSpellcheck, keymap.of(typstKeymap)] : []),
      indentationMarkers(),
      // Custom Svelte search panel — provide an empty CM panel so the
      // search extension's state is initialized but its UI is suppressed.
      search({
        top: true,
        createPanel: () => {
          const dom = document.createElement("div");
          dom.style.display = "none";
          return { dom };
        },
      }),
      // Search bindings BEFORE vscodeKeymap so they take precedence over
      // vscodeKeymap's built-in Mod-f (openSearchPanel) handler.
      keymap.of([
        {
          key: "Mod-f",
          run: () => {
            editorSearch.openPanel(false);
            return true;
          },
        },
        {
          key: "Mod-h",
          run: () => {
            editorSearch.openPanel(true);
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            if (editorSearch.open) {
              editorSearch.closePanel();
              return true;
            }
            return false;
          },
        },
        // Format the current .typ file (overrides vscodeKeymap's Format Document)
        {
          key: "Shift-Alt-f",
          run: () => {
            editor
              .formatTabById(tabId)
              .mapErr((err) => logError("format error:", err));
            return true;
          },
        },
      ]),
      keymap.of(vscodeKeymap),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          run: () => {
            editor
              .saveTabById(tabId)
              .mapErr((err) => logError("save error:", err));
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        editor.handleTabContentChange(tabId, update.state.doc.toString());
      }),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet) return;
        const tab = editor.tabs.find((t) => t.id === tabId);
        if (!tab || tab.viewMode !== "text") return;
        const cursor = update.state.selection.main.head;
        preview.setCursorPosition(tab.absPath, cursor);
      }),
      EditorView.updateListener.of((update) => {
        if (!editorSearch.open) return;
        if (
          editorSearch.getActiveView() === update.view &&
          (update.docChanged || update.selectionSet)
        ) {
          editorSearch.refreshCounts();
        }
      }),
      // Hover tooltip — only for .typ (avoids unnecessary IPC calls for other file types)
      ...(isTypst
        ? [
            hoverTooltip(
              async (_view, pos) => {
                const tab = editor.tabs.find((t) => t.id === tabId);
                if (!tab || tab.viewMode !== "text") return null;

                const tooltipResult = await getTooltipIpc(tab.absPath, pos);
                if (tooltipResult.isErr() || tooltipResult.value === null)
                  return null;

                const data = tooltipResult.value;
                return {
                  pos,
                  end: pos,
                  above: true,
                  create() {
                    const dom = createHoverTooltipDom(data);
                    return { dom };
                  },
                } satisfies Tooltip;
              },
              { hoverTime: 250 },
            ),
          ]
        : []),
      // ayuLight,
      EditorView.theme({
        "&": {
          height: "100%",
          width: "100%",
          fontSize: "13px",
          fontFamily: "var(--font-mono, monospace)",
        },
        ".cm-scroller": { overflow: "auto" },
        ".cm-tooltip.cm-tooltip-hover": {
          backgroundColor: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-md)",
          maxWidth: "36rem",
          maxHeight: "22rem",
          overflow: "auto",
          padding: "0",
        },
        ".cm-typwriter-hover-tooltip": {
          padding: "0.5rem 0.625rem",
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          lineHeight: "1.45",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
        ".cm-typwriter-hover-tooltip.code": {
          fontFamily: "var(--font-mono)",
          backgroundColor: "color-mix(in srgb, var(--muted) 70%, transparent)",
          border: "1px solid var(--border)",
          borderRadius: "calc(var(--radius) - 1px)",
          margin: "0.25rem",
        },
      }),
    ];
  }

  function createHoverTooltipDom(data: TooltipResponse): HTMLDivElement {
    const dom = document.createElement("div");
    dom.className = "cm-typwriter-hover-tooltip";

    if (data.type === "code") {
      dom.classList.add("code");
      const code = document.createElement("pre");
      code.style.margin = "0";
      code.style.fontFamily = "inherit";
      code.style.whiteSpace = "pre-wrap";
      code.style.wordBreak = "break-word";
      code.textContent = data.text;
      dom.appendChild(code);
      return dom;
    }

    dom.textContent = data.value;
    return dom;
  }

  function ensureView(tabId: string): EditorView | null {
    const existing = tabViews.get(tabId);
    if (existing) return existing;

    const tab = editor.tabs.find((t) => t.id === tabId);
    if (!tab || tab.viewMode !== "text" || tab.isLoading) return null;

    const view = new EditorView({
      state: EditorState.create({
        doc: tab.content,
        extensions: makeExtensions(tabId),
      }),
    });

    tabViews.set(tabId, view);
    return view;
  }

  function syncDocFromStore(tabId: string, view: EditorView) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === tab.content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: tab.content },
    });
  }

  function mountActiveView(activeTabId: string | null) {
    if (!editorHost) return;
    const activeTab = activeTabId
      ? (editor.tabs.find((tab) => tab.id === activeTabId) ?? null)
      : null;
    if (!activeTab || activeTab.viewMode !== "text" || activeTab.isLoading) {
      editorHost.replaceChildren();
      mountedTabId = null;
      editorSearch.setActiveView(null);
      return;
    }

    const view = ensureView(activeTab.id);
    if (!view) return;

    syncDocFromStore(activeTab.id, view);

    if (mountedTabId !== activeTab.id) {
      editorHost.replaceChildren(view.dom);
      mountedTabId = activeTab.id;
    }

    editorSearch.setActiveView(view);
    // Don't steal focus away from the search panel if it's open.
    if (!editorSearch.open) view.focus();
  }

  function destroyClosedTabViews() {
    const openTabIds = new Set(
      editor.tabs.filter((tab) => tab.viewMode === "text").map((tab) => tab.id),
    );
    for (const [tabId, view] of tabViews) {
      if (openTabIds.has(tabId)) continue;
      if (editorSearch.getActiveView() === view) {
        editorSearch.setActiveView(null);
      }
      view.destroy();
      tabViews.delete(tabId);
      if (mountedTabId === tabId) mountedTabId = null;
    }
  }

  $effect(() => {
    const activeTabId = editor.activeTabId;
    const tabSignature = editor.tabs
      .map((tab) => `${tab.id}:${tab.viewMode}:${tab.isLoading ? "1" : "0"}`)
      .join("|");
    editorHost;
    tabSignature;
    destroyClosedTabViews();
    mountActiveView(activeTabId);
  });

  $effect(() => {
    return () => {
      for (const view of tabViews.values()) view.destroy();
      tabViews.clear();
      mountedTabId = null;
      editorSearch.setActiveView(null);
    };
  });

  // ── Store → Editor: push externally-replaced content (e.g. format) into CM.
  // Dispatch a minimal changeset (longest common prefix/suffix stripped) and
  // explicitly compute the new cursor position. Relying on CodeMirror's default
  // selection mapping is unsafe here: when the cursor sits at the trailing edge
  // of a deletion (e.g. right after a trimmed trailing space at end-of-line),
  // assoc=-1 maps it back to the change's `from`, which can be the top of the
  // file if the formatter also touched leading content. See cursor maintenance:
  // https://github.com/michaellaszlo/cursor-maintenance
  $effect(() => {
    const req = editor.contentSyncRequest;
    if (!req) return;
    const view = tabViews.get(req.tabId);
    if (!view) return;
    const oldText = view.state.doc.toString();
    const newText = req.content;
    if (oldText === newText) return;

    const maxLen = Math.min(oldText.length, newText.length);
    let lcp = 0;
    while (
      lcp < maxLen &&
      oldText.charCodeAt(lcp) === newText.charCodeAt(lcp)
    ) {
      lcp++;
    }
    let lcs = 0;
    while (
      lcs < maxLen - lcp &&
      oldText.charCodeAt(oldText.length - 1 - lcs) ===
        newText.charCodeAt(newText.length - 1 - lcs)
    ) {
      lcs++;
    }

    const oldEnd = oldText.length - lcs;
    const newEnd = newText.length - lcs;
    const oldCursor = view.state.selection.main.head;
    const snapshot = captureCursorSnapshot(oldText, oldCursor);
    const newCursor =
      oldCursor <= lcp
        ? oldCursor
        : oldCursor >= oldEnd
          ? oldCursor + (newText.length - oldText.length)
          : applyCursorSnapshot(newText, snapshot);

    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({
      changes: {
        from: lcp,
        to: oldEnd,
        insert: newText.slice(lcp, newEnd),
      },
      selection: { anchor: newCursor },
      scrollIntoView: false,
    });
    view.scrollDOM.scrollTop = scrollTop;
  });

  // Retrospective cursor maintenance: outside the changed region, the cursor's
  // offset shifts by the length delta. Inside the region, prefer a same-line
  // column when the cursor is sitting in formatter-touched whitespace, then
  // fall back to token anchoring. The whitespace case matters for trailing
  // spaces: counting only non-whitespace characters can produce a target of 0
  // and jump the cursor to the start of a large changed region.
  function mapCursorThroughFormat(
    oldText: string,
    newText: string,
    oldCursor: number,
    lcp: number,
    oldEnd: number,
    newEnd: number,
  ): number {
    if (oldCursor <= lcp) return oldCursor;
    if (oldCursor >= oldEnd) {
      return oldCursor + (newText.length - oldText.length);
    }

    if (
      isWhitespaceOnly(oldText, lcp, oldCursor) ||
      isAfterTrailingHorizontalWhitespace(oldText, oldCursor)
    ) {
      return mapCursorByLineColumn(oldText, newText, oldCursor);
    }

    let target = 0;
    for (let i = lcp; i < oldCursor; i++) {
      if (!isWhitespace(oldText.charCodeAt(i))) target++;
    }
    let count = 0;
    for (let i = lcp; i < newEnd; i++) {
      if (count === target) return i;
      if (!isWhitespace(newText.charCodeAt(i))) count++;
    }
    return newEnd;
  }

  function isWhitespaceOnly(text: string, from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
      if (!isWhitespace(text.charCodeAt(i))) return false;
    }
    return true;
  }

  function isAfterTrailingHorizontalWhitespace(
    text: string,
    cursor: number,
  ): boolean {
    if (cursor === 0 || cursor > text.length) return false;
    const previous = text.charCodeAt(cursor - 1);
    if (previous !== 0x20 && previous !== 0x09) return false;
    return cursor === text.length || text.charCodeAt(cursor) === 0x0a;
  }

  function mapCursorByLineColumn(
    oldText: string,
    newText: string,
    oldCursor: number,
  ): number {
    const oldLineStart = oldText.lastIndexOf("\n", oldCursor - 1) + 1;
    const oldColumn = oldCursor - oldLineStart;
    const oldLine = countLineBreaks(oldText, 0, oldCursor);
    const newLineStart = lineStartAt(newText, oldLine);
    const newLineEnd = lineEndAt(newText, newLineStart);
    return Math.min(newLineStart + oldColumn, newLineEnd);
  }

  function countLineBreaks(text: string, from: number, to: number): number {
    let count = 0;
    for (let i = from; i < to; i++) {
      if (text.charCodeAt(i) === 0x0a) count++;
    }
    return count;
  }

  function lineStartAt(text: string, line: number): number {
    let offset = 0;
    for (let currentLine = 0; currentLine < line; currentLine++) {
      const nextBreak = text.indexOf("\n", offset);
      if (nextBreak === -1) return text.length;
      offset = nextBreak + 1;
    }
    return offset;
  }

  function lineEndAt(text: string, lineStart: number): number {
    const nextBreak = text.indexOf("\n", lineStart);
    return nextBreak === -1 ? text.length : nextBreak;
  }

  function isWhitespace(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }

  // ── Snapshot-based cursor maintenance.
  // Capture the cursor's line/column plus the line text, the lines above and
  // below, and a small window of characters on either side. After formatting,
  // locate the best-matching line in the new text (using neighbour context),
  // then locate the best offset within that line by matching the saved
  // charsBehind suffix and charsAhead prefix.
  interface CursorSnapshot {
    line: number;
    column: number;
    lineText: string;
    lineAbove: string | null;
    lineBelow: string | null;
    charsBehind: string;
    charsAhead: string;
  }

  const SNAPSHOT_CONTEXT_LEN = 24;

  function captureCursorSnapshot(text: string, cursor: number): CursorSnapshot {
    const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
    const nextBreak = text.indexOf("\n", cursor);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;

    const line = countLineBreaks(text, 0, cursor);
    const column = cursor - lineStart;
    const lineText = text.slice(lineStart, lineEnd);

    let lineAbove: string | null = null;
    if (lineStart > 0) {
      const prevBreak = lineStart - 1;
      const prevStart = text.lastIndexOf("\n", prevBreak - 1) + 1;
      lineAbove = text.slice(prevStart, prevBreak);
    }

    let lineBelow: string | null = null;
    if (lineEnd < text.length) {
      const nextStart = lineEnd + 1;
      const followingBreak = text.indexOf("\n", nextStart);
      const nextEnd = followingBreak === -1 ? text.length : followingBreak;
      lineBelow = text.slice(nextStart, nextEnd);
    }

    const charsBehind = text.slice(
      Math.max(lineStart, cursor - SNAPSHOT_CONTEXT_LEN),
      cursor,
    );
    const charsAhead = text.slice(
      cursor,
      Math.min(lineEnd, cursor + SNAPSHOT_CONTEXT_LEN),
    );

    return { line, column, lineText, lineAbove, lineBelow, charsBehind, charsAhead };
  }

  function applyCursorSnapshot(newText: string, snap: CursorSnapshot): number {
    const lines: { start: number; end: number; text: string }[] = [];
    let pos = 0;
    while (true) {
      const nl = newText.indexOf("\n", pos);
      const end = nl === -1 ? newText.length : nl;
      lines.push({ start: pos, end, text: newText.slice(pos, end) });
      if (nl === -1) break;
      pos = nl + 1;
    }

    const scoreLine = (idx: number): number => {
      const candidate = lines[idx];
      let score = 0;
      if (candidate.text === snap.lineText) score += 1000;
      else if (candidate.text.trim() === snap.lineText.trim()) score += 500;
      else {
        const prefix = commonPrefixLen(candidate.text, snap.lineText);
        const suffix = commonSuffixLen(candidate.text, snap.lineText);
        score += prefix + suffix;
      }
      if (
        snap.lineAbove !== null &&
        idx > 0 &&
        lines[idx - 1].text === snap.lineAbove
      ) {
        score += 200;
      }
      if (
        snap.lineBelow !== null &&
        idx < lines.length - 1 &&
        lines[idx + 1].text === snap.lineBelow
      ) {
        score += 200;
      }
      score -= Math.abs(idx - snap.line) * 2;
      return score;
    };

    let bestIdx = Math.min(snap.line, lines.length - 1);
    let bestScore = -Infinity;
    for (let i = 0; i < lines.length; i++) {
      const s = scoreLine(i);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    const target = lines[bestIdx];
    const lineStr = target.text;
    const behind = snap.charsBehind;
    const ahead = snap.charsAhead;

    let bestOffset = Math.min(snap.column, lineStr.length);
    let bestOffsetScore = -Infinity;

    for (let off = 0; off <= lineStr.length; off++) {
      const beforeSlice = lineStr.slice(Math.max(0, off - behind.length), off);
      const afterSlice = lineStr.slice(
        off,
        Math.min(lineStr.length, off + ahead.length),
      );
      const beforeMatch = commonSuffixLen(beforeSlice, behind);
      const afterMatch = commonPrefixLen(afterSlice, ahead);
      const score =
        beforeMatch * 3 + afterMatch * 3 - Math.abs(off - snap.column) * 0.1;
      if (score > bestOffsetScore) {
        bestOffsetScore = score;
        bestOffset = off;
      }
    }

    return target.start + bestOffset;
  }

  function commonPrefixLen(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  function commonSuffixLen(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (
      i < len &&
      a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
    ) {
      i++;
    }
    return i;
  }

  // ── Preview → Editor: apply cursor jump requested by preview click
  $effect(() => {
    const req = editor.cursorJumpRequest;
    if (!req) return;
    // rAF lets any pending tab mount complete before we look up the view
    requestAnimationFrame(() => {
      const view = tabViews.get(req.tabId);
      if (view && editor.cursorJumpRequest?.tabId === req.tabId) {
        editor.cursorJumpRequest = null;
        const offset = Math.min(req.offset, view.state.doc.length);
        view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
        if (!editorSearch.open) view.focus();
      }
    });
  });

  // ── Theme → reconfigure all views when mode changes
  $effect(() => {
    const _ = mode.current;
    const __ = systemPrefersMode.current;
    const themeExt = resolvedTheme();
    for (const view of tabViews.values()) {
      view.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
    }
  });

  // ── Diagnostics → CodeMirror lint markers
  $effect(() => {
    const allDiags = [...diagnostics.errors, ...diagnostics.warnings];
    const _ = mountedTabId; // re-run when active tab changes

    for (const [tabId, view] of tabViews) {
      const tab = editor.tabs.find((t) => t.id === tabId);
      if (!tab) continue;
      const marks = allDiags
        .filter((d) => d.file_path === tab.relPath)
        .map((d) => toCMDiagnostic(d, view))
        .filter((d): d is CMDiagnostic => d !== null);
      view.dispatch(setDiagnostics(view.state, marks));
    }
  });
</script>

<div bind:this={editorHost} class="h-full w-full overflow-hidden"></div>
