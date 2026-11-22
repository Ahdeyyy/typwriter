<script lang="ts">
	import { resolve } from '$app/paths';
	import { GITHUB_URL, SPONSOR_URL } from '$lib/links';

	const link = 'transition-colors duration-150 ease-[ease] hover:text-foreground';
</script>

<footer class="border-t border-border/50">
	<div
		class="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6"
	>
		<span>© {new Date().getFullYear()} Typwriter · MIT License</span>
		<div class="flex items-center gap-5">
			<a href={resolve('/download')} class={link}>Download</a>
			<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" class={link}>GitHub</a>
			<a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" class={link}>Sponsor</a>
		</div>
	</div>
</footer>
