<script lang="ts">
 import SunIcon from "@lucide/svelte/icons/sun";
 import MoonIcon from "@lucide/svelte/icons/moon";

 import { resetMode, setMode,mode } from "mode-watcher";
 import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
 import { buttonVariants } from "$lib/components/ui/button";
 import { app } from "@tauri-apps/api"

</script>

<DropdownMenu.Root>
 <DropdownMenu.Trigger
  class={[buttonVariants({ variant:"ghost", size: "icon" }), "items-center justify-center flex w-8 h-8"]}
 >
  <SunIcon
   class="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all! dark:scale-0 dark:-rotate-90"
  />
  <MoonIcon
   class="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all! dark:scale-100 dark:rotate-0"
  />
  <span class="sr-only">Toggle theme</span>
 </DropdownMenu.Trigger>
 <DropdownMenu.Content align="end">
  <DropdownMenu.Item onclick={() =>{
    setMode("light")
    app.setTheme("light")
  }}>Light</DropdownMenu.Item
  >
  <DropdownMenu.Item onclick={() =>{
    setMode("dark")
    app.setTheme("dark")
  }}>Dark</DropdownMenu.Item>
  <DropdownMenu.Item onclick={() => {
    resetMode()
    app.setTheme(mode.current === "dark" ? "dark": "light")
  }}>System</DropdownMenu.Item>
 </DropdownMenu.Content>
</DropdownMenu.Root>
