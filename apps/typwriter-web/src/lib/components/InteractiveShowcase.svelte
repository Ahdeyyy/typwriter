<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Sun01Icon, Moon02Icon } from '@hugeicons/core-free-icons';

	import showcaseDark from '$lib/assets/showcase_dark.png';
	import showcaseLight from '$lib/assets/showcase_light.png';
	import mobileShowcaseDark from '$lib/assets/mobile_showcase_dark.png';
	import mobileShowcaseLight from '$lib/assets/mobile_showcase_light.png';

	type Theme = 'dark' | 'light';

	let device = $state<'desktop' | 'mobile'>('desktop');
	let theme = $state<Theme>('dark');

	const images = {
		desktop: { dark: showcaseDark, light: showcaseLight },
		mobile: { dark: mobileShowcaseDark, light: mobileShowcaseLight }
	};
	const THEMES: Theme[] = ['dark', 'light'];

	const toggle =
		'relative z-10 flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-[color,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground';
	// Slides under the pressed option; each option is exactly half the control.
	const indicator =
		'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-xs transition-transform duration-200 ease-in-out motion-reduce:transition-none';
</script>

<div class="mx-auto w-full max-w-5xl">
	<div class="mb-4 flex items-center justify-center gap-3">
		<div class="relative grid grid-cols-2 rounded-full bg-muted/60 p-1">
			<span class="{indicator} {device === 'mobile' ? 'translate-x-full' : ''}"></span>
			<button
				type="button"
				class={toggle}
				aria-pressed={device === 'desktop'}
				onclick={() => (device = 'desktop')}
			>
				Desktop
			</button>
			<button
				type="button"
				class={toggle}
				aria-pressed={device === 'mobile'}
				onclick={() => (device = 'mobile')}
			>
				Android
			</button>
		</div>
		<div class="relative grid grid-cols-2 rounded-full bg-muted/60 p-1">
			<span class="{indicator} {theme === 'light' ? 'translate-x-full' : ''}"></span>
			<button
				type="button"
				class={toggle}
				aria-pressed={theme === 'dark'}
				aria-label="Dark theme"
				onclick={() => (theme = 'dark')}
			>
				<HugeiconsIcon icon={Moon02Icon} size={14} />
			</button>
			<button
				type="button"
				class={toggle}
				aria-pressed={theme === 'light'}
				aria-label="Light theme"
				onclick={() => (theme = 'light')}
			>
				<HugeiconsIcon icon={Sun01Icon} size={14} />
			</button>
		</div>
	</div>

	<!-- Both themes stay stacked so switching crossfades instead of flashing. -->
	{#if device === 'desktop'}
		<div
			class="grid overflow-hidden rounded-2xl border border-border/80 shadow-xl transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0 motion-reduce:starting:scale-100"
		>
			{#each THEMES as t (t)}
				<img
					src={images.desktop[t]}
					alt={t === theme ? `Typwriter on desktop in the ${t} theme` : ''}
					aria-hidden={t !== theme}
					class="col-start-1 row-start-1 aspect-16/10 w-full object-cover object-top transition-opacity duration-200 ease-[ease] {t ===
					theme
						? 'opacity-100'
						: 'opacity-0'}"
				/>
			{/each}
		</div>
	{:else}
		<div
			class="mx-auto grid w-full max-w-[300px] overflow-hidden rounded-[2rem] border-4 border-muted-foreground/30 shadow-xl transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0 motion-reduce:starting:scale-100"
		>
			{#each THEMES as t (t)}
				<img
					src={images.mobile[t]}
					alt={t === theme ? `Typwriter on Android in the ${t} theme` : ''}
					aria-hidden={t !== theme}
					class="col-start-1 row-start-1 aspect-9/19 w-full object-cover object-top transition-opacity duration-200 ease-[ease] {t ===
					theme
						? 'opacity-100'
						: 'opacity-0'}"
				/>
			{/each}
		</div>
	{/if}
</div>
