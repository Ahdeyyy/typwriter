<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { IconSvgElement } from '@hugeicons/svelte';

	interface Props {
		icon: IconSvgElement;
		title: string;
		description: string;
	}

	let { icon, title, description }: Props = $props();
</script>

<Card class="flex flex-col gap-2 border-border bg-card">
	<CardHeader class="pb-2">
		<div class="mb-3 flex h-10 w-10 items-center justify-center border border-border bg-muted">
			<HugeiconsIcon {icon} size={20} class="text-primary" />
		</div>
		<CardTitle class="text-sm font-semibold tracking-tight">{title}</CardTitle>
	</CardHeader>
	<CardContent class="pt-0">
		<p class="text-sm text-muted-foreground">{description}</p>
	</CardContent>
</Card>
