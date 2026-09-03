<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import Navbar from '$lib/components/Navbar.svelte';
	import FeatureCard from '$lib/components/FeatureCard.svelte';
	import InteractiveShowcase from '$lib/components/InteractiveShowcase.svelte';
	import DownloadSection from '$lib/components/DownloadSection.svelte';

	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Github01Icon,
		ViewIcon,
		ArrowDataTransferHorizontalIcon,
		FlashIcon,
		Download04Icon,
		SourceCodeIcon,
		TextCheckIcon,
		MagicWand01Icon,
		GitCommitIcon,
		SparklesIcon,
		ArrowRight01Icon,
		FavouriteIcon
	} from '@hugeicons/core-free-icons';

	let { data }: { data: PageData } = $props();

	const GITHUB_URL = 'https://github.com/Ahdeyyy/typwriter';
	const RELEASES_URL = 'https://github.com/Ahdeyyy/typwriter/releases/latest';
	const SPONSOR_URL = 'https://github.com/sponsors/Ahdeyyy';

	const assets = $derived(data.release?.assets ?? []);
	const version = $derived(data.release?.tag_name ?? null);

	const features = [
		{
			icon: ViewIcon,
			title: 'Instant Live Preview',
			description:
				'Your document recompiles as you type. Updates render as quickly as possible (typically sub-100ms), keeping preview in lockstep with your source without manual refreshes.',
			tag: 'Sub-100ms',
			featured: true
		},
		{
			icon: SourceCodeIcon,
			title: 'Handcrafted Syntax Engine',
			description:
				'Full Typst highlighting across markup, math, and code blocks, including embedded languages inside raw code fences.',
			tag: 'Parser'
		},
		{
			icon: ArrowDataTransferHorizontalIcon,
			title: 'Two-Way Source Navigation',
			description:
				'Click directly in the preview to jump to the matching source line. Move your cursor in code and watch the viewport follow.',
			tag: 'Bi-directional'
		},
		{
			icon: FlashIcon,
			title: 'Autocomplete & Documentation',
			description:
				'Context-aware suggestions and hover documentation out of the box. Optionally point it at Tinymist to enhance documentation lookup.',
			tag: 'Docs'
		},
		{
			icon: TextCheckIcon,
			title: 'Local Harper Grammar & Spellcheck',
			description:
				'Harper checks your prose entirely on your local machine with no text leaving your device. Dialect support with custom dictionaries.',
			tag: 'Offline Privacy'
		},
		{
			icon: GitCommitIcon,
			title: 'Automatic Restore Points',
			description:
				'Local snapshots taken on save or successful compile using Zstandard compression. Diff any two points and roll back files instantly.',
			tag: 'Version Control',
			featured: true
		},
		{
			icon: MagicWand01Icon,
			title: 'Typstyle Code Formatting',
			description:
				'Typstyle formats the file, the selection, or every .typ file in the workspace on command or automatically on save.',
			tag: 'Code Formatter'
		}
	];
</script>

<svelte:head>
	<title>Typwriter: Fast, Native Typst Editor for Desktop & Mobile</title>
	<meta
		name="description"
		content="Typwriter is a modern, native Typst editor for Windows, macOS, Linux, and Android. Live preview, syntax highlighting, offline Harper grammar checking, and automatic restore points."
	/>
</svelte:head>

