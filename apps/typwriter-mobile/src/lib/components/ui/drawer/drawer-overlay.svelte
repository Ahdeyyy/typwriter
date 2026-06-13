<script lang="ts">
	import { Drawer as DrawerPrimitive } from "vaul-svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<DrawerPrimitive.OverlayProps> = $props();
</script>

<DrawerPrimitive.Overlay
	bind:ref
	data-slot="drawer-overlay"
	class={cn("fixed inset-0 z-50 bg-black/50", className)}
	{...restProps}
/>
