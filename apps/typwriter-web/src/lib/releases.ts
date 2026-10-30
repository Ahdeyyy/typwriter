interface ReleaseAsset {
	name: string;
	browser_download_url: string;
	size: number;
}

export interface Release {
	tag_name: string;
	name: string;
	html_url: string;
	assets: ReleaseAsset[];
}

const CACHE_KEY = 'typwriter:latest-release:v1';
const CACHE_TTL = 60 * 60 * 1000;

function isRelease(value: unknown): value is Release {
	if (!value || typeof value !== 'object') return false;
	const release = value as Release;
	return (
		typeof release.tag_name === 'string' &&
		typeof release.name === 'string' &&
		typeof release.html_url === 'string' &&
		Array.isArray(release.assets) &&
		release.assets.every(
			(asset) =>
				asset != null &&
				typeof asset.name === 'string' &&
				typeof asset.browser_download_url === 'string' &&
				typeof asset.size === 'number'
		)
	);
}

function readCachedRelease(): Release | null {
	try {
		const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
		const age = Date.now() - cached?.cachedAt;
		if (age >= 0 && age < CACHE_TTL && isRelease(cached?.release)) {
			return cached.release;
		}
	} catch {
		// Storage can be disabled or contain invalid data; fetch from GitHub instead.
	}
	return null;
}

export async function getLatestRelease(
	fetchRelease: typeof fetch = fetch
): Promise<Release | null> {
	const cached = readCachedRelease();
	if (cached) return cached;

	try {
		const res = await fetchRelease(
			'https://api.github.com/repos/Ahdeyyy/typwriter/releases/latest',
			{
				headers: { Accept: 'application/vnd.github+json' },
				cache: 'no-cache',
				signal: AbortSignal.timeout(8000)
			}
		);
		if (!res.ok) return null;
		const data: unknown = await res.json();
		if (!isRelease(data)) return null;
		// Keep only the fields the page needs, rather than the full GitHub response.
		const release: Release = {
			tag_name: data.tag_name,
			name: data.name,
			html_url: data.html_url,
			assets: data.assets.map(({ name, browser_download_url, size }) => ({
				name,
				browser_download_url,
				size
			}))
		};
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), release }));
		} catch {
			// A storage failure must not discard a successful release lookup.
		}
		return release;
	} catch {
		return null;
	}
}
