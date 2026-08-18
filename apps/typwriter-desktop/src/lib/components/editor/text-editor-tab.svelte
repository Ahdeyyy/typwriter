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
  import { EditorState, type Extension } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completeFromList,
    snippet,
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
  } from "@codemirror/language";
  import { markdown } from "@codemirror/lang-markdown";
  import {
    langExtensionForPath,
    resolveCodeLanguage,
  } from "$lib/codemirror/langs";

  import {
    forEachDiagnostic,
    setDiagnostics,
    type Diagnostic as CMDiagnostic,
  } from "@codemirror/lint";
  import { inlineDiagnostics } from "$lib/codemirror/inline-diagnostics";
  import {
    createLabelIndex,
    referenceCompletionSource,
  } from "$lib/codemirror/reference-completion";
  import { refPrefixAt } from "$lib/references";
  import { bibliography } from "$lib/stores/bibliography.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import {
    diagnosticsMatch,
    type DiagnosticMark,
  } from "$lib/codemirror/diagnostics-compare";
  import { imageDrop } from "$lib/codemirror/image-drop";
  import {
    grammarLint,
    setGrammarLints,
  } from "$lib/codemirror/grammar-lint";
  import { search } from "@codemirror/search";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { editorFormat } from "$lib/stores/editor-format.svelte";
  import {
    typst,
    lightTheme,
    darkTheme,
    lightHighlightStyle,
    darkHighlightStyle,
    typstSpellcheck,
    typstCommentDecorations,
    typstListKeymap,
    typstFormatCommands,
  } from "$lib/typst-codemirror-lang";
  import { keysFor } from "$lib/keybindings";
  import { lspClient } from "$lib/lsp/client.svelte";
  import { semanticTokenHighlighter } from "$lib/lsp/semantic-tokens";
  import { Compartment } from "@codemirror/state";
  import { mode, systemPrefersMode } from "mode-watcher";
  import { untrack } from "svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { grammar } from "$lib/stores/grammar.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import {
    getCompletions,
    getTooltip as getTooltipIpc,
  } from "$lib/ipc/commands";
  import type { SerializedDiagnostic, TooltipResponse } from "$lib/types";
  import { indentationMarkers } from "@replit/codemirror-indentation-markers";
  import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
  import { logError, logPreview } from "$lib/logger";


  let editorHost = $state<HTMLDivElement | null>(null);
  const tabViews = new Map<string, EditorView>();

  // Labels come from the open buffers rather than from a project-wide scan:
  // they are already in memory and current, so reference completion costs no
  // IPC. The trade-off is that a label in a file nobody has opened is not
  // offered — acceptable, since referencing one means you were just there.
  const projectLabels = createLabelIndex({
    buffers: () =>
      editor.tabs
        .filter((tab) => tab.viewMode === "text" && tab.relPath.endsWith(".typ"))
        .map((tab) => ({ path: tab.relPath, text: tab.content })),
  });
  // Citation keys join the same list: Typst resolves `@key` against labels and
  // bibliography entries alike, so a citation is not separate syntax the user
  // has to remember.
  const referenceCompletions = referenceCompletionSource(
    projectLabels,
    () => bibliography.entries,
  );
  let mountedTabId = $state<string | null>(null);

  const themeCompartment = new Compartment();
  const fontCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const indentMarkersCompartment = new Compartment();
  const lineWrapCompartment = new Compartment();
  const spellcheckCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  // Lezer syntax highlighting (swapped off per-file once tinymist paints tokens).
  const highlightCompartment = new Compartment();
  // User-configurable shortcuts — reconfigured when the keymap settings change.
  const keybindingsCompartment = new Compartment();
  // Typst language service: either the tinymist plugin or the typst-ide fallback.
  const lspCompartment = new Compartment();

  function quoteFamily(family: string): string {
    return family.includes(" ") && !family.includes('"') ? `"${family}"` : family;
  }

  function fontExtension() {
    const family = quoteFamily(settings.editorFontFamily);
    const size = `${settings.editorFontSize}px`;
    return EditorView.theme({
      "&": {
        fontSize: size,
        fontFamily: `${family}, var(--font-mono, monospace)`,
      },
      ".cm-content, .cm-gutters": {
        fontFamily: `${family}, var(--font-mono, monospace)`,
      },
    });
  }

  function lineNumbersExt() {
    return settings.showLineNumbers ? lineNumbers() : [];
  }

  function indentMarkersExt() {
    return settings.showIndentationMarkers ? indentationMarkers() : [];
  }

  function lineWrapExt() {
    return settings.wordWrap ? EditorView.lineWrapping : [];
  }

  function spellcheckExt(isTypst: boolean) {
    const attrs = EditorView.contentAttributes.of({
      spellcheck: settings.spellcheck ? "true" : "false",
    });
    if (isTypst && settings.spellcheck) {
      return [attrs, typstSpellcheck];
    }
    return [attrs];
  }

  function tabSizeExt() {
    return EditorState.tabSize.of(settings.tabWidth);
  }

  function isDarkMode() {
    return mode.current === "dark" || systemPrefersMode.current === "dark";
  }

  // Chrome theme only (colors/gutters/etc.) — the Lezer highlight style is a
  // separate compartment so it can be removed per-file once tinymist takes over.
  function resolvedTheme() {
    return isDarkMode() ? darkTheme : lightTheme;
  }

  function resolvedHighlightStyle() {
    return isDarkMode() ? darkHighlightStyle : lightHighlightStyle;
  }

  // Lezer highlighting is always on: it's the base layer. tinymist's semantic
  // tokens are *supplementary* — they render at higher precedence (inner DOM
  // nodes) and override the base only where they have an opinion, so a slow or
  // partial token response never leaves text unstyled.
  function highlightExt() {
    return [
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(resolvedHighlightStyle()),
    ];
  }

  // Typst language service for a tab: the tinymist plugin (+ semantic tokens)
  // when active for this file, otherwise the typst-ide IPC completions + hover.
  function typstLanguageServiceExt(tabId: string) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    const relPath = tab?.relPath ?? tabId;
    const isTypst = relPath.endsWith(".typ");
    if (!isTypst || !tab || tab.viewMode !== "text") return [];

    const lspExt = lspClient.pluginFor(tab.absPath);
    if (lspExt) {
      return [lspExt, semanticTokenHighlighter];
    }

    return [
      autocompletion({
        override: [referenceCompletions, mergedTypstCompletionsForTab(tabId)],
      }),
      hoverTooltip(
        async (_view, pos) => {
          const t = editor.tabs.find((tab) => tab.id === tabId);
          if (!t || t.viewMode !== "text") return null;

          const tooltipResult = await getTooltipIpc(t.absPath, pos);
          if (tooltipResult.isErr() || tooltipResult.value === null) return null;

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
    ];
  }

  /**
   * Convert a typst-ide completion `apply` string into a CodeMirror snippet
   * template. typst-ide marks placeholders as `${name}` (default text, e.g.
   * `${body}`) or `${}` (empty). CodeMirror's snippet parser treats `${…}` and
   * `#{…}` as fields and only honors `\{` / `\}` as escapes — so we escape every
   * literal brace. That neutralizes Typst's own `#{…}` code blocks and stray
   * braces while leaving real placeholders as tabstops (the first is selected on
   * accept; Tab/Escape jump through the rest, empty ones land the cursor only).
   */
  function typstApplyToSnippet(apply: string): string {
    let out = "";
    for (let i = 0; i < apply.length; i++) {
      const ch = apply[i];
      if (ch === "$" && apply[i + 1] === "{") {
        const end = apply.indexOf("}", i + 2);
        if (end !== -1) {
          const inner = apply.slice(i + 2, end);
          out += "${" + inner.replace(/[{}]/g, "\\$&") + "}";
          i = end; // for-loop ++ advances past the closing brace
          continue;
        }
      }
      out += ch === "{" || ch === "}" ? "\\" + ch : ch;
    }
    return out;
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
      const hasWordBeforeCursor = context.matchBefore(/[\w-]+/);
      if (
        !context.explicit &&
        (!hasWordBeforeCursor ||
          hasWordBeforeCursor.from === hasWordBeforeCursor.to)
      ) {
        return null;
      }

      const tab = editor.tabs.find((t) => t.id === tabId);
      if (!tab || tab.viewMode !== "text") return null;

      // Inside an `@…`, the reference source owns the list. Two sources
      // answering the same position with different `from` offsets produces a
      // list CodeMirror cannot filter coherently.
      if (refPrefixAt(context.state.doc.toString(), context.pos)) return null;

      const [languageResults, backendResult] = await Promise.all([
        getLanguageCompletionResults(context),
        getCompletions(tab.absPath, context.pos, context.explicit ),
      ]);

      const languageOptions = languageResults.flatMap(
        (result) => result.options ?? [],
      );
      const backendPayload = backendResult.isOk() ? backendResult.value : null;
      // Keep the raw apply string for the dedup key: typst-ide's `${…}`
      // placeholders are turned into a CodeMirror snippet (a function apply), so
      // the option itself no longer carries a stable string to key on.
      const backendOptions: { option: Completion; key: string }[] = backendPayload
        ? backendPayload.completions.map((item) => {
            const rawApply = item.apply ?? item.label;
            const type = mapBackendCompletionKind(item.kind);
            return {
              option: {
                label: item.label,
                type,
                apply: rawApply.includes("${")
                  ? snippet(typstApplyToSnippet(rawApply))
                  : rawApply,
                detail: item.detail ?? undefined,
              },
              key: `${item.label}::${rawApply}::${type ?? ""}`,
            };
          })
        : [];

      const seenKeys = new Set<string>();
      const mergedOptions: Completion[] = [];
      const pushUnique = (option: Completion, key: string) => {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        mergedOptions.push(option);
      };

      backendOptions.forEach(({ option, key }) => pushUnique(option, key));
      languageOptions.forEach((option) =>
        pushUnique(
          option,
          `${option.label}::${option.apply ?? ""}::${option.type ?? ""}`,
        ),
      );

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
        return typst({ codeLanguages: resolveCodeLanguage });
      case ".md":
      case ".markdown":
        return markdown({ codeLanguages: resolveCodeLanguage });
      default:
        // Every other file type resolves through the shared langs table
        // (keyed on file extension); null = plain text.
        return langExtensionForPath(relPath);
    }
  }

  // Every shortcut the user can rebind, resolved through the keymap settings.
  // One CodeMirror binding per chord — a command may answer to several.
  function configurableKeymap(tabId: string) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    const isTypst = (tab?.relPath ?? tabId).endsWith(".typ");

    const commands: Record<string, (view: EditorView) => boolean> = {
      "editor.save": () => {
        editor.saveTabById(tabId).mapErr((err) => logError("save error:", err));
        return true;
      },
      "editor.format": (view) => {
        const cursor = view.state.selection.main.head;
        editor
          .formatTabById(tabId, cursor)
          .mapErr((err) => logError("format error:", err));
        return true;
      },
      "editor.find": () => {
        editorSearch.toggleFindPanel();
        return true;
      },
      "editor.replace": () => {
        editorSearch.toggleReplacePanel();
        return true;
      },
      // Falls through when the panel is closed, so Escape keeps its other
      // meanings (dismissing completions, leaving a snippet field).
      "editor.closeSearch": () => {
        if (!editorSearch.open) return false;
        editorSearch.closePanel();
        return true;
      },
      ...(isTypst
        ? {
            ...typstFormatCommands,
            "typst.insertSymbol": () => {
              ui.symbolPickerOpen = true;
              return true;
            },
          }
        : {}),
    };

    const bindings = Object.entries(commands).flatMap(([id, run]) =>
      keysFor(id).map((key) => ({ key, run })),
    );
    return keymap.of(bindings);
  }

  function makeExtensions(tabId: string) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    const relPath = tab?.relPath ?? tabId;
    const isTypst = relPath.endsWith(".typ");
    const langExt = getLanguageExtension(relPath);

    return [
      // Error-lens-style inline messages instead of a lint gutter — the
      // diagnostic text renders faded at the end of the offending line.
      inlineDiagnostics(),
      // Grammar lints live in their own layer, not `@codemirror/lint`, so
      // compile diagnostics and Harper never overwrite one another.
      // Both actions change the configuration, and the store re-checks every
      // open buffer when that happens — so there's nothing to re-run here.
      grammarLint({
        onAddToDictionary: (word) => void grammar.addWord(word),
        onDisableRule: (rule) => void grammar.setRuleEnabled(rule, false),
      }),
      lineNumbersCompartment.of(lineNumbersExt()),
      lineWrapCompartment.of(lineWrapExt()),
      spellcheckCompartment.of(spellcheckExt(isTypst)),
      tabSizeCompartment.of(tabSizeExt()),
      highlightActiveLine(),
      history(),
      drawSelection(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      // .typ: Typst language service (tinymist plugin, or typst-ide fallback)
      // — swappable via lspCompartment. Others: the language package's own
      // completions.
      ...(isTypst
        ? [lspCompartment.of(typstLanguageServiceExt(tabId))]
        : [autocompletion()]),
      indentOnInput(),
      // Lezer highlighting — the always-on base layer; semantic tokens layer
      // over it (see typstLanguageServiceExt / semanticTokenHighlighter).
      highlightCompartment.of(highlightExt()),
      themeCompartment.of(resolvedTheme()),
      fontCompartment.of(fontExtension()),
      // Language extension chosen by file extension; null = plain text
      ...(langExt ? [langExt] : []),
      ...(isTypst ? [typstCommentDecorations, keymap.of(typstListKeymap)] : []),
      // Dropping an image imports it and writes `#image(…)` — Typst-only,
      // since that call means nothing in the other file types we open.
      ...(isTypst ? [imageDrop()] : []),
      indentMarkersCompartment.of(indentMarkersExt()),
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
      // User-configurable bindings BEFORE vscodeKeymap, so a rebind wins over
      // vscodeKeymap's built-ins (Mod-f = openSearchPanel, Shift-Alt-f =
      // Format Document) rather than losing to them.
      keybindingsCompartment.of(configurableKeymap(tabId)),
      keymap.of(vscodeKeymap),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        indentWithTab,
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
        // Mirror the range for the panes that display it (outline marker,
        // status-bar counts). Unconditional — unlike the persist below, which
        // only wants pure caret moves.
        const range = update.state.selection.main;
        editor.noteSelection(tabId, range.from, range.to);
        // Stage 1 (jump source): the editor selection moved. This is what
        // ultimately drives the preview's cursor-follow scroll. `docChanged`
        // distinguishes a keystroke (typing) from a pure caret move (click /
        // arrow key) — the former is the case the user is debugging.
        logPreview("cursor:selection-set", {
          path: tab.absPath,
          cursor,
          docChanged: update.docChanged,
        });
        // Only show the cursor-sync highlight for a pure caret move (click /
        // arrow key) — a selection change caused by typing shouldn't flash a
        // highlight on every keystroke.
        preview.setCursorPosition(tab.absPath, cursor, !update.docChanged);
        // Keep the persisted caret current. A typing-driven move is already
        // covered by handleTabContentChange's persist, so only pure caret
        // moves need to schedule one here.
        if (!update.docChanged) editor.noteCursorMoved(tabId);
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
      // Keep the formatting toolbar's active state in sync with the cursor.
      EditorView.updateListener.of((update) => {
        if (editorSearch.getActiveView() !== update.view) return;
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          editorFormat.refresh(update.view);
        }
      }),
      // ayuLight,
      EditorView.theme({
        "&": {
          height: "100%",
          width: "100%",
        },
        ".cm-scroller": { overflow: "auto" },
        // Line-number gutter — give the digits breathing room from the
        // content and a muted tone so they don't compete with the code.
        ".cm-lineNumbers .cm-gutterElement": {
          padding: "0 0.4rem",
          minWidth: "1em",
          textAlign: "center",
        },
        ".cm-foldGutter .cm-gutterElement": {
          padding: "0 0.1rem",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)",
          color: "var(--foreground)",
        },
        // Clear gap between the gutter border and the first code character
        ".cm-content": {
          paddingLeft: "0.875rem",
        },
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
        ".cm-tooltip.cm-tooltip-lint": {
          backgroundColor: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-md)",
          padding: "0",
          maxWidth: "32rem",
        },
        ".cm-tooltip.cm-tooltip-lint .cm-diagnostic": {
          color: "var(--popover-foreground)",
          padding: "0.375rem 0.5rem",
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          lineHeight: "1.45",
          borderLeft: "3px solid transparent",
        },
        ".cm-tooltip.cm-tooltip-lint .cm-diagnostic-error": {
          borderLeftColor: "var(--destructive)",
        },
        ".cm-tooltip.cm-tooltip-lint .cm-diagnostic-warning": {
          borderLeftColor: "#f59e0b",
        },
        ".cm-tooltip.cm-tooltip-lint .cm-diagnostic-info": {
          borderLeftColor: "var(--ring)",
        },
        ".cm-diagnosticText": {
          whiteSpace: "pre-wrap",
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

  function mountActiveView(activeTabId: string | null) {
    if (!editorHost) return;
    const activeTab = activeTabId
      ? (editor.tabs.find((tab) => tab.id === activeTabId) ?? null)
      : null;
    if (!activeTab || activeTab.viewMode !== "text" || activeTab.isLoading) {
      editorHost.replaceChildren();
      mountedTabId = null;
      editorSearch.setActiveView(null);
      editorFormat.reset();
      return;
    }

    const view = ensureView(activeTab.id);
    if (!view) return;

    // Note: we deliberately do NOT push tab.content into the view here.
    // ensureView seeds the doc from tab.content on first creation, and
    // after that the contentSyncRequest effect is the only path that
    // writes external content into the view. A reactive read of
    // tab.content here would race with formatTabById and clobber the
    // cursor returned by the cursor maintenance algorithm.

    if (mountedTabId !== activeTab.id) {
      editorHost.replaceChildren(view.dom);
      mountedTabId = activeTab.id;
    }

    editorSearch.setActiveView(view);
    editorFormat.refresh(view);
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

  // Let the store read the live selection of any tab's view — this is how
  // format paths without an explicit cursor (format-on-save, idle-save) get
  // cursor maintenance. See EditorStore.cursorProvider.
  $effect(() => {
    editor.cursorProvider = (tabId) =>
      tabViews.get(tabId)?.state.selection.main.head;
    return () => {
      editor.cursorProvider = null;
    };
  });

  $effect(() => {
    return () => {
      for (const view of tabViews.values()) view.destroy();
      tabViews.clear();
      mountedTabId = null;
      editorSearch.setActiveView(null);
      editorFormat.reset();
    };
  });

  // ── Store → Editor: push externally-replaced content (e.g. format) into CM.
  // Cursor maintenance lives on the Rust side (see commands/format.rs) so it
  // can work in UTF-8 byte space without confusing JavaScript's UTF-16 string
  // indexing. Here we just diff to a minimal changeset and, if the store
  // supplied a cursor, set the selection to it.
  $effect(() => {
    const req = editor.contentSyncRequest;
    if (!req) return;
    const view = tabViews.get(req.tabId);
    if (!view) return;
    const oldText = view.state.doc.toString();
    const newText = req.content;
    const cursorAlreadyMatches =
      typeof req.cursor !== "number" ||
      view.state.selection.main.head === req.cursor;
    if (oldText === newText && cursorAlreadyMatches) return;

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

    // Apply the content change first, with no selection — combining changes
    // and selection in a single dispatch causes CM to map the selection
    // through the change set (old-doc space), which corrupts positions from
    // the Rust cursor maintenance algorithm (which are in new-doc space).
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({
      changes: { from: lcp, to: oldEnd, insert: newText.slice(lcp, newEnd) },
      scrollIntoView: false,
    });

    // Now set the cursor in the new document. If Rust returned one, use it —
    // the algorithm already works in the correct coordinate space. Otherwise
    // fall back to a simple delta map for cursors outside the changed region
    // (callers without a cursor don't need precision here).
    const oldCursor = view.state.selection.main.head;
    let newCursor: number;
    if (typeof req.cursor === "number") {
      newCursor = req.cursor;
    } else if (oldCursor <= lcp) {
      newCursor = oldCursor;
    } else if (oldCursor >= oldEnd) {
      newCursor = oldCursor + (newText.length - oldText.length);
    } else {
      newCursor = Math.min(oldCursor, newEnd);
    }

    // Clamp defensively: an out-of-bounds anchor makes dispatch throw a
    // RangeError, killing this effect mid-sync. The doc is `newText` at this
    // point, but read the live length in case anything intervened.
    newCursor = Math.max(0, Math.min(newCursor, view.state.doc.length));
    view.dispatch({
      selection: { anchor: newCursor },
      scrollIntoView: false,
    });
    view.scrollDOM.scrollTop = scrollTop;
  });

  // ── Preview → Editor: apply cursor jump requested by preview click.
  // Depends on `mountedTabId` as well as the request: when the jump targets a
  // tab whose view isn't built yet (file still loading, mount slower than one
  // frame), the request stays pending and this re-runs once the view mounts —
  // retrying on a single rAF is not enough, since the mount can take longer
  // than one frame.
  $effect(() => {
    const req = editor.cursorJumpRequest;
    mountedTabId;
    if (!req) return;
    // rAF lets any pending tab mount complete before we look up the view
    requestAnimationFrame(() => {
      if (editor.cursorJumpRequest?.tabId !== req.tabId) return;
      const view = tabViews.get(req.tabId);
      if (!view) {
        // Keep the request pending while its tab still exists (the mount
        // dependency will retry); drop it once the tab is gone so a stale
        // jump can't fire on a much later remount.
        if (!editor.tabs.some((t) => t.id === req.tabId)) {
          editor.cursorJumpRequest = null;
        }
        return;
      }
      editor.cursorJumpRequest = null;
      const offset = Math.max(0, Math.min(req.offset, view.state.doc.length));
      view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
      if (!editorSearch.open) view.focus();
    });
  });

  // ── Theme → reconfigure all views when mode changes
  $effect(() => {
    const _ = mode.current;
    const __ = systemPrefersMode.current;
    const themeExt = resolvedTheme();
    // The highlight style is theme-dependent too, so refresh it alongside the
    // chrome theme. untrack the loop so the dispatches don't re-trigger us.
    const highlightExtValue = highlightExt();
    untrack(() => {
      for (const view of tabViews.values()) {
        view.dispatch({
          effects: [
            themeCompartment.reconfigure(themeExt),
            highlightCompartment.reconfigure(highlightExtValue),
          ],
        });
      }
    });
  });

  // ── LSP active/inactive → swap the language service (tinymist plugin +
  // semantic tokens ⇄ typst-ide fallback). Lezer highlighting is the always-on
  // base layer, so it doesn't change here. Mounting the LSP plugin sends
  // didOpen; unmounting sends didClose (handled by @codemirror/lsp-client).
  $effect(() => {
    const lspActive = lspClient.isActive;
    untrack(() => {
      for (const [tabId, view] of tabViews) {
        view.dispatch({
          effects: lspCompartment.reconfigure(typstLanguageServiceExt(tabId)),
        });
        // Diagnostic-source hand-off: tinymist and the compile pipeline must
        // never both feed the lint state. On activation, drop the compile
        // pipeline's marks (tinymist repopulates via serverDiagnostics); on
        // deactivation, repopulate from the store (which drops LSP leftovers).
        if (lspActive) {
          if (!diagnosticsUnchanged(view.state, [])) {
            view.dispatch(setDiagnostics(view.state, []));
          }
        } else {
          applyDiagnosticsToView(tabId, view);
        }
      }
    });
  });

  // ── Settings → CodeMirror compartments
  //
  // One table instead of seven near-identical effects. `track` names the
  // settings the compartment depends on and is the *only* place reads are
  // tracked; `build` and the dispatch loop run untracked, because reconfiguring
  // a view reads editor state that would otherwise become a dependency and
  // re-fire this on every keystroke.
  //
  // Adding a setting-driven compartment means adding a row here.
  const settingCompartments: {
    compartment: Compartment;
    track: () => void;
    build: (tabId: string) => Extension;
  }[] = [
    {
      compartment: fontCompartment,
      track: () => {
        settings.editorFontFamily;
        settings.editorFontSize;
      },
      build: () => fontExtension(),
    },
    {
      compartment: lineNumbersCompartment,
      track: () => void settings.showLineNumbers,
      build: () => lineNumbersExt(),
    },
    {
      compartment: indentMarkersCompartment,
      track: () => void settings.showIndentationMarkers,
      build: () => indentMarkersExt(),
    },
    {
      compartment: lineWrapCompartment,
      track: () => void settings.wordWrap,
      build: () => lineWrapExt(),
    },
    {
      compartment: tabSizeCompartment,
      track: () => void settings.tabWidth,
      build: () => tabSizeExt(),
    },
    {
      compartment: spellcheckCompartment,
      track: () => void settings.spellcheck,
      build: (tabId) => {
        const tab = editor.tabs.find((t) => t.id === tabId);
        return spellcheckExt(!!tab && tab.relPath.endsWith(".typ"));
      },
    },
    {
      // Rebinding in the settings window broadcasts on `settings:changed`, so
      // this fires there too and the editor picks up new keys without a restart.
      compartment: keybindingsCompartment,
      track: () => void settings.keybindings,
      build: (tabId) => configurableKeymap(tabId),
    },
  ];

  for (const { compartment, track, build } of settingCompartments) {
    $effect(() => {
      track();
      untrack(() => {
        for (const [tabId, view] of tabViews) {
          view.dispatch({ effects: compartment.reconfigure(build(tabId)) });
        }
      });
    });
  }

  // ── Diagnostics → CodeMirror lint markers
  //
  // Two effects: one that fans out when the diagnostics themselves change
  // (file boundaries may have moved, so every tab's view needs a refresh),
  // and one that pushes only to the newly mounted view on tab switch. The
  // previous single-effect version walked every tabView on every tab switch,
  // re-dispatching unchanged diagnostics to background tabs.
  function applyDiagnosticsToView(tabId: string, view: EditorView) {
    // When tinymist owns diagnostics, its own serverDiagnostics extension (part
    // of languageServerExtensions()) already renders the lint gutter with
    // correct position mapping; re-pushing the store here would double-write it.
    if (diagnostics.lspActive) return;
    const tab = editor.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const allDiags = [...diagnostics.errors, ...diagnostics.warnings];
    const marks = allDiags
      .filter((d) => d.file_path === tab.relPath)
      .map((d) => toCMDiagnostic(d, view))
      .filter((d): d is CMDiagnostic => d !== null);
    // Skip no-op re-dispatches: every `setDiagnosticsEffect` closes an open
    // lint hover tooltip (the lint extension's `hideOn`), so pushing identical
    // diagnostics on each compile cycle made the tooltip vanish mid-read.
    if (diagnosticsUnchanged(view.state, marks)) return;
    view.dispatch(setDiagnostics(view.state, marks));
  }

  function diagnosticsUnchanged(
    state: EditorState,
    marks: CMDiagnostic[],
  ): boolean {
    const existing: DiagnosticMark[] = [];
    forEachDiagnostic(state, (d, from, to) =>
      existing.push({ from, to, severity: d.severity, message: d.message }),
    );
    return diagnosticsMatch(existing, marks);
  }

  $effect(() => {
    // Track diagnostics + tab list so this re-runs when either changes.
    diagnostics.errors;
    diagnostics.warnings;
    editor.tabs;
    untrack(() => {
      for (const [tabId, view] of tabViews) {
        applyDiagnosticsToView(tabId, view);
      }
    });
  });

  $effect(() => {
    const id = mountedTabId;
    if (!id) return;
    untrack(() => {
      const view = tabViews.get(id);
      if (view) applyDiagnosticsToView(id, view);
    });
  });

  // ── Grammar lints → their own decoration layer
  //
  // Separate from the diagnostics path above on purpose: grammar results
  // arrive on their own (debounced, per-file) schedule and must not be cleared
  // when a compile or an LSP toggle rewrites the lint state.
  function applyGrammarToView(tabId: string, view: EditorView) {
    const tab = editor.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    view.dispatch({
      effects: setGrammarLints.of(grammar.lintsFor(tab.relPath)),
    });
  }

  $effect(() => {
    // Re-runs whenever a report lands or a tab opens/closes.
    grammar.reports;
    editor.tabs;
    untrack(() => {
      for (const [tabId, view] of tabViews) applyGrammarToView(tabId, view);
    });
  });

  $effect(() => {
    const id = mountedTabId;
    if (!id) return;
    untrack(() => {
      const view = tabViews.get(id);
      if (view) applyGrammarToView(id, view);
    });
  });
</script>

<div bind:this={editorHost} class="h-full w-full overflow-hidden"></div>