<div class="relative min-h-screen bg-background text-foreground transition-colors duration-300">
	<!-- Navbar -->
	<Navbar {version} />

	<!-- Ambient background lighting -->
	<div
		class="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[650px] w-full max-w-7xl overflow-hidden opacity-40 dark:opacity-25"
		aria-hidden="true"
	>
		<div
			class="animate-pulse-subtle absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[750px] rounded-full bg-gradient-to-tr from-primary/20 via-accent/30 to-transparent blur-[120px]"
		></div>
		<div
			class="absolute inset-0 bg-dot-pattern [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
		></div>
	</div>

	<main class="relative z-10">
		<!-- ─── Hero Section ───────────────────────────────────────── -->
		<section
			class="mx-auto max-w-5xl px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24 sm:pb-28"
		>
			<!-- Eyebrow Pill -->
			<div class="mb-6 inline-flex items-center justify-center">
				<a
					href="#download"
					class="group inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur-xs transition-all duration-200 hover:border-foreground/30 hover:bg-muted hover:text-foreground active:scale-95"
				>
					<span
						class="flex size-1.5 rounded-full bg-primary transition-transform group-hover:scale-125"
					></span>
					<span class="font-mono text-[0.6875rem]">Typwriter {version ?? 'v0.9'}</span>
					<span class="text-border">|</span>
					<span>Desktop & Mobile Typst Editor</span>
					<HugeiconsIcon
						icon={ArrowRight01Icon}
						size={12}
						class="transition-transform duration-200 group-hover:translate-x-0.5"
					/>
				</a>
			</div>

			<!-- Main Heading -->
			<h1
				class="mx-auto mb-6 max-w-4xl text-4xl font-extrabold tracking-tight font-heading sm:text-5xl md:text-6xl lg:text-7xl"
			>
				Effortless Typst typesetting,
				<br class="hidden sm:inline" />
				<span
					class="bg-gradient-to-r from-foreground via-foreground/80 to-muted-foreground bg-clip-text text-transparent"
				>
					rendered in real-time.
				</span>
			</h1>

			<!-- Subtitle -->
			<p
				class="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-8"
			>
				The local-first Typst workspace built for speed. Enjoy keystroke-by-keystroke preview,
				privacy-respecting grammar checks, and instant local snapshots.
			</p>

			<!-- Primary CTAs -->
			<div class="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
				<Button
					size="lg"
					class="h-12 gap-2 rounded-xl px-7 text-sm font-semibold shadow-md transition-transform duration-200 active:scale-95 sm:text-base"
					href="#download"
				>
					<HugeiconsIcon icon={Download04Icon} size={18} />
					<span>Download Free</span>
				</Button>

				<Button
					variant="outline"
					size="lg"
					class="h-12 gap-2 rounded-xl border-border/80 px-6 text-sm font-medium transition-colors hover:bg-muted/70 active:scale-95 sm:text-base"
					href={GITHUB_URL}
					target="_blank"
					rel="noopener noreferrer"
				>
					<HugeiconsIcon icon={Github01Icon} size={18} />
					<span>Star on GitHub</span>
				</Button>
			</div>

			<!-- Interactive Showcase -->
			<div id="showcase" class="mt-14 scroll-mt-20">
				<InteractiveShowcase />
			</div>
		</section>

		<Separator class="opacity-50" />

		<!-- ─── Features Section ───────────────────────────────────── -->
		<section id="features" class="mx-auto max-w-5xl px-4 py-20 sm:px-6 scroll-mt-14">
			<div class="mb-14 text-center">
				<div
					class="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"
				>
					<HugeiconsIcon icon={SparklesIcon} size={14} class="text-primary" />
					<span>Engineered for Writers & Researchers</span>
				</div>
				<h2 class="text-3xl font-bold tracking-tight font-heading sm:text-4xl">
					Everything you need to write and publish.
				</h2>
				<p class="mt-3 text-sm text-muted-foreground sm:text-base">
					Every feature is native, locally executed, and tuned for responsive performance.
				</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each features as feature, index (feature.title + index)}
					<FeatureCard
						icon={feature.icon}
						title={feature.title}
						description={feature.description}
						tag={feature.tag}
						featured={feature.featured}
					/>
				{/each}
			</div>
		</section>

		<Separator class="opacity-50" />

		<!-- ─── Download Section ───────────────────────────────────── -->
		<DownloadSection {assets} {version} />
	</main>

	<Separator class="opacity-50" />

	<!-- ─── Footer ─────────────────────────────────────────────── -->
	<footer class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
		<div
			class="flex flex-col items-center justify-between gap-6 text-xs text-muted-foreground sm:flex-row"
		>
			<div class="flex items-center gap-2">
				<img src="/icon.png" alt="Typwriter" class="size-4 object-contain" />
				<span>© {new Date().getFullYear()} Typwriter · Open source under MIT License</span>
			</div>

			<div class="flex items-center gap-6">
				<a
					href="#features"
					class="transition-colors hover:text-foreground active:scale-95"
				>
					Features
				</a>
				<a
					href="#download"
					class="transition-colors hover:text-foreground active:scale-95"
				>
					Downloads
				</a>
				<a
					href={SPONSOR_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 text-muted-foreground transition-colors hover:text-rose-500 active:scale-95"
				>
					<HugeiconsIcon icon={FavouriteIcon} size={14} class="text-rose-500" />
					Sponsor
				</a>
				<a
					href={GITHUB_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 transition-colors hover:text-foreground active:scale-95"
				>
					<HugeiconsIcon icon={Github01Icon} size={14} />
					GitHub
				</a>
				<a
					href={RELEASES_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="transition-colors hover:text-foreground active:scale-95"
				>
					Releases
				</a>
			</div>
		</div>
	</footer>
</div>
