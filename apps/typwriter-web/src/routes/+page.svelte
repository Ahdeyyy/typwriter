<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import FeatureCard from '$lib/components/FeatureCard.svelte';

	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Github01Icon,
		ViewIcon,
		ArrowDataTransferHorizontalIcon,
		FlashIcon,
		FolderOpenIcon,
		FileExportIcon,
		Download04Icon,
		Apple01Icon,
		ComputerIcon,
		SourceCodeIcon,
		AndroidIcon,
		LaptopIcon
	} from '@hugeicons/core-free-icons';

	import showcaseDark from '$lib/assets/showcase_dark.png';
	import showcaseLight from '$lib/assets/showcase_light.png';

	let { data }: { data: PageData } = $props();

	const GITHUB_URL = 'https://github.com/Ahdeyyy/typwriter';
	const RELEASES_URL = 'https://github.com/Ahdeyyy/typwriter/releases/latest';

	const assets = $derived(data.release?.assets ?? []);
	const version = $derived(data.release?.tag_name ?? null);

	const windowsAssets = $derived(
		assets.filter((a) => a.name.endsWith('.exe') || a.name.endsWith('.msi'))
	);
	const macosAssets = $derived(assets.filter((a) => a.name.endsWith('.dmg')));
	const linuxAssets = $derived(
		assets.filter(
			(a) => a.name.endsWith('.deb') || a.name.endsWith('.rpm') || a.name.endsWith('.AppImage')
		)
	);
	// APK asset names follow `typwriter_${VERSION}_${abi}.apk`.
	// Sort by preferred ABI so 64-bit ARM (what almost every modern phone wants) comes first.
	const APK_ABI_ORDER = ['arm64', 'arm', 'x86_64', 'x86'];
	const androidAssets = $derived(
		assets
			.filter((a) => a.name.endsWith('.apk'))
			.slice()
			.sort((a, b) => {
				const ia = APK_ABI_ORDER.findIndex((abi) => a.name.endsWith(`_${abi}.apk`));
				const ib = APK_ABI_ORDER.findIndex((abi) => b.name.endsWith(`_${abi}.apk`));
				return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
			})
	);

	let desktopTheme = $state<'dark' | 'light' | null>(null);

	function formatSize(bytes: number): string {
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function assetLabel(name: string): string {
		if (name.endsWith('.exe')) return 'Setup installer (.exe)';
		if (name.endsWith('.msi')) return 'MSI installer (.msi)';
		if (name.includes('x64') && name.endsWith('.dmg')) return 'Intel / x64 (.dmg)';
		if (name.includes('aarch64') && name.endsWith('.dmg')) return 'Apple Silicon (.dmg)';
		if (name.endsWith('.deb')) return 'Debian / Ubuntu (.deb)';
		if (name.endsWith('.rpm')) return 'Fedora / RHEL (.rpm)';
		if (name.endsWith('.AppImage')) return 'AppImage';
		if (name.endsWith('_arm64.apk')) return 'ARM64 (.apk)';
		if (name.endsWith('_arm.apk')) return 'ARMv7 (.apk)';
		if (name.endsWith('_x86_64.apk')) return 'x86_64 (.apk)';
		if (name.endsWith('_x86.apk')) return 'x86 (.apk)';
		if (name.endsWith('.apk')) return 'Android (.apk)';
		return name;
	}

	const features = [
		{
			icon: ViewIcon,
			title: 'Live preview',
			description:
				'Your document recompiles as you type. The rendered page stays one keystroke behind your source, no manual refresh.'
		},
		{
			icon: SourceCodeIcon,
			title: 'Syntax highlighting',
			description:
				'Full Typst highlighting across markup, math, and code blocks, so the source stays easy to read and navigate.'
		},
		{
			icon: ArrowDataTransferHorizontalIcon,
			title: 'Two-way navigation',
			description:
				'Click in the preview to jump to the matching source line. Move your cursor in the source to see the page follow.'
		},
		{
			icon: FlashIcon,
			title: 'Autocomplete & docs',
			description:
				'Context-aware suggestions and inline documentation surface the right symbol while you write, not after you guess.'
		},
		{
			icon: FolderOpenIcon,
			title: 'Workspaces',
			description:
				'Organise documents as projects. Pick up where you left off from a recent-workspaces list, on every device.'
		},
		{
			icon: FileExportIcon,
			title: 'Export anywhere',
			description:
				'Generate pixel-perfect PDF, SVG, or PNG output from the current document in one click.'
		}
	];
</script>

<svelte:head>
	<title>Typwriter — a Typst editor for desktop and mobile</title>
	<meta
		name="description"
		content="Typwriter is a Typst editor for Windows, macOS, Linux, and Android. Live preview, syntax highlighting, autocomplete, and export to PDF, SVG, or PNG."
	/>
</svelte:head>

<!-- ─── Hero ───────────────────────────────────────────────── -->
<section class="mx-auto max-w-7xl px-6 py-24 text-center">
	<h1 class="mb-4 text-4xl font-bold tracking-tighter sm:text-5xl lg:text-6xl">Typwriter</h1>

	<p class="mx-auto mb-10 max-w-xl text-base text-muted-foreground sm:text-lg">
		A Typst editor for Windows, macOS, Linux, and Android*. Write with syntax highlighting and
		autocomplete, watch your document render as you type, and export to PDF, SVG, or PNG.
	</p>

	<div class="flex flex-wrap items-center justify-center gap-3">
		<Button size="lg" class="px-8 py-6 text-base" href="#download">
			<HugeiconsIcon icon={Download04Icon} size={18} class="mr-2" />
			Download
		</Button>
	</div>

	<div class="showcase-row">
		<div class="theme-stack relative w-full">
			<div class="theme-stack__frames" data-active-theme={desktopTheme ?? undefined}>
				<button
					type="button"
					class="theme-frame theme-frame--dark"
					aria-label="Show the desktop dark mode screenshot"
					onclick={() => (desktopTheme = 'dark')}
				>
					<img
						src={showcaseDark}
						alt="Typwriter editor in dark mode, source on the left, rendered preview on the right"
						fetchpriority="high"
					/>
				</button>

				<button
					type="button"
					class="theme-frame theme-frame--light"
					aria-label="Show the desktop light mode screenshot"
					onclick={() => (desktopTheme = 'light')}
				>
					<img
						src={showcaseLight}
						alt="Typwriter editor in light mode, source on the left, rendered preview on the right"
						loading="lazy"
					/>
				</button>
			</div>
		</div>
	</div>
</section>

<Separator />

<!-- ─── Features ──────────────────────────────────────────── -->
<section class="mx-auto max-w-5xl px-6 py-20">
	<div class="mb-12 text-center">
		<h2 class="mb-2 text-2xl font-bold tracking-tight">Features</h2>
	</div>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each features as feature, index (feature.title + index)}
			<FeatureCard icon={feature.icon} title={feature.title} description={feature.description} />
		{/each}
	</div>
