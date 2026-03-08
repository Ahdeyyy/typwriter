
import Home from "$lib/components/pages/home.svelte"
import Logs from "$lib/components/pages/logs.svelte"
import Workspace from "$lib/components/pages/workspace.svelte"

type PageDefinition = {
    name: "home" | "workspace" | "logs"
    component: typeof Home
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
    "logs": {
        name: "logs",
        component: Logs,
    }
} satisfies Record<"home" | "workspace" | "logs", PageDefinition>

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
