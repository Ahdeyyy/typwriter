import type { PageServerLoad } from './$types';

// Prerendered: this load runs at build time, not per request. The download
// links are therefore only as fresh as the last site build — publishing a
// release does not update them on its own, since publish.yml ignores
// apps/typwriter-web/**. Trigger a site rebuild after a release, or the
// buttons keep pointing at the previous version's assets.
export const prerender = true;

interface ReleaseAsset {
	name: string;
	browser_download_url: string;
	size: number;
}

interface Release {
	tag_name: string;
	name: string;
	html_url: string;
	assets: ReleaseAsset[];
}

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const res = await fetch('https://api.github.com/repos/Ahdeyyy/typwriter/releases/latest', {
			headers: { Accept: 'application/vnd.github+json' }
		});
		if (!res.ok) return { release: null };
		const release: Release = await res.json();
		return { release };
	} catch {
		return { release: null };
	}
};
