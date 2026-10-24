<script lang="ts">
  import {
    EditorView,
    closeHoverTooltips,
    hoverTooltip,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    tooltips,
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
    closeCompletion,
    completionStatus,
    startCompletion,
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
  import { editorAccessibility } from "$lib/codemirror/accessibility";
  import { inlineDiagnostics } from "$lib/codemirror/inline-diagnostics";
  import {
    createLabelIndex,
    mergeLabels,
    referenceCompletionSource,
  } from "$lib/codemirror/reference-completion";
  import { typstCompletionSource } from "$lib/codemirror/typst-completion";
  import { bibliography } from "$lib/stores/bibliography.svelte";
  import { documentScope } from "$lib/stores/document-scope.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import {
    focusMode,
    typewriterScrolling,
    programmaticSync,
  } from "$lib/codemirror/focus-mode";
  import { snippetCompletionSource } from "$lib/codemirror/snippet-completion";
  import { snippets } from "$lib/stores/snippets.svelte";
  import {
    diagnosticsMatch,
    type DiagnosticMark,
  } from "$lib/codemirror/diagnostics-compare";
  import { imageDrop } from "$lib/codemirror/image-drop";
  import { grammarLint, setGrammarLints } from "$lib/codemirror/grammar-lint";
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
  import type { SvelteSet } from "svelte/reactivity";
  import { Compartment } from "@codemirror/state";
  import { mode, systemPrefersMode } from "mode-watcher";
  import { untrack } from "svelte";
  import { watch } from "runed";
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

  // Labels come from two layers. A project-wide disk scan (refreshed with the
  // file tree) means a figure label in a chapter nobody has opened is still
  // offered; the open buffers themselves are layered on top because their
  // unsaved text is what the compiler would actually see. Scanned labels for
  // paths currently open are dropped, so no definition is counted twice and
  // an edited buffer overrides its stale disk copy.
  //
  // Both layers are restricted to the document's scope — files the main file
  // pulls in via `#include`/`#import`, plus the file being edited (an
  // unreachable chapter still knows its own labels). Filtering is strict: an
  // empty scope means an empty list, never a fallback to everything.
  const openTypBuffers = () =>
    editor.tabs
      .filter(
        (tab) =>
          tab.viewMode === "text" &&
          !tab.isLoading &&
          tab.relPath.endsWith(".typ"),
      )
      .map((tab) => ({ path: tab.relPath, text: tab.content }));
  const activeTypPath = () => {
    const tab = editor.tabs.find((t) => t.id === editor.activeTabId);
    return tab && tab.viewMode === "text" && !tab.isLoading && tab.relPath.endsWith(".typ")
      ? tab.relPath
      : null;
  };
  const openTabLabels = createLabelIndex({ buffers: openTypBuffers });
  const syncScopeBuffers = () => documentScope.setBuffers(openTypBuffers());
  const projectLabels = () => {
    documentScope.ensureFresh();
    const scope = documentScope.reachableFiles;
    const inScope = <T extends { path: string }>(items: readonly T[]) =>
      items.filter((item) => scope.has(item.path));
    return mergeLabels(
      inScope(documentScope.entries),
      inScope(openTabLabels()),
    );
  };
  // Citation keys join the same list: Typst resolves `@key` against labels and
  // bibliography entries alike, so a citation is not separate syntax the user
  // has to remember. Only keys from files a reachable `#bibliography(...)`
  // actually loads are offered — the rest cannot resolve.
  const scopedCitations = () => {
    documentScope.ensureFresh();
    const bibs = documentScope.scopedBibPaths;
    return bibliography.entries.filter((entry) => bibs.has(entry.path));
  };
  const referenceCompletions = referenceCompletionSource(
    projectLabels,
    scopedCitations,
  );
  const snippetCompletions = snippetCompletionSource(() => snippets.all);
  let mountedTabId = $state<string | null>(null);

  const accessibilityCompartment = new Compartment();
  const componentId = $props.id();
  const accessibilityHelpId = `${componentId}-editor-help`;

  function accessibilityExt(tabId: string) {
    const tab = editor.tabs.find((tab) => tab.id === tabId);
    return editorAccessibility(settings.screenReaderMode, `Source editor: ${tab?.relPath ?? tabId}`, accessibilityHelpId);
  }

  const themeCompartment = new Compartment();
  const fontCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const indentMarkersCompartment = new Compartment();
  const lineWrapCompartment = new Compartment();
  const spellcheckCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const focusCompartment = new Compartment();
  // Lezer syntax highlighting (swapped off per-file once tinymist paints tokens).
  const highlightCompartment = new Compartment();
  // User-configurable shortcuts — reconfigured when the keymap settings change.
  const keybindingsCompartment = new Compartment();
  // Typst language service: either the tinymist plugin or the typst-ide fallback.
  const lspCompartment = new Compartment();

  function quoteFamily(family: string): string {
    return family.includes(" ") && !family.includes('"')
      ? `"${family}"`
      : family;
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

  // Two independent settings, one compartment: they are always reconfigured
  // together and neither has state the other would disturb.
  function focusExt() {
    return [
      settings.focusMode ? focusMode() : [],
      settings.typewriterScrolling ? typewriterScrolling() : [],
    ];
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
      return [
        lspExt,
        semanticTokenHighlighter,
        // Snippets are ours, not tinymist's — without this they'd vanish the
        // moment the language server connected. `serverCompletion()` publishes
        // its source through language data (not an `override`), so registering
        // ours the same way merges the two lists rather than replacing the
        // server's.
        EditorState.languageData.of(() => [
          { autocomplete: snippetCompletions },
          { autocomplete: referenceCompletions },
        ]),
      ];
    }

    const builtInCompletions = typstCompletionsForTab(tabId);
    return [
      autocompletion(),
      // Each source owns its replacement range and filtering rules, including
      // native languages mounted in raw blocks.
      EditorState.languageData.of(() => [
        { autocomplete: builtInCompletions },
        { autocomplete: referenceCompletions },
        { autocomplete: snippetCompletions },
      ]),
      hoverTooltip(
        async (_view, pos) => {
          const t = editor.tabs.find((tab) => tab.id === tabId);
          if (!t || t.viewMode !== "text") return null;

          const tooltipResult = await getTooltipIpc(t.absPath, pos);
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
    ];
  }

  function typstCompletionsForTab(tabId: string) {
    return typstCompletionSource(async (text, pos, explicit) => {
      const tab = editor.tabs.find((t) => t.id === tabId);
      if (!tab || tab.viewMode !== "text") return null;
      const result = await getCompletions(tab.absPath, pos, explicit, text);
      return result.isOk() ? result.value : null;
    });
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
      // Escape pane clipping and WebKit's fixed-position containing blocks.
      // Shared by LSP/fallback hovers, diagnostics, grammar and completions.
      tooltips({ parent: document.body }),
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
      accessibilityCompartment.of(accessibilityExt(tabId)),
      lineNumbersCompartment.of(lineNumbersExt()),
      lineWrapCompartment.of(lineWrapExt()),
      spellcheckCompartment.of(spellcheckExt(isTypst)),
      tabSizeCompartment.of(tabSizeExt()),
      focusCompartment.of(focusExt()),
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
        // Keep the document scope (reachable files, associated bibliographies)
        // in step with the live text; the store debounces internally.
        syncScopeBuffers();
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
        "&.cm-editor": {
          height: "100%",
          width: "100%",
        },
        // Above workspace chrome, below portaled dialogs and menus (z-50).
        ".cm-tooltip": {
          zIndex: 40,
          userSelect: "text",
          WebkitUserSelect: "text",
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
    if (mountedTabId && mountedTabId !== activeTabId) {
      const previous = tabViews.get(mountedTabId);
      if (previous) {
        previous.dispatch({ effects: closeHoverTooltips });
        closeCompletion(previous);
      }
    }
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

  watch(
    [
      () => editor.activeTabId,
      () => editor.tabs
        .map((tab) => `${tab.id}:${tab.viewMode}:${tab.isLoading ? "1" : "0"}`)
        .join("|"),
      () => editorHost,
    ],
    ([activeTabId]) => {
      destroyClosedTabViews();
      mountActiveView(activeTabId);
      // Tabs opened or closed: the buffer layer feeding the document scope
      // changed even though no docChanged event fired in any view.
      syncScopeBuffers();
      // The file being edited seeds its own subgraph into the scope.
      documentScope.setActiveFile(activeTypPath());
    },
  );

  // When the document's scope changes (a refs array edited, an include
  // removed, the main file switched), a completion popup that is already
  // open would keep filtering its original — now outdated — result set.
  // Restart it so the visible list snaps to the rebuilt mappings.
  let prevReachable: SvelteSet<string> | null = null;
  let prevBibs: SvelteSet<string> | null = null;
  $effect(() => {
    const reachable = documentScope.reachableFiles;
    const bibs = documentScope.scopedBibPaths;
    const changed =
      prevReachable !== null && (reachable !== prevReachable || bibs !== prevBibs);
    prevReachable = reachable;
    prevBibs = bibs;
    if (!changed) return;

    const view = mountedTabId ? tabViews.get(mountedTabId) : undefined;
    if (!view || completionStatus(view.state) !== "active") return;
    closeCompletion(view);
    startCompletion(view);
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
  watch([() => editor.contentSyncRequest, () => mountedTabId], ([req]) => {
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
      // Not user movement — typewriter scrolling must leave the viewport
      // alone; the scrollTop below restores whatever the dispatch displaced.
      annotations: programmaticSync.of(true),
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
      annotations: programmaticSync.of(true),
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
    const frame = requestAnimationFrame(() => {
      if (editor.cursorJumpRequest !== req) return;
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
    return () => cancelAnimationFrame(frame);
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
      compartment: accessibilityCompartment,
      track: () => { settings.screenReaderMode; editor.tabs.map((tab) => tab.relPath); },
      build: accessibilityExt,
    },
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
      compartment: focusCompartment,
      track: () => {
        settings.focusMode;
        settings.typewriterScrolling;
      },
      build: () => focusExt(),
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

<p id={accessibilityHelpId} class="sr-only">
  {#if settings.screenReaderMode}
    Tab and Shift+Tab move between controls. Control+Alt navigation is reserved for assistive technology.
  {:else}
    Tab indents. Press Escape, then Tab to leave the editor.
  {/if}
  Screen reader mode is available in Settings, Accessibility, and the command palette.
  With NVDA, use NVDA+Space to switch between editing and browse mode.
</p>
<div bind:this={editorHost} class="h-full w-full overflow-hidden"></div>
