
import Home from "$lib/components/pages/home.svelte"
import Workspace from "$lib/components/pages/workspace.svelte"
import Keymaps from "$lib/components/pages/keymaps.svelte"
import type { Component } from "svelte"

type PageName = "home" | "workspace" | "keymaps"

type PageDefinition = {
    name: PageName
    component: Component
}

export const pages = {
    "home": {
        name: "home",
        component: Home,
    },
    "workspace": {
        name: "workspace",
        component: Workspace,
    },
    "keymaps": {
        name: "keymaps",
        component: Keymaps,
    },
} satisfies Record<PageName, PageDefinition>

export type Pages = keyof typeof pages

class Page {
    current = $state<PageDefinition>(pages["home"])
    history = $state<Pages[]>([])

    navigate(target: Pages) {
        if (this.current.name === target) {
            return
        }
        this.history = [...this.history, this.current.name]
        this.current = pages[target]
    }

    back(fallback: Pages) {
        const previous = this.history.at(-1)
        if (!previous) {
            this.current = pages[fallback]
            return
        }

        this.history = this.history.slice(0, -1)
        this.current = pages[previous]
    }
}

export const page = new Page()
