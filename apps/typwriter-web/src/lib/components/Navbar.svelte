<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Github01Icon } from '@hugeicons/core-free-icons';
	import { resolve } from '$app/paths';
	import { GITHUB_URL } from '$lib/links';
</script>

<header
	class="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md [view-transition-name:site-header]"
>
	<div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
		<a
			href={resolve('/')}
			class="flex items-center gap-2 transition-opacity duration-150 ease-[ease] hover:opacity-80"
		>
			<img src="/icon.png" alt="" class="size-6 object-contain" />
			<span class="font-heading text-base font-bold tracking-tight">Typwriter</span>
		</a>

		<nav class="flex items-center gap-1 text-sm text-muted-foreground sm:gap-2">
			<a
				href="{resolve('/')}#features"
				class="hidden px-2 transition-colors duration-150 ease-[ease] hover:text-foreground sm:inline"
			>
				Features
			</a>
			<a
				href={resolve('/download')}
				class="px-2 transition-colors duration-150 ease-[ease] hover:text-foreground">Download</a
			>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground hover:text-foreground"
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Typwriter on GitHub"
			>
				<HugeiconsIcon icon={Github01Icon} size={16} />
			</Button>
		</nav>
	</div>
</header>
