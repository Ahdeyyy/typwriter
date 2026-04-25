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
  import { typst,light  } from "$lib/typst-codemirror-lang";
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
        return typst();
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
      light,
      // Language extension chosen by file extension; null = plain text
      ...(langExt ? [langExt] : []),
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
          height: "93svh",
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

<div bind:this={editorHost} class="h-95svh w-full overflow-hidden"></div>
