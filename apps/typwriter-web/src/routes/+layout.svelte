<script lang="ts">
	import './layout.css';
	import { onNavigate } from '$app/navigation';

	let { children } = $props();

	// Crossfade between pages where the browser supports view transitions.
	// Same-page navigations (the #features link) just scroll.
	onNavigate((navigation) => {
		if (navigation.shallow && navigation.type === 'goto') return;
		if (!document.startViewTransition) return;
		if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head><link rel="icon" href="/icon.png" type="image/png" /></svelte:head>
{@render children()}