</section>

<Separator />

<!-- ─── Download ──────────────────────────────────────────── -->
<section id="download" class="mx-auto max-w-5xl px-6 py-20">
	<div class="mb-12 text-center">
		<h2 class="mb-2 text-2xl font-bold tracking-tight">Download</h2>
		<p class="text-sm text-muted-foreground">
			Available for Windows, macOS, Linux, and Android.
			{#if version}
				Latest release: <span class="text-foreground">{version}</span>
			{/if}
		</p>
	</div>

	<div class="grid gap-6 sm:grid-cols-2">
		<!-- Windows -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-2 text-sm font-medium">
				<HugeiconsIcon icon={ComputerIcon} size={15} class="text-muted-foreground" />
				Windows
			</div>
			{#if windowsAssets.length > 0}
				{#each windowsAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between px-4 py-3"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2">
							<HugeiconsIcon icon={Download04Icon} size={14} />
							{assetLabel(asset.name)}
						</span>
						<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
					</Button>
				{/each}
			{:else}
				<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
					<HugeiconsIcon icon={Download04Icon} size={14} class="mr-2" />
					View Windows releases
				</Button>
			{/if}
		</div>

		<!-- macOS -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-2 text-sm font-medium">
				<HugeiconsIcon icon={Apple01Icon} size={15} class="text-muted-foreground" />
				macOS
			</div>
			{#if macosAssets.length > 0}
				{#each macosAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between px-4 py-3"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2">
							<HugeiconsIcon icon={Download04Icon} size={14} />
							{assetLabel(asset.name)}
						</span>
						<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
					</Button>
				{/each}
			{:else}
				<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
					<HugeiconsIcon icon={Download04Icon} size={14} class="mr-2" />
					View macOS releases
				</Button>
			{/if}
		</div>

		<!-- Linux -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-2 text-sm font-medium">
				<HugeiconsIcon icon={LaptopIcon} size={15} class="text-muted-foreground" />
				Linux
			</div>
			{#if linuxAssets.length > 0}
				{#each linuxAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between px-4 py-3"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2">
							<HugeiconsIcon icon={Download04Icon} size={14} />
							{assetLabel(asset.name)}
						</span>
						<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
					</Button>
				{/each}
			{:else}
				<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
					<HugeiconsIcon icon={Download04Icon} size={14} class="mr-2" />
					View Linux releases
				</Button>
			{/if}
		</div>

		<!-- Android -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-2 text-sm font-medium">
				<HugeiconsIcon icon={AndroidIcon} size={15} class="text-muted-foreground" />
				Android
				<span
					class="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide text-amber-600 uppercase dark:text-amber-400"
				>
					Experimental
				</span>
			</div>
			<p class="text-xs text-muted-foreground">
				The Android build is highly experimental — expect bugs, missing features, and breaking
				changes. Back up your work and don't rely on it for anything important yet.
			</p>
			{#if androidAssets.length > 0}
				{#each androidAssets as asset (asset.name)}
					<Button
						variant="outline"
						class="h-auto justify-between px-4 py-3"
						href={asset.browser_download_url}
					>
						<span class="flex items-center gap-2">
							<HugeiconsIcon icon={Download04Icon} size={14} />
							{assetLabel(asset.name)}
						</span>
						<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
					</Button>
				{/each}
			{:else}
				<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
					<HugeiconsIcon icon={Download04Icon} size={14} class="mr-2" />
					View Android releases
				</Button>
			{/if}
		</div>
	</div>
</section>

<Separator />

<!-- ─── Footer ────────────────────────────────────────────── -->
<footer class="mx-auto max-w-5xl px-6 py-10">
	<div
		class="flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row"
	>
		<span>
			© {new Date().getFullYear()} typwriter · MIT License
		</span>
		<div class="flex items-center gap-4">
			<a
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-1 transition-colors hover:text-foreground"
			>
				<HugeiconsIcon icon={Github01Icon} size={13} />
				GitHub
			</a>
			<a
				href={RELEASES_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="transition-colors hover:text-foreground"
			>
				Releases
			</a>
		</div>
	</div>
</footer>

<style>
	.showcase-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: center;
		margin-top: 5rem;
		padding-inline: clamp(1.5rem, 4vw, 4rem);
	}

	.theme-stack__frames {
		position: relative;
		aspect-ratio: 16 / 10;
		isolation: isolate;
		width: 100%;
		max-width: 56rem;
		margin-inline: auto;
	}

	.theme-frame {
		position: absolute;
		inset: 0;
		margin: 0;
		overflow: hidden;
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 0.5rem;
		background: transparent;
		padding: 0;
		color: inherit;
		box-shadow: 0 14px 30px -18px oklch(0 0 0 / 0.35);
		-webkit-mask-image: linear-gradient(to bottom, black 0%, black 76%, rgb(0 0 0 / 0.38) 100%);
		mask-image: linear-gradient(to bottom, black 0%, black 76%, rgb(0 0 0 / 0.38) 100%);
		cursor: pointer;
		transition:
			transform 600ms cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 600ms cubic-bezier(0.16, 1, 0.3, 1),
			border-color 200ms ease;
	}

	.theme-frame:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 0.35rem;
	}

	.theme-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
	}

	.theme-frame--light {
		z-index: 1;
		transform: translate(-9%, 10%) scale(0.93) rotate(-1.2deg);
	}
	.theme-frame--dark {
		z-index: 2;
		transform: translate(3%, -2%) scale(0.96);
	}

	.theme-stack__frames[data-active-theme='light'] .theme-frame--light,
	.theme-stack__frames[data-active-theme='dark'] .theme-frame--dark {
		z-index: 4;
		transform: translate(2%, -1%) scale(0.98) rotate(0deg);
		box-shadow: 0 40px 60px -28px oklch(0 0 0 / 0.4);
	}

	.theme-stack__frames[data-active-theme='light'] .theme-frame--dark {
		z-index: 1;
		transform: translate(11%, -8%) scale(0.9) rotate(1.2deg);
		opacity: 0.86;
	}

	.theme-stack__frames[data-active-theme='dark'] .theme-frame--light {
		z-index: 1;
		transform: translate(-9%, 10%) scale(0.93) rotate(-1.2deg);
		opacity: 0.86;
	}

	@media (prefers-color-scheme: light) {
		.theme-stack__frames:not([data-active-theme]) .theme-frame--light {
			z-index: 2;
			transform: translate(2%, -1%) scale(0.98);
		}

		.theme-stack__frames:not([data-active-theme]) .theme-frame--dark {
			z-index: 1;
			transform: translate(11%, -8%) scale(0.9) rotate(1.2deg);
			opacity: 0.86;
		}
	}

	@media (max-width: 640px) {
		.showcase-row {
			margin-top: 4rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-frame {
			transition: none;
		}
	}
</style>
