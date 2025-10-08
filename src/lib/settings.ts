import { RuneStore } from "@tauri-store/svelte";

type Settings = {
  theme: "light" | "dark";
};

export const settings = new RuneStore<Settings>(
  "settings",
  {
    theme: "light",
  },
  {
    autoStart: true,
    saveOnChange: true,
  },
);
