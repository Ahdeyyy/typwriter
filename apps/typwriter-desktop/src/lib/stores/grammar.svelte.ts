// Grammar / style checking, backed by Harper on the Rust side.
//
// Deliberately a *separate* channel from `diagnostics`: compile errors and
// grammar suggestions have different lifecycles (one comes from the compile
// pipeline or tinymist, the other from a debounced per-file check) and very
// different urgency. Mixing them would mean a spelling nit could push a real
// compile error out of view, and the LSP toggle — which clears the diagnostics
// store on both edges — would wipe grammar results too.

import { ResultAsync, okAsync } from "neverthrow";
import {
  addGrammarDictionaryWord,
  checkGrammar,
  getGrammarConfig,
  getGrammarRules,
  setGrammarConfig,
  setGrammarFileEnabled,
} from "$lib/ipc/commands";
import type {
  GrammarConfig,
  GrammarDialect,
  GrammarLint,
  GrammarReport,
  GrammarRuleInfo,
} from "$lib/types";
import { emitGrammarConfigChanged } from "$lib/ipc/events";
import { logError } from "$lib/logger";

/** How long the buffer must be quiet before a re-check. Long enough that
 *  ordinary typing never triggers one — a grammar pass over a large document
 *  is far heavier than a preview compile, and half-typed words produce
 *  suggestions that are noise by construction. */
const IDLE_CHECK_DELAY_MS = 900;

/** Coalescing window for a configuration-driven re-check. Short enough to feel
 *  immediate; long enough that the local apply and the broadcast echoing back
 *  from `emitGrammarConfigChanged` cost one Harper pass rather than two. */
const CONFIG_RECHECK_DELAY_MS = 60;

const DEFAULT_CONFIG: GrammarConfig = {
  enabled: true,
  dialect: "american",
  rules: {},
  userDictionary: [],
  disabledFiles: [],
};

/** Categories that read as outright mistakes rather than suggestions. Used
 *  only to pick an underline colour. */
const PROBLEM_KINDS = new Set([
  "spelling",
  "typo",
  "agreement",
  "grammar",
  "malapropism",
]);

export type GrammarSeverity = "problem" | "suggestion";

export function grammarSeverity(lint: GrammarLint): GrammarSeverity {
  return PROBLEM_KINDS.has(lint.kind) ? "problem" : "suggestion";
}

class GrammarStore {
  config = $state<GrammarConfig>({ ...DEFAULT_CONFIG });
  /** The full rule catalog, loaded lazily by the settings pane. */
  rules = $state<GrammarRuleInfo[]>([]);
  rulesLoading = $state(false);

  /** Latest report per workspace-relative path. */
  reports = $state<Record<string, GrammarReport>>({});
  /** Paths with a check in flight, so the UI can show progress. */
  checking = $state<string[]>([]);

  /** Supplies the buffers a configuration change should re-check. Registered
   *  by the workspace page, since the open tabs live in the editor store;
   *  absent in windows with no editor (settings, preview), where a config
   *  change has nothing to re-run. Deliberately not reactive state — it's a
   *  callback, not data. */
  openBuffers: (() => { relPath: string; text: string }[]) | null = null;

  private _timers = new Map<string, ReturnType<typeof setTimeout>>();
  private _recheckTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic per-file token; a response whose token is stale is dropped so
   *  a slow check can't overwrite a newer one. */
  private _tokens = new Map<string, number>();

  // ── Lifecycle ────────────────────────────────────────────────────────

  init(): ResultAsync<void, string> {
    return getGrammarConfig()
      .map((config) => {
        this._apply(config);
      })
      .mapErr((err) => {
        logError("grammar: could not load config:", err);
        return err;
      });
  }

  destroy(): void {
    this._clearReports();
    this._tokens.clear();
    if (this._recheckTimer !== null) {
      clearTimeout(this._recheckTimer);
      this._recheckTimer = null;
    }
  }

  // ── Reading results ──────────────────────────────────────────────────

  lintsFor(relPath: string): GrammarLint[] {
    return this.reports[relPath]?.lints ?? [];
  }

  reportFor(relPath: string): GrammarReport | null {
    return this.reports[relPath] ?? null;
  }

  /** Whether this file's type can be checked at all. */
  isSupported(relPath: string): boolean {
    const report = this.reports[relPath];
    return report ? report.format !== null : false;
  }

