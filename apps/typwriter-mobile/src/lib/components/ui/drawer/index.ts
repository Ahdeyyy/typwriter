import { Drawer as DrawerPrimitive } from "vaul-svelte";

import Root from "./drawer.svelte";
import Content from "./drawer-content.svelte";
import Overlay from "./drawer-overlay.svelte";
import Header from "./drawer-header.svelte";
import Footer from "./drawer-footer.svelte";
import Title from "./drawer-title.svelte";
import Description from "./drawer-description.svelte";

const Trigger = DrawerPrimitive.Trigger;
const Portal = DrawerPrimitive.Portal;
const Close = DrawerPrimitive.Close;
const NestedRoot = DrawerPrimitive.NestedRoot;

export {
	Root,
	NestedRoot,
	Content,
	Overlay,
	Header,
	Footer,
	Title,
	Description,
	Trigger,
	Portal,
	Close,
	//
	Root as Drawer,
	NestedRoot as DrawerNestedRoot,
	Content as DrawerContent,
	Overlay as DrawerOverlay,
	Header as DrawerHeader,
	Footer as DrawerFooter,
	Title as DrawerTitle,
	Description as DrawerDescription,
	Trigger as DrawerTrigger,
	Portal as DrawerPortal,
	Close as DrawerClose,
};
