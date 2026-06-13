<script lang="ts">
	import { Drawer as DrawerPrimitive } from "vaul-svelte";

	let {
		open = $bindable(false),
		...restProps
	}: DrawerPrimitive.RootProps = $props();
</script>

<DrawerPrimitive.Root bind:open {...restProps} />
