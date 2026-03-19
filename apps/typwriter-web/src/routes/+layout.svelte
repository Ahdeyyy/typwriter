<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href="/icon.png" type="image/png" /></svelte:head>
{@render children()}
