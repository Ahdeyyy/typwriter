<script lang="ts">
	import { onMount } from 'svelte';
	import { getRelease, RELEASE_PAGES, type Channel, type Release } from '#lib/releases.ts';
	import {
		assetLabel,
		detectPlatform,
		formatSize,
		groupAssets,
		PLATFORM_NAMES,
		PLATFORMS,
		type Platform
	} from '#lib/platforms.ts';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import Navbar from '#lib/components/Navbar.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import PlatformIcon from '#lib/components/PlatformIcon.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Download04Icon } from '@hugeicons/core-free-icons';

	// The sliding pill below the triggers is the active background, so theirs is cleared.
	const trigger =
		'z-10 px-4 transition-[color,scale] ease-out active:scale-[0.96] data-active:bg-transparent dark:data-active:border-transparent dark:data-active:bg-transparent';

	const OBTAINIUM_URL = 'https://github.com/ImranR98/Obtainium';
	const MACOS_UNSIGNED_GUIDE_URL =
		'https://github.com/st235/macos-unverified-signature-apps-installation';

	let channel = $state<Channel>('stable');
	let releases = $state<Record<Channel, Release | null>>({ stable: null, nightly: null });
	let loaded = $state<Record<Channel, boolean>>({ stable: false, nightly: false });
	let platform = $state<Platform | null>(null);

	function load(target: Channel) {
		void getRelease(target).then((release) => {
			releases[target] = release;
			loaded[target] = true;
		});
	}

	onMount(() => {
		platform = detectPlatform(navigator.userAgent);
		load('stable');
	});

	// Most visitors never open the nightly tab, so it is only fetched on demand.
	// A failed lookup is retried the next time the tab is opened.
	function selectChannel(value: string) {
		channel = value as Channel;
		if (channel === 'nightly' && !releases.nightly) load('nightly');
	}

	const release = $derived(releases[channel]);
	const groups = $derived(groupAssets(release?.assets ?? []));
	// The nightly tag never changes, so its build version comes from the files.
	const version = $derived(
		channel === 'nightly'
			? (release?.assets.map((a) => /\d+\.\d+\.\d+-nightly\.\d+/.exec(a.name)?.[0]).find(Boolean) ??
					null)
			: (release?.tag_name.replace(/^typwriter-/, '') ?? null)
	);
	// The visitor's platform goes first.
	const ordered = $derived(
		platform ? [platform, ...PLATFORMS.filter((p) => p !== platform)] : PLATFORMS
	);
</script>

<svelte:head>
	<title>Download Typwriter</title>
	<meta
		name="description"
		content="Download Typwriter for Windows, macOS, Linux, and Android, or try the nightly build."
	/>
</svelte:head>

<div class="min-h-screen text-foreground">
	<Navbar />

	<main class="mx-auto max-w-3xl px-4 py-16 sm:px-6">
		<h1 class="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Download Typwriter</h1>
		<p class="mt-3 text-muted-foreground">
			Free for Windows, macOS, Linux, and Android.
			{#if version}
				{#key version}<span class="animate-fade font-mono text-sm">{version}</span>{/key}
			{/if}
		</p>

		<Tabs.Root value={channel} onValueChange={selectChannel} class="mt-8 gap-6">
			<!-- One pill slides between the triggers, like the showcase toggles. -->
			<Tabs.List
				aria-label="Release channel"
				class="relative grid grid-cols-2 group-data-horizontal/tabs:h-9"
			>
				<span
					aria-hidden="true"
					class="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full bg-background shadow-xs transition-transform duration-200 ease-in-out motion-reduce:transition-none dark:border dark:border-input dark:bg-input/30 {channel ===
					'nightly'
						? 'translate-x-full'
						: ''}"
				></span>
				<Tabs.Trigger value="stable" class={trigger}>Stable</Tabs.Trigger>
				<Tabs.Trigger value="nightly" class={trigger}>Nightly</Tabs.Trigger>
			</Tabs.List>
			{#each ['stable', 'nightly'] as tab (tab)}
				<Tabs.Content value={tab}>
					{#if tab === channel}
						{@render downloads()}
					{/if}
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	</main>

	<Footer />
</div>

{#snippet downloads()}
	{#if channel === 'nightly'}
		<p class="mb-6 animate-fade text-sm text-muted-foreground">
			Built from the latest changes, so expect rough edges. Nightly installs as a separate app,
			<span class="text-foreground">Typwriter Nightly</span>, with its own settings, and updates
			itself to the next nightly.
		</p>
	{/if}

	{#if loaded[channel] && !release}
		<p class="animate-fade text-sm text-muted-foreground">
			Couldn't reach GitHub.
			<a
				href={RELEASE_PAGES[channel]}
				target="_blank"
				rel="noopener noreferrer"
				class="text-foreground underline underline-offset-4"
			>
				Get the files from the release page
			</a>.
		</p>
	{:else}
		<div class="divide-y divide-border/60 border-y border-border/60">
			{#each ordered as p, i (p)}
				<section class="grid gap-3 py-6 sm:grid-cols-[10rem_1fr]">
					<h2 class="flex items-center gap-2 text-sm font-semibold">
						<PlatformIcon platform={p} />
						{PLATFORM_NAMES[p]}
						{#if p === platform}
							<span class="text-xs font-normal text-muted-foreground">(this device)</span>
						{/if}
					</h2>
					<div>
						{#if !loaded[channel]}
							<div class="h-9 animate-pulse rounded-full bg-muted/60"></div>
						{:else if groups[p].length === 0}
							<p class="animate-fade text-sm text-muted-foreground">Not available in this build.</p>
						{/if}
						<!-- Shorter than the hero entrance: this is a list people come back to. -->
						<ul
							class="flex flex-col gap-1 [&>li]:animate-enter [&>li]:[animation-duration:250ms]"
							style:--stagger={i}
						>
							{#each groups[p] as asset (asset.name)}
								<li>
									<a
										href={asset.browser_download_url}
										class="group flex items-center justify-between gap-4 rounded-full px-4 py-2 text-sm transition-[background-color,scale] duration-150 ease-out hover:bg-muted/60 active:scale-[0.99] active:bg-muted"
									>
										<span class="flex items-center gap-2">
											<HugeiconsIcon
												icon={Download04Icon}
												size={14}
												class="text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-y-0.5 motion-reduce:transition-none"
											/>
											{assetLabel(asset.name)}
										</span>
										<span class="font-mono text-xs text-muted-foreground">
											{formatSize(asset.size)}
										</span>
									</a>
								</li>
							{/each}
						</ul>
						{#if p === 'macos' && groups[p].length > 0}
							<p class="mt-2 px-3 text-xs text-muted-foreground">
								The app isn't signed yet, so macOS will block it the first time.
								<a
									href={MACOS_UNSIGNED_GUIDE_URL}
									target="_blank"
									rel="noopener noreferrer"
									class="text-foreground underline underline-offset-4">How to open it</a
								>.
							</p>
						{:else if p === 'android' && groups[p].length > 0}
							<p class="mt-2 px-3 text-xs text-muted-foreground">
								The app updates itself. You can also track releases with
								<a
									href={OBTAINIUM_URL}
									target="_blank"
									rel="noopener noreferrer"
									class="text-foreground underline underline-offset-4">Obtainium</a
								>.
							</p>
						{/if}
					</div>
				</section>
			{/each}
		</div>
	{/if}
{/snippet}
