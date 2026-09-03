<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ComputerIcon,
		SmartPhone01Icon,
		Sun01Icon,
		Moon02Icon,
		SparklesIcon,
		ViewIcon,
		TextCheckIcon,
		GitCommitIcon,
		ArrowDataTransferHorizontalIcon
	} from '@hugeicons/core-free-icons';

	import showcaseDark from '$lib/assets/showcase_dark.png';
	import showcaseLight from '$lib/assets/showcase_light.png';
	import mobileShowcaseDark from '$lib/assets/mobile_showcase_dark.png';
	import mobileShowcaseLight from '$lib/assets/mobile_showcase_light.png';

	let device = $state<'desktop' | 'mobile'>('desktop');
	let theme = $state<'dark' | 'light'>('dark');
	let activeSpotlight = $state<string | null>('preview');

	const spotlights = [
		{
			id: 'preview',
			icon: ViewIcon,
			label: 'Live Preview',
			desc: 'Recompiles as you type. Updates as quickly as possible (sub-100ms in most cases) to stay in sync with your source.'
		},
		{
			id: 'grammar',
			icon: TextCheckIcon,
			label: 'Harper Grammar',
			desc: 'Fast, on-device prose and grammar checking with customizable dictionaries.'
		},
		{
			id: 'vcs',
			icon: GitCommitIcon,
			label: 'Restore Points',
			desc: 'Zstandard-compressed automatic snapshots on compile. Roll back in seconds.'
		},
		{
			id: 'jump',
			icon: ArrowDataTransferHorizontalIcon,
			label: '2-Way Navigation',
			desc: 'Click on preview elements to jump straight to source line, and vice versa.'
		}
	];

	const activeSpotlightData = $derived(
		spotlights.find((s) => s.id === activeSpotlight) ?? spotlights[0]
	);

	const activeImage = $derived.by(() => {
		if (device === 'desktop') {
			return theme === 'dark' ? showcaseDark : showcaseLight;
		} else {
			return theme === 'dark' ? mobileShowcaseDark : mobileShowcaseLight;
		}
	});
</script>

<div class="relative mx-auto w-full max-w-5xl">
	<!-- Control Bar -->
	<div
		class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-2 backdrop-blur-sm sm:px-4"
	>
		<!-- Device tabs -->
		<div class="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all {device ===
				'desktop'
					? 'bg-background text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (device = 'desktop')}
			>
				<HugeiconsIcon icon={ComputerIcon} size={14} />
				<span>Desktop App</span>
			</button>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all {device ===
				'mobile'
					? 'bg-background text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (device = 'mobile')}
			>
				<HugeiconsIcon icon={SmartPhone01Icon} size={14} />
				<span>Mobile (Android)</span>
			</button>
		</div>

		<!-- Spotlight pills -->
		<div class="hidden items-center gap-1 lg:flex">
			{#each spotlights as spot (spot.id)}
				<button
					type="button"
					class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors {activeSpotlight ===
					spot.id
						? 'border border-border/80 bg-background text-foreground shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (activeSpotlight = spot.id)}
				>
					<HugeiconsIcon icon={spot.icon} size={12} />
					<span>{spot.label}</span>
				</button>
			{/each}
		</div>

		<!-- Theme toggle -->
		<div class="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
			<button
				type="button"
				class="flex size-7 items-center justify-center rounded-md text-xs transition-all {theme ===
				'dark'
					? 'bg-background text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (theme = 'dark')}
				aria-label="Dark mode screenshot"
				title="Dark mode preview"
			>
				<HugeiconsIcon icon={Moon02Icon} size={14} />
			</button>
			<button
				type="button"
				class="flex size-7 items-center justify-center rounded-md text-xs transition-all {theme ===
				'light'
					? 'bg-background text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (theme = 'light')}
				aria-label="Light mode screenshot"
				title="Light mode preview"
			>
				<HugeiconsIcon icon={Sun01Icon} size={14} />
			</button>
		</div>
	</div>

	<!-- Spotlight banner on mobile/tablet or active reminder -->
	<div
		class="mb-4 flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground transition-all duration-300"
	>
		<div class="flex items-center gap-2">
			<div
				class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
			>
				<HugeiconsIcon icon={activeSpotlightData.icon} size={12} />
			</div>
			<p>
				<strong class="font-medium text-foreground">{activeSpotlightData.label}:</strong>
				{activeSpotlightData.desc}
			</p>
		</div>
		<div class="hidden shrink-0 items-center gap-1 text-[0.6875rem] font-mono opacity-80 sm:flex">
			<HugeiconsIcon icon={SparklesIcon} size={12} class="text-primary" />
			<span>Native Rust + Tauri</span>
		</div>
	</div>

	<!-- Device Frame Container -->
	<div
		class="group relative overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl transition-all duration-300 hover:border-border hover:shadow-[0_20px_50px_-15px_oklch(0_0_0/0.3)] dark:hover:shadow-[0_20px_50px_-15px_oklch(1_0_0/0.05)]"
	>
		{#if device === 'desktop'}
			<!-- Window title bar chrome -->
			<div
				class="flex h-9 items-center justify-between border-b border-border/70 bg-muted/50 px-4 transition-colors"
			>
				<div class="flex items-center gap-2">
					<span class="size-2.5 rounded-full bg-destructive/60"></span>
					<span class="size-2.5 rounded-full bg-amber-500/60"></span>
					<span class="size-2.5 rounded-full bg-emerald-500/60"></span>
					<span class="ml-2 font-mono text-[0.6875rem] text-muted-foreground select-none">
						Typwriter: thesis.typ
					</span>
				</div>
				<div class="flex items-center gap-2 text-[0.6875rem] text-muted-foreground font-mono">
					<span class="size-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
					<span>Live Sync</span>
				</div>
			</div>

			<!-- Desktop image viewport -->
			<div class="relative aspect-16/10 w-full overflow-hidden bg-background">
				<img
					src={activeImage}
					alt="Typwriter desktop editor interface in {theme} mode"
					class="size-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.01]"
					loading="lazy"
				/>
			</div>
		{:else}
			<!-- Mobile Android Phone Mockup Frame -->
			<div class="flex flex-col items-center bg-muted/20 py-8 px-4">
				<div
					class="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-[2.2rem] border-4 border-muted-foreground/30 bg-card shadow-2xl"
				>
					<!-- Phone speaker / punch-hole camera -->
					<div
						class="absolute top-2.5 left-1/2 z-20 h-4 w-20 -translate-x-1/2 rounded-full bg-background/90 backdrop-blur-sm border border-border/50 flex items-center justify-center gap-1.5"
					>
						<span class="size-2 rounded-full bg-foreground/30"></span>
						<span class="h-1 w-6 rounded-full bg-foreground/20"></span>
					</div>

					<div class="relative aspect-9/19 w-full overflow-hidden bg-background pt-8">
						<img
							src={activeImage}
							alt="Typwriter mobile editor interface in {theme} mode"
							class="size-full object-cover object-top transition-transform duration-500 ease-out hover:scale-105"
							loading="lazy"
						/>
					</div>
				</div>
				<p class="mt-4 text-center text-xs text-muted-foreground">
					Standalone Typwriter Android editor with full Typst compilation & SAF document support.
				</p>
			</div>
		{/if}
	</div>
</div>
