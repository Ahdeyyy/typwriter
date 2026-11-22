import { describe, expect, it } from 'vitest';
import { detectPlatform, groupAssets } from './platforms';

function asset(name: string) {
	return { name, browser_download_url: `https://example.com/${name}`, size: 1 };
}

describe('detectPlatform', () => {
	it.each([
		['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'windows'],
		['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15', 'macos'],
		['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'linux'],
		['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 'android'],
		['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', null],
		['curl/8.0', null]
	])('%s → %s', (ua, expected) => {
		expect(detectPlatform(ua)).toBe(expected);
	});
});

describe('groupAssets', () => {
	it('groups files by platform and puts the recommended file first', () => {
		const groups = groupAssets(
			[
				'Typwriter_1.0.0_x64.dmg',
				'Typwriter_1.0.0_aarch64.dmg',
				'Typwriter_1.0.0_amd64.deb',
				'Typwriter_1.0.0_amd64.AppImage',
				'Typwriter_1.0.0_x86_64.apk',
				'Typwriter_1.0.0_arm.apk',
				'Typwriter_1.0.0_arm64.apk',
				'Typwriter_1.0.0_x64-setup.exe',
				'latest.json'
			].map(asset)
		);
		expect(groups.windows.map((a) => a.name)).toEqual(['Typwriter_1.0.0_x64-setup.exe']);
		expect(groups.macos[0].name).toBe('Typwriter_1.0.0_aarch64.dmg');
		expect(groups.linux[0].name).toBe('Typwriter_1.0.0_amd64.AppImage');
		expect(groups.android.map((a) => a.name)).toEqual([
			'Typwriter_1.0.0_arm64.apk',
			'Typwriter_1.0.0_arm.apk',
			'Typwriter_1.0.0_x86_64.apk'
		]);
	});
});