  isFileDisabled(relPath: string): boolean {
    const target = normalizePath(relPath);
    return this.config.disabledFiles.some(
      (path) => normalizePath(path) === target,
    );
  }

  /** Total lints across every open file — drives the status-bar count. */
  totalLints = $derived(
    Object.values(this.reports).reduce(
      (sum, report) => sum + report.lints.length,
      0,
    ),
  );

  // ── Running checks ───────────────────────────────────────────────────

  /** Re-check after the buffer has been idle. Safe to call on every
   *  keystroke; only the last one in a burst does any work. */
  schedule(relPath: string, text: string): void {
    if (!this.config.enabled) return;
    this._clearTimer(relPath);
    this._timers.set(
      relPath,
      setTimeout(() => {
        this._timers.delete(relPath);
        void this.checkNow(relPath, text);
      }, IDLE_CHECK_DELAY_MS),
    );
  }

  /** Check immediately, cancelling any pending idle check for the file. */
  checkNow(relPath: string, text: string): ResultAsync<void, string> {
    this._clearTimer(relPath);
    if (!this.config.enabled) {
      this._dropReport(relPath);
      return okAsync(undefined);
    }

    const token = (this._tokens.get(relPath) ?? 0) + 1;
    this._tokens.set(relPath, token);
    if (!this.checking.includes(relPath)) {
      this.checking = [...this.checking, relPath];
    }

    return checkGrammar(relPath, text)
      .map((report) => {
        // A newer check started while this one was in flight.
        if (this._tokens.get(relPath) !== token) return;
        this.reports = { ...this.reports, [relPath]: report };
      })
      .mapErr((err) => {
        logError(`grammar: check failed for ${relPath}:`, err);
        return err;
      })
      .andTee(() => this._finishChecking(relPath))
      .orTee(() => this._finishChecking(relPath));
  }

  /** Forget a file's results — on tab close, or when it stops being checked. */
  forget(relPath: string): void {
    this._clearTimer(relPath);
    this._tokens.delete(relPath);
    this._dropReport(relPath);
  }

  // ── Configuration ────────────────────────────────────────────────────

  /** Apply a configuration changed in another window. Never persists and never
   *  re-broadcasts — the window that made the change already did both. */
  applyExternal(config: GrammarConfig): void {
    // The catalog carries each rule's *effective* state, which a reset returns
    // to a curated default this side doesn't know. Refetch rather than try to
    // recompute it — safe to do straight away, since the config reaching us
    // from another window is already the one Rust holds.
    const rulesChanged = !sameRules(this.config.rules, config.rules);
    this._apply(config);
    if (rulesChanged && this.rules.length > 0) {
      this.loadRules(true);
    }
  }

  setEnabled(enabled: boolean): ResultAsync<void, string> {
    return this._updateConfig({ ...this.config, enabled });
  }

  setDialect(dialect: GrammarDialect): ResultAsync<void, string> {
    return this._updateConfig({ ...this.config, dialect });
  }

  setRuleEnabled(rule: string, enabled: boolean): ResultAsync<void, string> {
    const rules = { ...this.config.rules, [rule]: enabled };
    this.rules = this.rules.map((info) =>
      info.name === rule ? { ...info, enabled } : info,
    );
    return this._updateConfig({ ...this.config, rules });
  }

  /** Drop a rule override, returning it to Harper's curated default. */
  resetRule(rule: string): ResultAsync<void, string> {
    const rules = { ...this.config.rules };
    delete rules[rule];
    return this._updateConfig({ ...this.config, rules }).andThen(() =>
      this.loadRules(true),
    );
  }

  resetAllRules(): ResultAsync<void, string> {
    return this._updateConfig({ ...this.config, rules: {} }).andThen(() =>
      this.loadRules(true),
    );
  }

  /** Load the rule catalog. Cached unless `force` is set — the first call
   *  makes Rust build Harper's full lint set. */
  loadRules(force = false): ResultAsync<void, string> {
    if (this.rules.length > 0 && !force) return okAsync(undefined);
    this.rulesLoading = true;
    return getGrammarRules()
      .map((rules) => {
        this.rules = rules;
        this.rulesLoading = false;
      })
      .mapErr((err) => {
        this.rulesLoading = false;
        logError("grammar: could not load rules:", err);
        return err;
      });
  }

