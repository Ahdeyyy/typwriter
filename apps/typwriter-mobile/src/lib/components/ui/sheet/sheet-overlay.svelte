<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn("data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 bg-black/40 duration-300 ease-(--ease-drawer) fixed inset-0 z-50", className)}
	{...restProps}
/>
