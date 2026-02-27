
import Home from "$lib/components/pages/home.svelte"
import Workspace from "$lib/components/pages/workspace.svelte"

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
export const page = $state(pages["home"])