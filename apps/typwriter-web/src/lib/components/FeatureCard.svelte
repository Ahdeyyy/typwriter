<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { IconSvgElement } from '@hugeicons/svelte';

	interface Props {
		icon: IconSvgElement;
		title: string;
		description: string;
		tag?: string;
		featured?: boolean;
	}

	let { icon, title, description, tag = undefined, featured = false }: Props = $props();
</script>

<Card
	class="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card/70 p-5 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md hover:shadow-foreground/5 {featured
		? 'sm:col-span-2'
		: ''}"
>
	<!-- Subtle ambient highlight gradient -->
	<div
		class="pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-primary/5 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
	></div>

	<CardHeader class="p-0 pb-3">
		<div class="mb-3 flex items-center justify-between gap-2">
			<div
				class="flex size-9 items-center justify-center rounded-lg border border-border/80 bg-muted/70 shadow-xs transition-transform duration-200 group-hover:scale-110"
			>
				<HugeiconsIcon {icon} size={18} class="text-primary" />
			</div>

			{#if tag}
				<span
					class="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground"
				>
					{tag}
				</span>
			{/if}
		</div>

		<CardTitle
			class="text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary"
		>
			{title}
		</CardTitle>
	</CardHeader>

	<CardContent class="p-0">
		<p class="text-xs leading-relaxed text-muted-foreground sm:text-sm">
			{description}
		</p>
	</CardContent>
</Card>
