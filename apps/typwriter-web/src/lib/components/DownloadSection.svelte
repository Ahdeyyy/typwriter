<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import { getRelease, RELEASE_PAGES, type Channel, type Release } from '$lib/releases';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ComputerIcon,
		LaptopIcon,
		Apple01Icon,
		AndroidIcon,
		Download04Icon,
		InformationCircleIcon,
		TestTube01Icon
	} from '@hugeicons/core-free-icons';

	interface Asset {
		name: string;
		browser_download_url: string;
		size: number;
	}

	interface Props {
		assets: Asset[];
		version: string | null;
	}

	let { assets, version }: Props = $props();

	let channel = $state<Channel>('stable');
	let nightly = $state<Release | null>(null);
	let nightlyRequested = false;

	// Most visitors never open the nightly tab, so it is only fetched on demand.
	function selectChannel(value: string) {
		channel = value as Channel;
		if (channel !== 'nightly' || nightlyRequested) return;
		nightlyRequested = true;
		void getRelease('nightly').then((release) => {
			nightly = release;
			// Let a later visit to the tab retry a failed lookup.
			if (!release) nightlyRequested = false;
		});
	}

	const productName = $derived(channel === 'nightly' ? 'Typwriter Nightly' : 'Typwriter');
	const releasesUrl = $derived(RELEASE_PAGES[channel]);
	const activeAssets = $derived(channel === 'nightly' ? (nightly?.assets ?? []) : assets);
	// The nightly tag never changes, so its build version comes from the files.
	const activeVersion = $derived(
		channel === 'nightly'
			? (nightly?.assets
					.map((a) => /\d+\.\d+\.\d+-nightly\.\d+/.exec(a.name)?.[0])
					.find(Boolean) ?? null)
			: version
	);
	const OBTAINIUM_URL = 'https://github.com/ImranR98/Obtainium';
	const MACOS_UNSIGNED_GUIDE_URL =
		'https://github.com/st235/macos-unverified-signature-apps-installation';

	// Client OS Detection
	let userOs = $state<'windows' | 'macos' | 'linux' | 'android'>('windows');

	$effect(() => {
		if (typeof window === 'undefined') return;
		const ua = window.navigator.userAgent.toLowerCase();
		if (ua.includes('android')) userOs = 'android';
		else if (ua.includes('mac') || ua.includes('darwin')) userOs = 'macos';
		else if (ua.includes('linux')) userOs = 'linux';
		else userOs = 'windows';
	});

	function formatSize(bytes: number): string {
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function assetLabel(name: string): string {
		if (name.endsWith('.exe')) return 'Setup Installer (.exe)';
		if (name.endsWith('.msi')) return 'MSI Package (.msi)';
		if (name.includes('aarch64') && name.endsWith('.dmg')) return 'Apple Silicon (.dmg)';
		if (name.includes('x64') && name.endsWith('.dmg')) return 'Intel Mac (.dmg)';
		if (name.endsWith('.deb')) return 'Debian / Ubuntu (.deb)';
		if (name.endsWith('.rpm')) return 'Fedora / RHEL (.rpm)';
		if (name.endsWith('.AppImage')) return 'AppImage (Standalone)';
		if (name.endsWith('_arm64.apk')) return 'ARM64 APK (Modern Android)';
		if (name.endsWith('_arm.apk')) return 'ARMv7 APK (Older Android)';
		if (name.endsWith('_x86_64.apk')) return 'x86_64 APK';
		if (name.endsWith('.apk')) return 'Android APK';
		return name;
	}

	const windowsAssets = $derived(
		activeAssets.filter((a) => a.name.endsWith('.exe') || a.name.endsWith('.msi'))
	);
	const macosAssets = $derived(activeAssets.filter((a) => a.name.endsWith('.dmg')));
	const linuxAssets = $derived(
		activeAssets.filter(
			(a) => a.name.endsWith('.deb') || a.name.endsWith('.rpm') || a.name.endsWith('.AppImage')
		)
	);

	const APK_ABI_ORDER = ['arm64', 'arm', 'x86_64', 'x86'];
	const androidAssets = $derived(
		activeAssets
			.filter((a) => a.name.endsWith('.apk'))
			.slice()
			.sort((a, b) => {
				const ia = APK_ABI_ORDER.findIndex((abi) => a.name.endsWith(`_${abi}.apk`));
				const ib = APK_ABI_ORDER.findIndex((abi) => b.name.endsWith(`_${abi}.apk`));
				return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
			})
	);

	const platformMap = $derived({
		windows: {
			name: 'Windows',
			icon: ComputerIcon,
			assets: windowsAssets,
			primaryAsset: windowsAssets[0] ?? null,
			badge: null
		},
		macos: {
			name: 'macOS',
			icon: Apple01Icon,
			assets: macosAssets,
			// Prefer Apple Silicon by default
			primaryAsset: macosAssets.find((a) => a.name.includes('aarch64')) ?? macosAssets[0] ?? null,
			badge: 'Unsigned'
		},
		linux: {
			name: 'Linux',
			icon: LaptopIcon,
			assets: linuxAssets,
			primaryAsset: linuxAssets.find((a) => a.name.endsWith('.AppImage')) ?? linuxAssets[0] ?? null,
			badge: null
		},
		android: {
			name: 'Android',
			icon: AndroidIcon,
			assets: androidAssets,
			primaryAsset: androidAssets[0] ?? null,
			badge: null
		}
	});

	const detectedPlatform = $derived(platformMap[userOs]);
</script>

<section id="download" class="mx-auto max-w-5xl px-4 py-20 sm:px-6">
	<div class="mb-12 text-center">
		<div
			class="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground"
		>
			<HugeiconsIcon icon={Download04Icon} size={14} class="text-primary" />
			<span>{channel === 'nightly' ? 'Nightly Build' : 'Latest Release'}</span>
			{#if activeVersion}
				<span class="font-mono text-foreground font-semibold">({activeVersion})</span>
			{/if}
		</div>
		<h2 class="mb-3 text-3xl font-bold tracking-tight font-heading sm:text-4xl">
			Get Typwriter Today
		</h2>
		<p class="mx-auto max-w-lg text-sm text-muted-foreground sm:text-base">
			Native builds for Windows, macOS, Linux, and Android. Fast, local-first, zero telemetry.
		</p>
	</div>

	<Tabs.Root value={channel} onValueChange={selectChannel} class="items-center gap-6">
		<Tabs.List aria-label="Release channel" class="group-data-horizontal/tabs:h-9">
			<Tabs.Trigger value="stable" class="px-4">Stable</Tabs.Trigger>
			<Tabs.Trigger value="nightly" class="px-4">
				<HugeiconsIcon icon={TestTube01Icon} size={14} />
				Nightly
			</Tabs.Trigger>
		</Tabs.List>
		{#each ['stable', 'nightly'] as tab (tab)}
			<Tabs.Content value={tab} class="w-full">
				{#if tab === channel}
					{@render downloads()}
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</section>

{#snippet downloads()}
	{#if channel === 'nightly'}
		<div
			class="mb-6 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-xs text-muted-foreground sm:text-sm"
		>
			<HugeiconsIcon icon={InformationCircleIcon} size={16} class="mt-0.5 shrink-0 text-sky-500" />
			<p>
				Nightly builds come from the latest changes and may be unstable. They install as a
				separate app, <span class="font-medium text-foreground">Typwriter Nightly</span>, next to
				the stable one, with their own settings, and update themselves to the next nightly.
			</p>
		</div>
	{/if}

	<!-- Recommended Platform Banner -->
	<div
		class="mb-10 overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8"
	>
		<div class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold uppercase tracking-wider text-primary">
						Detected for your system
					</span>
					{#if detectedPlatform.badge}
						<span
							class="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase text-amber-600 dark:text-amber-400"
						>
							{detectedPlatform.badge}
						</span>
					{/if}
				</div>
				<h3 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
					<HugeiconsIcon icon={detectedPlatform.icon} size={24} class="text-primary" />
					{productName} for {detectedPlatform.name}
				</h3>
				<p class="text-xs text-muted-foreground sm:text-sm">
					{#if userOs === 'windows'}
						Includes native 64-bit installer with instant preview and Typst runtime bundled.
					{:else}
						Select your architecture or package format below.
					{/if}
				</p>
			</div>

			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center">
				{#if detectedPlatform.primaryAsset}
					<Button
						size="lg"
						class="h-12 gap-2 px-6 font-semibold shadow-md active:scale-[0.98]"
						href={detectedPlatform.primaryAsset.browser_download_url}
					>
						<HugeiconsIcon icon={Download04Icon} size={18} />
						<span>Download {detectedPlatform.name}</span>
						<span class="text-xs opacity-75 font-mono">
							({formatSize(detectedPlatform.primaryAsset.size)})
						</span>
					</Button>
				{:else}
					<Button
						size="lg"
						class="h-12 gap-2 px-6"
						href={releasesUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						<HugeiconsIcon icon={Download04Icon} size={18} />
						<span>View Releases</span>
					</Button>
				{/if}

				<Button
					variant="outline"
					size="lg"
					class="h-12 gap-2 px-5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.98]"
					href="#all-platforms"
				>
					<span>All Platforms & Formats</span>
				</Button>
			</div>
		</div>
	</div>

	<!-- All Platforms Grid -->
	<div id="all-platforms" class="grid gap-6 md:grid-cols-2 scroll-mt-20">
		<!-- Windows -->
		<div
			class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-xs"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm font-semibold">
					<HugeiconsIcon icon={ComputerIcon} size={16} class="text-primary" />
					<span>Windows</span>
				</div>
				<span class="text-xs text-muted-foreground font-mono">x64</span>
			</div>
			<div class="flex flex-col gap-2">
				{#each windowsAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between border-border/70 px-3.5 py-2.5 text-xs hover:border-foreground/30 active:scale-[0.99]"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2 font-medium">
							<HugeiconsIcon icon={Download04Icon} size={14} class="text-muted-foreground" />
							{assetLabel(asset.name)}
						</span>
						<span class="font-mono text-[0.6875rem] text-muted-foreground">
							{formatSize(asset.size)}
						</span>
					</Button>
				{/each}
			</div>
		</div>

		<!-- macOS -->
		<div
			class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-xs"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm font-semibold">
					<HugeiconsIcon icon={Apple01Icon} size={16} class="text-primary" />
					<span>macOS</span>
					<span
						class="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.2 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400"
					>
						Unsigned
					</span>
				</div>
				<span class="text-xs text-muted-foreground font-mono">DMG</span>
			</div>

			<div class="flex flex-col gap-2">
				{#each macosAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between border-border/70 px-3.5 py-2.5 text-xs hover:border-foreground/30 active:scale-[0.99]"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2 font-medium">
							<HugeiconsIcon icon={Download04Icon} size={14} class="text-muted-foreground" />
							{assetLabel(asset.name)}
						</span>
						<span class="font-mono text-[0.6875rem] text-muted-foreground">
							{formatSize(asset.size)}
						</span>
					</Button>
				{/each}
			</div>

			<div class="flex items-start gap-1.5 rounded-lg bg-muted/40 p-2.5 text-[0.6875rem] text-muted-foreground">
				<HugeiconsIcon icon={InformationCircleIcon} size={13} class="mt-0.5 shrink-0 text-amber-500" />
				<p>
					Gatekeeper blocks unsigned binaries by default.
					<a
						href={MACOS_UNSIGNED_GUIDE_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="font-medium text-foreground underline underline-offset-2 hover:text-primary"
					>
						Installation bypass instructions
					</a>
				</p>
			</div>
		</div>

		<!-- Linux -->
		<div
			class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-xs"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm font-semibold">
					<HugeiconsIcon icon={LaptopIcon} size={16} class="text-primary" />
					<span>Linux</span>
				</div>
				<span class="text-xs text-muted-foreground font-mono">deb / rpm / appimage</span>
			</div>
			<div class="flex flex-col gap-2">
				{#each linuxAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between border-border/70 px-3.5 py-2.5 text-xs hover:border-foreground/30 active:scale-[0.99]"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2 font-medium">
							<HugeiconsIcon icon={Download04Icon} size={14} class="text-muted-foreground" />
							{assetLabel(asset.name)}
						</span>
						<span class="font-mono text-[0.6875rem] text-muted-foreground">
							{formatSize(asset.size)}
						</span>
					</Button>
				{/each}
			</div>
		</div>

		<!-- Android -->
		<div
			class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-xs"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm font-semibold">
					<HugeiconsIcon icon={AndroidIcon} size={16} class="text-primary" />
					<span>Android</span>
				</div>
				<span class="text-xs text-muted-foreground font-mono">APK</span>
			</div>
			<div class="flex flex-col gap-2">
				{#each androidAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between border-border/70 px-3.5 py-2.5 text-xs hover:border-foreground/30 active:scale-[0.99]"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2 font-medium">
							<HugeiconsIcon icon={Download04Icon} size={14} class="text-muted-foreground" />
							{assetLabel(asset.name)}
						</span>
						<span class="font-mono text-[0.6875rem] text-muted-foreground">
							{formatSize(asset.size)}
						</span>
					</Button>
				{/each}
			</div>
			<div class="flex items-start gap-1.5 rounded-lg bg-muted/40 p-2.5 text-[0.6875rem] text-muted-foreground">
				<HugeiconsIcon icon={InformationCircleIcon} size={13} class="mt-0.5 shrink-0 text-muted-foreground" />
				<p>
					The app checks for updates itself. You can also track releases with
					<a
						href={OBTAINIUM_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="font-medium text-foreground underline underline-offset-2 hover:text-primary"
					>
						Obtainium</a
					>.
				</p>
			</div>
		</div>
	</div>
{/snippet}
