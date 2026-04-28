export type Platform = 'macos' | 'windows' | 'linux';

export function detectPlatform(): Platform {
    if (typeof navigator === 'undefined') return 'linux';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('win')) return 'windows';
    return 'linux';
}

export const platform: Platform = detectPlatform();
