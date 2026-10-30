import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestRelease } from './releases';

const CACHE_KEY = 'typwriter:latest-release:v1';
const HOUR = 60 * 60 * 1000;
const fetchRelease = vi.fn<typeof fetch>();
const entries = new Map<string, string>();
const storage = {
	getItem: vi.fn((key: string) => entries.get(key) ?? null),
	setItem: vi.fn((key: string, value: string) => {
		entries.set(key, value);
	})
};

function release(version: string) {
	return {
		tag_name: `typwriter-v${version}`,
		name: `Typwriter ${version}`,
		html_url: `https://github.com/Ahdeyyy/typwriter/releases/tag/typwriter-v${version}`,
		assets: [
			{
				name: `Typwriter_${version}_x64-setup.exe`,
				browser_download_url: `https://github.com/Ahdeyyy/typwriter/releases/download/typwriter-v${version}/Typwriter_${version}_x64-setup.exe`,
				size: 100
			}
		]
	};
}

beforeEach(() => {
	entries.clear();
	fetchRelease.mockReset();
	storage.getItem.mockClear();
	storage.setItem.mockReset().mockImplementation((key, value) => {
		entries.set(key, value);
	});
	vi.stubGlobal('localStorage', storage);
	vi.spyOn(Date, 'now').mockReturnValue(10000000);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('latest release cache', () => {
	it('fetches once and reuses the persisted release and download links within an hour', async () => {
		const latest = release('0.9.3');
		fetchRelease.mockResolvedValueOnce(Response.json(latest));
		expect(await getLatestRelease(fetchRelease)).toEqual(latest);
		vi.mocked(Date.now).mockReturnValue(10000000 + HOUR - 1);
		expect(await getLatestRelease(fetchRelease)).toEqual(latest);
		expect(fetchRelease).toHaveBeenCalledTimes(1);
		expect(JSON.parse(entries.get(CACHE_KEY)!)).toEqual({ cachedAt: 10000000, release: latest });
	});

	it('replaces an expired release with the new version at the one-hour boundary', async () => {
		entries.set(
			CACHE_KEY,
			JSON.stringify({ cachedAt: 10000000 - HOUR, release: release('0.9.3') })
		);
		fetchRelease.mockResolvedValueOnce(Response.json(release('0.9.4')));
		expect(await getLatestRelease(fetchRelease)).toEqual(release('0.9.4'));
		expect(JSON.parse(entries.get(CACHE_KEY)!).release).toEqual(release('0.9.4'));
		expect(fetchRelease).toHaveBeenCalledWith(
			'https://api.github.com/repos/Ahdeyyy/typwriter/releases/latest',
			expect.objectContaining({ cache: 'no-cache', signal: expect.any(AbortSignal) })
		);
	});

	it.each([
		'not json',
		JSON.stringify({ cachedAt: 10000000, release: { tag_name: 'invalid' } }),
		JSON.stringify({ cachedAt: 10000001, release: release('0.9.3') })
	])('ignores malformed or future-dated cache data: %s', async (cached) => {
		entries.set(CACHE_KEY, cached);
		fetchRelease.mockResolvedValueOnce(Response.json(release('0.9.4')));
		expect(await getLatestRelease(fetchRelease)).toEqual(release('0.9.4'));
		expect(fetchRelease).toHaveBeenCalledTimes(1);
	});

	it('works when browser storage is unavailable', async () => {
		vi.stubGlobal('localStorage', undefined);
		fetchRelease.mockResolvedValueOnce(Response.json(release('0.9.4')));
		expect(await getLatestRelease(fetchRelease)).toEqual(release('0.9.4'));
	});

	it('returns a successful lookup even when the cache cannot be written', async () => {
		storage.setItem.mockImplementation(() => {
			throw new Error('Quota exceeded');
		});
		fetchRelease.mockResolvedValueOnce(Response.json(release('0.9.4')));
		expect(await getLatestRelease(fetchRelease)).toEqual(release('0.9.4'));
	});

	it('does not serve expired downloads or extend the cache on a rate limit', async () => {
		const expired = JSON.stringify({ cachedAt: 10000000 - HOUR, release: release('0.9.3') });
		entries.set(CACHE_KEY, expired);
		fetchRelease.mockResolvedValueOnce(new Response(null, { status: 403 }));
		expect(await getLatestRelease(fetchRelease)).toBeNull();
		expect(entries.get(CACHE_KEY)).toBe(expired);
	});

	it('falls back when the network fails or times out', async () => {
		fetchRelease.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
		expect(await getLatestRelease(fetchRelease)).toBeNull();
	});

	it('does not cache an invalid API response', async () => {
		fetchRelease.mockResolvedValueOnce(Response.json({ message: 'Invalid response' }));
		expect(await getLatestRelease(fetchRelease)).toBeNull();
		expect(storage.setItem).not.toHaveBeenCalled();
	});
});