  addWord(word: string): ResultAsync<void, string> {
    // Rust owns the merge (dedupe + sort) and has already persisted the result,
    // so this applies the config it hands back rather than writing it again.
    return addGrammarDictionaryWord(word)
      .map((config) => {
        this._apply(config);
        this._broadcast(config);
      })
      .mapErr((err) => {
        logError("grammar: could not add dictionary word:", err);
        return err;
      });
  }

  removeWord(word: string): ResultAsync<void, string> {
    const userDictionary = this.config.userDictionary.filter((w) => w !== word);
    return this._updateConfig({ ...this.config, userDictionary });
  }

  /** Turn checking on or off for one file. */
  setFileEnabled(relPath: string, enabled: boolean): ResultAsync<void, string> {
    return setGrammarFileEnabled(relPath, enabled)
      .map((config) => {
        // Empty the report and mark it rather than forgetting it: the per-file
        // switch is rendered *from* the report, so dropping it would take away
        // the control that switches checking back on. The re-check `_apply`
        // schedules replaces this with the backend's own skipped report.
        if (!enabled) this._markFileDisabled(relPath);
        this._apply(config);
        this._broadcast(config);
      })
      .mapErr((err) => {
        logError(`grammar: could not toggle ${relPath}:`, err);
        return err;
      });
  }

  toggleFile(relPath: string): ResultAsync<void, string> {
    return this.setFileEnabled(relPath, this.isFileDisabled(relPath));
  }

  // ── Internals ────────────────────────────────────────────────────────

  private _updateConfig(config: GrammarConfig): ResultAsync<void, string> {
    this._apply(config);
    this._broadcast(config);
    return setGrammarConfig(config).mapErr((err) => {
      logError("grammar: could not persist config:", err);
      return err;
    });
  }

  /** Adopt a configuration and bring the results back in line with it. Every
   *  part of the config — dialect, rules, dictionary, per-file opt-outs —
   *  changes what counts as a lint, so any change invalidates every report we
   *  hold. */
  private _apply(config: GrammarConfig): void {
    this.config = config;
    if (config.enabled) {
      this._scheduleRecheck();
    } else {
      this._clearReports();
    }
  }

  /** Replay a config change into the other windows. The Grammar settings pane
   *  is a window of its own, so without this the editor never hears about a
   *  change made there (and vice versa). */
  private _broadcast(config: GrammarConfig): void {
    emitGrammarConfigChanged(config).mapErr((err) => {
      logError("grammar: could not broadcast config:", err);
      return err;
    });
  }

  /** Re-check every open buffer, coalescing the local apply with the broadcast
   *  echo. A no-op in windows that hold no buffers. */
  private _scheduleRecheck(): void {
    if (this._recheckTimer !== null) clearTimeout(this._recheckTimer);
    this._recheckTimer = setTimeout(() => {
      this._recheckTimer = null;
      if (!this.config.enabled) return;
      for (const { relPath, text } of this.openBuffers?.() ?? []) {
        void this.checkNow(relPath, text);
      }
    }, CONFIG_RECHECK_DELAY_MS);
  }

  private _clearReports(): void {
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
    this.reports = {};
    this.checking = [];
  }

  /** Keep a file's report but strip it back to "checking is off here", so the
   *  pane still knows the file's format — and still shows its switch. */
  private _markFileDisabled(relPath: string): void {
    const report = this.reports[relPath];
    if (!report) return;
    this.reports = {
      ...this.reports,
      [relPath]: { ...report, skipped: "file-disabled", lints: [] },
    };
  }

  private _clearTimer(relPath: string): void {
    const timer = this._timers.get(relPath);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._timers.delete(relPath);
    }
  }

  private _dropReport(relPath: string): void {
    if (!(relPath in this.reports)) return;
    const { [relPath]: _dropped, ...rest } = this.reports;
    this.reports = rest;
  }

  private _finishChecking(relPath: string): void {
    this.checking = this.checking.filter((path) => path !== relPath);
  }
}

/** Whether two rule-override maps hold the same entries. */
function sameRules(
  a: Record<string, boolean>,
  b: Record<string, boolean>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && a[key] === b[key]);
}

/** Compare paths case-insensitively with `\` folded to `/`, matching the
 *  Rust-side normalization. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export const grammar = new GrammarStore();
