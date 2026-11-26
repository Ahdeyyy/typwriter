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

export type Channel = 'stable' | 'nightly';

const RELEASES_API = 'https://api.github.com/repos/Ahdeyyy/typwriter/releases';

// Each nightly build deletes the previous one's files, so its download links
// go stale quickly and are cached for much less time than a stable release.
const CHANNELS: Record<Channel, { url: string; cacheKey: string; ttl: number }> = {
	stable: {
		url: `${RELEASES_API}/latest`,
		cacheKey: 'typwriter:latest-release:v1',
		ttl: 60 * 60 * 1000
	},
	nightly: {
		url: `${RELEASES_API}/tags/nightly`,
		cacheKey: 'typwriter:nightly-release:v1',
		ttl: 5 * 60 * 1000
	}
};

export const RELEASE_PAGES: Record<Channel, string> = {
	stable: 'https://github.com/Ahdeyyy/typwriter/releases/latest',
	nightly: 'https://github.com/Ahdeyyy/typwriter/releases/tag/nightly'
};

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

function readCachedRelease(cacheKey: string, ttl: number): Release | null {
	try {
		const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
		const age = Date.now() - cached?.cachedAt;
		if (age >= 0 && age < ttl && isRelease(cached?.release)) {
			return cached.release;
		}
	} catch {
		// Storage can be disabled or contain invalid data; fetch from GitHub instead.
	}
	return null;
}

export async function getRelease(
	channel: Channel,
	fetchRelease: typeof fetch = fetch
): Promise<Release | null> {
	const { url, cacheKey, ttl } = CHANNELS[channel];
	const cached = readCachedRelease(cacheKey, ttl);
	if (cached) return cached;

	try {
		const res = await fetchRelease(url, {
			headers: { Accept: 'application/vnd.github+json' },
			cache: 'no-cache',
			signal: AbortSignal.timeout(8000)
		});
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
			localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), release }));
		} catch {
			// A storage failure must not discard a successful release lookup.
		}
		return release;
	} catch {
		return null;
	}
}

export function getLatestRelease(fetchRelease: typeof fetch = fetch): Promise<Release | null> {
	return getRelease('stable', fetchRelease);
}
