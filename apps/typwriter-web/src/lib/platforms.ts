export interface Asset {
	name: string;
	browser_download_url: string;
	size: number;
}

export type Platform = 'windows' | 'macos' | 'linux' | 'android';

export const PLATFORMS: Platform[] = ['windows', 'macos', 'linux', 'android'];

export const PLATFORM_NAMES: Record<Platform, string> = {
	windows: 'Windows',
	macos: 'macOS',
	linux: 'Linux',
	android: 'Android'
};

// iOS has no build, and its user agents mention "Mac OS X", so it returns null
// instead of being mistaken for macOS.
export function detectPlatform(userAgent: string): Platform | null {
	const ua = userAgent.toLowerCase();
	if (ua.includes('android')) return 'android';
	if (/iphone|ipad|ipod/.test(ua)) return null;
	if (ua.includes('windows')) return 'windows';
	if (ua.includes('mac')) return 'macos';
	if (ua.includes('linux') || ua.includes('x11') || ua.includes('cros')) return 'linux';
	return null;
}

const APK_ABI_ORDER = ['arm64', 'arm', 'x86_64', 'x86'];

function apkRank(name: string): number {
	const index = APK_ABI_ORDER.findIndex((abi) => name.endsWith(`_${abi}.apk`));
	return index < 0 ? APK_ABI_ORDER.length : index;
}

function platformOf(name: string): Platform | null {
	if (name.endsWith('.exe') || name.endsWith('.msi')) return 'windows';
	if (name.endsWith('.dmg')) return 'macos';
	if (name.endsWith('.deb') || name.endsWith('.rpm') || name.endsWith('.AppImage')) return 'linux';
	if (name.endsWith('.apk')) return 'android';
	return null;
}

/** Installable files per platform, with the recommended one first. */
export function groupAssets(assets: Asset[]): Record<Platform, Asset[]> {
	const groups: Record<Platform, Asset[]> = { windows: [], macos: [], linux: [], android: [] };
	for (const asset of assets) {
		const platform = platformOf(asset.name);
		if (platform) groups[platform].push(asset);
	}
	// Apple Silicon and AppImage are the safest defaults when the exact machine is unknown.
	groups.macos.sort((a, b) => Number(b.name.includes('aarch64')) - Number(a.name.includes('aarch64')));
	groups.linux.sort(
		(a, b) => Number(b.name.endsWith('.AppImage')) - Number(a.name.endsWith('.AppImage'))
	);
	groups.android.sort((a, b) => apkRank(a.name) - apkRank(b.name));
	return groups;
}

export function assetLabel(name: string): string {
	if (name.endsWith('.exe')) return 'Installer (.exe)';
	if (name.endsWith('.msi')) return 'MSI package (.msi)';
	if (name.includes('aarch64') && name.endsWith('.dmg')) return 'Apple Silicon (.dmg)';
	if (name.includes('x64') && name.endsWith('.dmg')) return 'Intel (.dmg)';
	if (name.endsWith('.deb')) return 'Debian / Ubuntu (.deb)';
	if (name.endsWith('.rpm')) return 'Fedora / RHEL (.rpm)';
	if (name.endsWith('.AppImage')) return 'AppImage';
	if (name.endsWith('_arm64.apk')) return 'ARM64 (most phones)';
	if (name.endsWith('_arm.apk')) return 'ARMv7 (older phones)';
	if (name.endsWith('_x86_64.apk')) return 'x86_64';
	if (name.endsWith('_x86.apk')) return 'x86';
	if (name.endsWith('.apk')) return 'APK';
	return name;
}

export function formatSize(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
