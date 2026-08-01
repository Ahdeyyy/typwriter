// The settings sidebar's groups, in display order. Adding a setting means
// dropping it into one of the panes below; adding a *group* means writing the
// pane component and appending an entry here.

import type { Component } from "svelte";
import type { IconSvgElement } from "@hugeicons/svelte";
import {
  PaintBrush01Icon,
  FileCodeIcon,
  MagicWand01Icon,
  FloppyDiskIcon,
  GitCommitIcon,
  EyeIcon,
  TextFontIcon,
  TextCheckIcon,
  KeyboardIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

import Appearance from "./groups/appearance.svelte";
import Editor from "./groups/editor.svelte";
import Formatting from "./groups/formatting.svelte";
import Saving from "./groups/saving.svelte";
import History from "./groups/history.svelte";
import Preview from "./groups/preview.svelte";
import Typst from "./groups/typst.svelte";
import Grammar from "./groups/grammar.svelte";
import Keymaps from "./groups/keymaps.svelte";
import General from "./groups/general.svelte";

export type SettingsGroupId =
  | "appearance"
  | "editor"
  | "formatting"
  | "saving"
  | "history"
  | "preview"
  | "typst"
  | "grammar"
  | "keymaps"
  | "general";

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  icon: IconSvgElement;
  component: Component;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: PaintBrush01Icon,
    component: Appearance,
  },
  { id: "editor", label: "Editor", icon: FileCodeIcon, component: Editor },
  {
    id: "formatting",
    label: "Formatting",
    icon: MagicWand01Icon,
    component: Formatting,
  },
  { id: "saving", label: "Saving", icon: FloppyDiskIcon, component: Saving },
  { id: "history", label: "History", icon: GitCommitIcon, component: History },
  { id: "preview", label: "Preview", icon: EyeIcon, component: Preview },
  { id: "typst", label: "Typst", icon: TextFontIcon, component: Typst },
  { id: "grammar", label: "Grammar", icon: TextCheckIcon, component: Grammar },
  { id: "keymaps", label: "Keymaps", icon: KeyboardIcon, component: Keymaps },
  { id: "general", label: "General", icon: Settings01Icon, component: General },
];

export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = "appearance";
