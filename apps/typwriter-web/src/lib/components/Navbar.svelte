<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Github01Icon, Download04Icon, FavouriteIcon } from '@hugeicons/core-free-icons';

	import { resolve } from '$app/paths';

	interface Props {
		version?: string | null;
	}

	let { version = null }: Props = $props();

	const GITHUB_URL = 'https://github.com/Ahdeyyy/typwriter';
	const SPONSOR_URL = 'https://github.com/sponsors/Ahdeyyy';
</script>

<header
	class="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md transition-colors"
>
	<div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
		<!-- Brand & Version -->
		<a href={resolve('/')} class="group flex items-center gap-2.5 transition-opacity hover:opacity-90">
			<div
				class="relative flex size-7 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-card shadow-xs transition-transform duration-200 group-hover:scale-105"
			>
				<img src="/icon.png" alt="Typwriter Icon" class="size-5 object-contain" />
			</div>
			<div class="flex items-center gap-2">
				<span class="font-heading text-base font-bold tracking-tight text-foreground">
					Typwriter
				</span>
				{#if version}
					<span
						class="hidden rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[0.6875rem] font-mono font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
					>
						{version}
					</span>
				{/if}
			</div>
		</a>

		<!-- Navigation links -->
		<nav class="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
			<a
				href="#features"
				class="transition-colors hover:text-foreground active:scale-95"
			>
				Features
			</a>
			<a
				href="#showcase"
				class="transition-colors hover:text-foreground active:scale-95"
			>
				Preview
			</a>
			<a
				href="#download"
				class="transition-colors hover:text-foreground active:scale-95"
			>
				Download
			</a>
		</nav>

		<!-- Actions -->
		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				class="gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors hover:text-rose-500"
				href={SPONSOR_URL}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Sponsor on GitHub"
			>
				<HugeiconsIcon icon={FavouriteIcon} size={14} class="text-rose-500" />
				<span class="hidden sm:inline">Sponsor</span>
			</Button>

			<Button
				variant="ghost"
				size="sm"
				class="gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Typwriter on GitHub"
			>
				<HugeiconsIcon icon={Github01Icon} size={15} />
				<span class="hidden sm:inline">GitHub</span>
			</Button>

			<Button
				size="sm"
				class="h-8 gap-1.5 px-3 text-xs font-medium shadow-xs active:scale-[0.98]"
				href="#download"
			>
				<HugeiconsIcon icon={Download04Icon} size={14} />
				<span>Get Typwriter</span>
			</Button>
		</div>
	</div>
</header>
