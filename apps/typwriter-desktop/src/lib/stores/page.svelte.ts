
import Home from "$lib/components/pages/home.svelte"
import Workspace from "$lib/components/pages/workspace.svelte"

export type Pages = keyof typeof pages

export const pages = {
    "home": {
        name: "home",
        component: Home,
    },
    "workspace": {
        name: "workspace",
        component: Workspace,
    }
}

class Page {
    current = $state(pages["home"])
    navigate(target: Pages) {
        this.current = pages[target] as typeof pages["home"]
    }
}

export const page = new Page()
