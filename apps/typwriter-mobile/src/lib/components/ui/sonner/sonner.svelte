<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { mode } from "mode-watcher";
	import {
		Loading03Icon,
		CheckmarkCircle02Icon,
		CancelCircleIcon,
		InformationCircleIcon,
		Alert02Icon,
	} from "@hugeicons/core-free-icons";
	import Icon from "$lib/components/icon.svelte";

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
>
	{#snippet loadingIcon()}
		<Icon icon={Loading03Icon} class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<Icon icon={CheckmarkCircle02Icon} class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<Icon icon={CancelCircleIcon} class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<Icon icon={InformationCircleIcon} class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<Icon icon={Alert02Icon} class="size-4" />
	{/snippet}
</Sonner>
