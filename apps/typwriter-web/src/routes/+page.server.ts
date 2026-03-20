import type { PageServerLoad } from './$types';

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
