import { describe, expect, it } from 'bun:test';
import { workspaceLocation } from './paths';

describe('workspaceLocation', () => {
    it('shows the parent folder relative to home', () => {
        expect(workspaceLocation('/home/aleks/Projects/2024/thesis', '/home/aleks')).toBe('~/Projects/2024');
        expect(workspaceLocation(String.raw`C:\Users\me\Code Repository\typwriter`, String.raw`C:\Users\me`))
            .toBe('~/Code Repository');
    });

    it('ignores a trailing separator', () => {
        expect(workspaceLocation('/home/aleks/Projects/thesis/', '/home/aleks')).toBe('~/Projects');
    });

    it('shows ~ for a workspace directly in home', () => {
        expect(workspaceLocation('/home/aleks/notes', '/home/aleks')).toBe('~');
        expect(workspaceLocation('C:/Users/Me/notes', 'c:\\users\\me')).toBe('~');
    });

    it('keeps the full path outside home', () => {
        expect(workspaceLocation('/home/aleks-old/notes', '/home/aleks')).toBe('/home/aleks-old');
        expect(workspaceLocation('D:/Archive/2024/notes', 'C:/Users/me')).toBe('D:/Archive/2024');
    });

    it('shows the drive or filesystem root', () => {
        expect(workspaceLocation('D:/notes', null)).toBe('D:');
        expect(workspaceLocation('/notes', null)).toBe('/');
    });

    it('falls back to the full path before home is known', () => {
        expect(workspaceLocation('/home/aleks/notes', null)).toBe('/home/aleks');
    });
});
