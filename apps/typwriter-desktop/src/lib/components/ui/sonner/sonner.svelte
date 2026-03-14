<script lang="ts">
	
	
	
	
	import { CheckCircle, Info, CircleNotch, XCircle, Warning } from "phosphor-svelte";

	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme="light"
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
	>{#snippet loadingIcon()}
		<CircleNotch class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CheckCircle class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<XCircle class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<Info class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<Warning class="size-4" />
	{/snippet}
</Sonner>
