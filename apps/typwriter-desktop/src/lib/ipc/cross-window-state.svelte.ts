// Tauri webviews are separate browser processes, so DOM nodes can't be
// teleported between them. This primitive replicates a Svelte 5 `$state`
// rune across every Tauri window that opens the same key, by piggybacking
// on the Tauri event bus (which broadcasts to all webviews of the app).
//
//   const zoom = new CrossWindowState<number>('preview.zoom', 2.0);
//   zoom.value             // reactive read
//   zoom.set(2.5)          // local write + broadcast to peers
//   zoom.destroy()         // tear down listeners (call from store destroy())
//
// IMPORTANT: state lives on a class instance, not in a closure. Per the
// project rule, module-level/closure `$state` loses reactivity — only
// class-field `$state` is observed by Svelte's signal tracking when read
// through getters from other modules. Earlier versions of this file used
// `let value = $state(...)` inside a factory function and silently broke
// every dependent `$derived` / `$effect` (the editor pane was the most
// visible casualty).
//
// Protocol:
//   xwin:<key>         payload { s: senderId, v: value }   — value updates
//   xwin:<key>:ask     payload { s: senderId }             — "anyone hold this key? send snapshot"
//
// The ask is sent once this holder's own value listener is live, so a fast
// answer can't race past it.
//
// Each holder generates a senderId at construction; remotes ignore messages
// whose s matches their own (echo suppression). On construction, a holder
// broadcasts an ask; peers that have actually written the key answer once with
// their current value. Last write wins.
//
// Only writers answer, because most keys have exactly one: `workspace:rootPath`
// is written by the main window and merely read by the settings, preview and
// diff windows. If every holder answered, a window that had only ever read the
// key would reply with its own untouched default and — arriving last — clobber
// the real value for whoever just asked.

import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import { logError } from "$lib/logger";

// Tauri only allows alphanumeric, `-`, `/`, `:`, `_` in event names.
const sanitize = (key: string) => key.replace(/\./g, "_");
const EVT = (key: string) => `xwin:${sanitize(key)}`;
const ASK = (key: string) => `xwin:${sanitize(key)}:ask`;

interface ValueEnvelope<T> {
  s: string;
  v: T;
}

interface AskEnvelope {
  s: string;
}

function newSenderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class CrossWindowState<T> {
  // Class-field `$state` — reactivity flows through this signal when other
  // modules read the `.value` getter inside a tracking context.
  #value = $state<T>(undefined as unknown as T);
  readonly #key: string;
  readonly #sid: string;
  readonly #unlisteners: UnlistenFn[] = [];
  readonly #ssr: boolean;
  /** Whether this holder has ever written the key, and so has an authoritative
   *  value to answer an ask with. */
  #authoritative = false;

  constructor(key: string, initial: T) {
    this.#key = key;
    this.#sid = newSenderId();
    this.#value = initial;
    this.#ssr = typeof window === "undefined";

    // SSR / prerender: no event bus to talk to. Behaves like plain $state.
    if (this.#ssr) return;

    // The ask goes out only once the value listener is live: `listen` is an
    // async round-trip to Rust, and an answer that arrives before it resolves
    // would be dropped — leaving this holder stuck on its default with no
    // second chance to ask.
    listen<ValueEnvelope<T>>(EVT(key), ({ payload }) => {
      if (payload.s === this.#sid) return;
      this.#value = payload.v;
    })
      .then((u) => {
        this.#unlisteners.push(u);
        return emit(ASK(key), { s: this.#sid } satisfies AskEnvelope);
      })
      .catch((err) => logError(`crossWindowState[${key}]: value listen failed:`, err));

    listen<AskEnvelope>(ASK(key), ({ payload }) => {
      if (payload.s === this.#sid) return;
      // Pure readers stay quiet — see the note on writers above.
      if (!this.#authoritative) return;
      emit(EVT(key), {
        s: this.#sid,
        v: $state.snapshot(this.#value) as T,
      } satisfies ValueEnvelope<T>).catch((err) =>
        logError(`crossWindowState[${key}]: snapshot reply failed:`, err)
      );
    })
      .then((u) => this.#unlisteners.push(u))
      .catch((err) => logError(`crossWindowState[${key}]: ask listen failed:`, err));
  }

  get value(): T {
    return this.#value;
  }

  set(next: T): void {
    this.#value = next;
    this.#authoritative = true;
    if (this.#ssr) return;
    emit(EVT(this.#key), {
      s: this.#sid,
      v: $state.snapshot(next) as T,
    } satisfies ValueEnvelope<T>).catch((err) =>
      logError(`crossWindowState[${this.#key}]: emit failed:`, err)
    );
  }

  destroy(): void {
    for (const u of this.#unlisteners) u();
    this.#unlisteners.length = 0;
  }
}

/** Back-compat factory. Prefer `new CrossWindowState(...)` directly. */
export function crossWindowState<T>(key: string, initial: T): CrossWindowState<T> {
  return new CrossWindowState<T>(key, initial);
}
