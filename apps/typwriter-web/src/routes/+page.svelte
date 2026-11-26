<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getLatestRelease, RELEASE_PAGES, type Release } from '#lib/releases.ts';
	import {
		assetLabel,
		detectPlatform,
		formatSize,
		groupAssets,
		PLATFORM_NAMES,
		type Platform
	} from '#lib/platforms.ts';
	import { reveal } from '#lib/reveal.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Navbar from '#lib/components/Navbar.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import InteractiveShowcase from '#lib/components/InteractiveShowcase.svelte';
	import PlatformIcon from '#lib/components/PlatformIcon.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Download04Icon } from '@hugeicons/core-free-icons';

	let release = $state<Release | null>(null);
	let releaseChecked = $state(false);
	// Unknown until mount, since the page is prerendered without a user agent.
	let platform = $state<Platform | null>(null);
	let platformChecked = $state(false);

	onMount(() => {
		platform = detectPlatform(navigator.userAgent);
		platformChecked = true;
		void getLatestRelease().then((latest) => {
			release = latest;
			releaseChecked = true;
		});
	});

	const primaryAsset = $derived(
		platform && release ? (groupAssets(release.assets)[platform][0] ?? null) : null
	);
	// GitHub is unreachable or rate limited; its release page still has the files.
	const releaseFallback = $derived(releaseChecked && !primaryAsset);
	const primaryHref = $derived(
		primaryAsset?.browser_download_url ??
			(releaseFallback ? RELEASE_PAGES.stable : resolve('download'))
	);

	const features = [
		{
			title: 'Live preview',
			description: 'Your document updates as you type. Click the preview to jump to the source.'
		},
		{
			title: 'Presentation mode',
			description: 'Present slides full screen, with a presenter view and timer on desktop.'
		},
		{
			title: 'Grammar and spelling',
			description: 'Harper checks your writing on your device. Nothing leaves it.'
		},
		{
			title: 'Restore points',
			description: 'Snapshots are saved automatically. Compare any two and roll back.'
		},
		{
			title: 'Autocomplete',
			description: 'Suggestions and documentation as you type, with optional Tinymist support.'
		},
		{
			title: 'Formatting',
			description: 'Typstyle tidies a selection, a file, or the whole project on save.'
		}
	];
</script>

<svelte:head>
	<title>Typwriter: a Typst editor for desktop and Android</title>
	<meta
		name="description"
		content="Typwriter is a fast, native Typst editor for Windows, macOS, Linux, and Android, with live preview, offline grammar checking, and automatic restore points."
	/>
</svelte:head>

<div class="min-h-screen text-foreground">
	<Navbar />

	<main>
		<section class="mx-auto max-w-5xl px-4 pt-16 pb-16 text-center sm:px-6 sm:pt-24">
			<h1
				class="mx-auto max-w-3xl animate-enter font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
			>
				Write Typst, see it as you type.
			</h1>
			<p
				class="mx-auto mt-5 max-w-xl animate-enter text-base text-muted-foreground [--stagger:1] sm:text-lg"
			>
				A fast, native Typst editor for desktop and Android. Free and open source.
			</p>

			<div class="mt-9 flex animate-enter flex-col items-center gap-3 [--stagger:2]">
				{#if platform}
					<!-- The label settles as soon as the platform is known and doesn't change
					     again when the release arrives; only the link target does. -->
					<Button
						class="h-11 gap-2 px-6 text-sm font-semibold"
						href={primaryHref}
						target={releaseFallback ? '_blank' : undefined}
						rel={releaseFallback ? 'noopener noreferrer' : undefined}
					>
						<span class="flex animate-fade items-center gap-2">
							<PlatformIcon {platform} size={18} />
							Download for {PLATFORM_NAMES[platform]}
						</span>
					</Button>
				{:else}
					<Button class="h-11 gap-2 px-6 text-sm font-semibold" href={resolve('download')}>
						<HugeiconsIcon icon={Download04Icon} size={18} />
						Download
					</Button>
				{/if}
				<!-- Height is reserved so the link below doesn't jump when this fills in. -->
				<p class="min-h-4 text-xs/4 text-muted-foreground">
					{#if primaryAsset}
						<span class="animate-fade">
							{release?.tag_name.replace(/^typwriter-/, '')} · {assetLabel(primaryAsset.name)} ·
							{formatSize(primaryAsset.size)}
						</span>
					{:else if platformChecked && !platform}
						<span class="animate-fade">Available for Windows, macOS, Linux, and Android.</span>
					{/if}
				</p>
				<a
					href={resolve('download')}
					class="text-sm text-muted-foreground underline-offset-4 transition-colors duration-150 ease-[ease] hover:text-foreground hover:underline"
				>
					Other platforms and nightly builds
				</a>
			</div>

			<div class="mt-16 animate-enter [--stagger:3]">
				<InteractiveShowcase />
			</div>
		</section>

		<section
			id="features"
			class="mx-auto max-w-5xl scroll-mt-14 px-4 py-20 sm:px-6"
			{@attach reveal}
		>
			<h2 data-reveal-item class="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
				Everything runs on your machine.
			</h2>
			<dl class="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
				{#each features as feature, i (feature.title)}
					<div data-reveal-item style:--stagger={i + 1}>
						<dt class="text-sm font-semibold">{feature.title}</dt>
						<dd class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
							{feature.description}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	</main>

	<Footer />
</div>
