import Home from "$lib/components/pages/home.svelte"
import { logError } from "$lib/logger"
import type { Component } from "svelte"

// Settings is not listed here — it opens in its own webview window
// (see $lib/windows.ts) rather than swapping the main window's page. Keymaps
// lives inside it as a settings group.
type PageName = "home" | "workspace" | "onboarding"

type PageModule = { default: Component }

type PageDefinition = {
    name: PageName
    /** Pre-bundled component, for pages cheap enough to ship in the entry
     *  chunk. Only Home is: the main window opens on it, so deferring it would
     *  trade an instant first paint for a chunk fetch and buy nothing. */
    component?: Component
    /** Chunk loader, for pages kept out of the entry graph. Workspace drags in
     *  the whole editor — CodeMirror plus every language mode — and Onboarding
     *  drags in the editor too. Neither belongs in the graph a window that only
     *  shows settings or a diff has to parse before it can paint. */
    load?: () => Promise<PageModule>
}

export const pages: Record<PageName, PageDefinition> = {
    "home": {
        name: "home",
        component: Home,
    },
    "workspace": {
        name: "workspace",
        load: () => import("$lib/components/pages/workspace.svelte"),
    },
    "onboarding": {
        name: "onboarding",
        load: () => import("$lib/components/pages/onboarding.svelte"),
    },
}

export type Pages = keyof typeof pages

/** Chunks already fetched, so a revisit swaps synchronously. */
const loaded = new Map<PageName, Component>()

function resolve(def: PageDefinition): Component | Promise<Component> {
    if (def.component) return def.component
    const cached = loaded.get(def.name)
    if (cached) return cached
    return def.load!().then((mod) => {
        loaded.set(def.name, mod.default)
        return mod.default
    })
}

class Page {
    current = $state<PageDefinition>(pages["home"])
    /** The component actually on screen. It only changes once the incoming
     *  page's chunk has landed, so a navigation that has to fetch shows the
     *  outgoing page a moment longer rather than flashing an empty window. */
    component = $state<Component>(Home)
    /** True while a navigation is waiting on a chunk. The titlebar can use this
     *  to show progress; nothing has to. */
    navigating = $state(false)
    history = $state<Pages[]>([])

    /** Warm a page's chunk without navigating to it. Home calls this for the
     *  workspace so the first open is as instant as it was when everything
     *  shipped in one bundle. */
    preload(target: Pages): void {
        const def = pages[target]
        if (def.component || loaded.has(target)) return
        void def.load!()
            .then((mod) => loaded.set(target, mod.default))
            .catch((err) => logError(`preloading the ${target} page failed:`, err))
    }

    /** Identifies the most recent navigation, so a slow chunk that lands after
     *  the user has already moved on doesn't yank them back. */
    #pending = 0

    /** Swap to `def`, waiting on its chunk if it isn't loaded yet. Leaves the
     *  current page up on failure — a page we can't render is strictly worse
     *  than the one the user is already looking at. */
    #show(def: PageDefinition): void {
        const resolved = resolve(def)
        const token = ++this.#pending

        if (!(resolved instanceof Promise)) {
            this.navigating = false
            this.current = def
            this.component = resolved
            return
        }

        this.navigating = true
        resolved
            .then((component) => {
                if (token !== this.#pending) return
                this.current = def
                this.component = component
            })
            .catch((err) => logError(`loading the ${def.name} page failed:`, err))
            .finally(() => {
                if (token === this.#pending) this.navigating = false
            })
    }

    navigate(target: Pages) {
        if (this.current.name === target) {
            return
        }
        this.history = [...this.history, this.current.name]
        this.#show(pages[target])
    }

    back(fallback: Pages) {
        const previous = this.history.at(-1)
        if (!previous) {
            this.#show(pages[fallback])
            return
        }

        this.history = this.history.slice(0, -1)
        this.#show(pages[previous])
    }
}

export const page = new Page()
