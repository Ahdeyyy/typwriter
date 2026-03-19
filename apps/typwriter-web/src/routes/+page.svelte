<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Separator } from '$lib/components/ui/separator';
	import FeatureCard from '$lib/components/FeatureCard.svelte';

	import {
		GithubLogo,
		Eye,
		ArrowsHorizontal,
		Lightning,
		FolderOpen,
		Export,
		Download,
		AppleLogo,
		LinuxLogo,
		Monitor
	} from 'phosphor-svelte';

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
		return name;
	}

	const features = [
		{
			icon: Eye,
			title: 'Live Preview',
			description:
				'Documents compile and render in real-time as you type. No manual refresh, no waiting.'
		},
		{
			icon: ArrowsHorizontal,
			title: 'Bidirectional Navigation',
			description:
				'Click anywhere in the preview to jump to the corresponding source line — and vice versa.'
		},
		{
			icon: Lightning,
			title: 'Editor Intelligence',
			description:
				'Autocomplete suggestions and inline documentation keep you in flow while writing Typst.'
		},
		{
			icon: FolderOpen,
			title: 'Workspace Management',
			description:
				'Organise your files into projects and quickly reopen recent workspaces from the start screen.'
		},
		{
			icon: Export,
			title: 'Export Anywhere',
			description: 'Generate pixel-perfect PDF, SVG, or PNG output from your document in one click.'
		}
	];
</script>

<svelte:head>
	<title>Typwriter - Typst editor</title>
	<meta
		name="description"
		content="Typwriter is a native desktop editor for Typst with real-time preview, bidirectional navigation, and export to PDF, SVG, and PNG."
	/>
</svelte:head>

<!-- ─── Hero ───────────────────────────────────────────────── -->
<section class="mx-auto max-w-5xl px-6 py-24 text-center">
	<div class="mb-6 flex items-center justify-center gap-3">
		{#if version}
			<Badge variant="secondary">{version}</Badge>
		{/if}
		<Badge variant="outline">Open Source</Badge>
	</div>

	<h1 class="mb-4 text-4xl font-bold tracking-tighter sm:text-5xl lg:text-6xl">Typwriter</h1>

	<p class="mx-auto mb-10 max-w-xl text-base text-muted-foreground sm:text-lg">
		A native desktop editor for Typst with real-time preview, bidirectional navigation, and export
		to PDF, SVG, and PNG.
	</p>

	<div class="flex flex-wrap items-center justify-center gap-3">
		<Button size="lg" href="#download">
			<Download size={16} class="mr-2" />
			Download
		</Button>
		<Button variant="outline" size="lg" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
			<GithubLogo size={16} class="mr-2" />
			View on GitHub
		</Button>
	</div>

	<!-- Screenshot -->
	<div class="mt-16 border border-border bg-muted/30 p-1 shadow-sm">
		<img
			src="/typwriter%20editor.png"
			alt="Typwriter editor interface showing source and preview side by side"
			class="w-full object-cover"
			loading="lazy"
		/>
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
			Available for Windows, macOS, and Linux.
			{#if version}
				Latest release: <span class="text-foreground">{version}</span>
			{/if}
		</p>
	</div>

	<Tabs value="windows" class="mx-auto max-w-xl">
		<TabsList class="grid w-full grid-cols-3">
			<TabsTrigger value="windows">
				<Monitor size={14} class="mr-1.5" />
				Windows
			</TabsTrigger>
			<TabsTrigger value="macos">
				<AppleLogo size={14} class="mr-1.5" />
				macOS
			</TabsTrigger>
			<TabsTrigger value="linux">
				<LinuxLogo size={14} class="mr-1.5" />
				Linux
			</TabsTrigger>
		</TabsList>

		<!-- Windows -->
		<TabsContent value="windows" class="mt-6">
			<div class="flex flex-col gap-3">
				{#if windowsAssets.length > 0}
					{#each windowsAssets as asset}
						<Button
							variant="outline"
							class="h-auto justify-between px-4 py-3"
							href={asset.browser_download_url}
						>
							<span class="flex items-center gap-2">
								<Download size={14} />
								{assetLabel(asset.name)}
							</span>
							<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
						</Button>
					{/each}
				{:else}
					<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
						<Download size={14} class="mr-2" />
						View Windows releases
					</Button>
				{/if}
			</div>
		</TabsContent>

		<!-- macOS -->
		<TabsContent value="macos" class="mt-6">
			<div class="flex flex-col gap-3">
				{#if macosAssets.length > 0}
					{#each macosAssets as asset}
						<Button
							variant="outline"
							class="h-auto justify-between px-4 py-3"
							href={asset.browser_download_url}
						>
							<span class="flex items-center gap-2">
								<Download size={14} />
								{assetLabel(asset.name)}
							</span>
							<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
						</Button>
					{/each}
				{:else}
					<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
						<Download size={14} class="mr-2" />
						View macOS releases
					</Button>
				{/if}
			</div>
		</TabsContent>

		<!-- Linux -->
		<TabsContent value="linux" class="mt-6">
			<div class="flex flex-col gap-3">
				{#if linuxAssets.length > 0}
					{#each linuxAssets as asset}
						<Button
							variant="outline"
							class="h-auto justify-between px-4 py-3"
							href={asset.browser_download_url}
						>
							<span class="flex items-center gap-2">
								<Download size={14} />
								{assetLabel(asset.name)}
							</span>
							<span class="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
						</Button>
					{/each}
				{:else}
					<Button variant="outline" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
						<Download size={14} class="mr-2" />
						View Linux releases
					</Button>
				{/if}
			</div>
		</TabsContent>
	</Tabs>
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
				<GithubLogo size={13} />
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
