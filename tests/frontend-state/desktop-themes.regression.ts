import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { errAsync, okAsync, ResultAsync } from '../../apps/typwriter-desktop/node_modules/neverthrow';
import type { AppSettings } from '../../apps/typwriter-desktop/src/lib/ipc/commands';
import type { SettingsSyncPayload } from '../../apps/typwriter-desktop/src/lib/stores/settings.svelte';

const storage = new Map<string, string>([
  ['typwriter:settings:v1', JSON.stringify({ theme: 'nord' })],
]);
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

const setAppSettings = mock((_settings: AppSettings) => okAsync());
const getAppSettings = mock((): ResultAsync<AppSettings, string> => errAsync('Backend unavailable'));
const emitSettingsChanged = mock((_payload: SettingsSyncPayload) => okAsync());
mock.module('$lib/ipc/commands', () => ({
  getAppSettings,
  setAppSettings,
  setTypstFontDirectories: () => okAsync(),
}));
mock.module('$lib/ipc/events', () => ({ emitSettingsChanged }));
mock.module('$lib/logger', () => ({ logError: () => {} }));

const { settings } = await import('../../apps/typwriter-desktop/src/lib/stores/settings.svelte');

afterEach(() => {
  settings.resetToDefaults();
  setAppSettings.mockClear();
  emitSettingsChanged.mockClear();
});

describe('desktop per-mode themes', () => {
  test('hydrates an existing shared palette into both modes', () => {
    expect(settings.lightTheme).toBe('nord');
    expect(settings.darkTheme).toBe('nord');
  });

  test('individual selections preserve the other mode and persist together', () => {
    settings.setTheme('nord', 'light');
    settings.setTheme('gruvbox', 'dark');
    expect(settings.lightTheme).toBe('nord');
    expect(settings.darkTheme).toBe('gruvbox');

    const saved = JSON.parse(storage.get('typwriter:settings:v1')!);
    expect(saved.lightTheme).toBe('nord');
    expect(saved.darkTheme).toBe('gruvbox');
    expect(setAppSettings.mock.lastCall?.[0]).toMatchObject({
      light_theme: 'nord', dark_theme: 'gruvbox',
    });
    expect(emitSettingsChanged.mock.lastCall?.[0]).toMatchObject({
      lightTheme: 'nord', darkTheme: 'gruvbox',
    });

    settings.setTheme('dracula', 'light');
    expect(settings.darkTheme).toBe('gruvbox');
  });

  test('the whole-card action replaces both mode selections', () => {
    settings.setTheme('nord', 'light');
    settings.setTheme('gruvbox', 'dark');
    settings.setTheme('solarized');
    expect(settings.lightTheme).toBe('solarized');
    expect(settings.darkTheme).toBe('solarized');
  });

  test('other windows replay independent selections without rebroadcasting', () => {
    const payload = { ...JSON.parse(storage.get('typwriter:settings:v1')!),
      lightTheme: 'nord', darkTheme: 'gruvbox', fontDirectories: [],
    };
    settings.applyExternal(payload);
    expect(settings.lightTheme).toBe('nord');
    expect(settings.darkTheme).toBe('gruvbox');
    expect(emitSettingsChanged).not.toHaveBeenCalled();
    expect(setAppSettings).not.toHaveBeenCalled();
  });

  test('valid per-mode choices override legacy values and invalid choices fall back', () => {
    const payload = { theme: 'dracula', lightTheme: 'nord', darkTheme: 'invalid' };
    settings.applyExternal(payload as unknown as SettingsSyncPayload);
    expect(settings.lightTheme).toBe('nord');
    expect(settings.darkTheme).toBe('dracula');

    settings.applyExternal({ lightTheme: 'invalid', darkTheme: 'gruvbox' } as unknown as SettingsSyncPayload);
    expect(settings.lightTheme).toBe('default');
    expect(settings.darkTheme).toBe('gruvbox');
  });

  test('reset restores both modes', () => {
    settings.setTheme('nord', 'light');
    settings.setTheme('gruvbox', 'dark');
    settings.resetToDefaults();
    expect(settings.lightTheme).toBe('default');
    expect(settings.darkTheme).toBe('default');
  });

  test('skipping appearance restores its defaults and preserves accessibility and editing choices', () => {
    settings.setTheme('nord', 'light');
    settings.setTheme('gruvbox', 'dark');
    settings.setUiFontFamily('Inter Variable');
    settings.setScreenReaderMode(true);
    settings.setEditorFontSize(18);

    settings.resetAppearanceToDefaults();

    expect(settings.lightTheme).toBe('default');
    expect(settings.darkTheme).toBe('default');
    expect(settings.uiFontFamily).toBe('IBM Plex Sans Variable');
    expect(settings.screenReaderMode).toBe(true);
    expect(settings.screenReaderModeChosen).toBe(true);
    expect(settings.editorFontSize).toBe(18);
    expect(JSON.parse(storage.get('typwriter:settings:v1')!)).toMatchObject({
      lightTheme: 'default', darkTheme: 'default', uiFontFamily: 'IBM Plex Sans Variable',
      screenReaderMode: true, screenReaderModeChosen: true, editorFontSize: 18,
    });
    expect(emitSettingsChanged.mock.lastCall?.[0]).toMatchObject({
      lightTheme: 'default', darkTheme: 'default', uiFontFamily: 'IBM Plex Sans Variable',
    });
  });

  test('a delayed settings load preserves appearance choices made during setup', async () => {
    settings.resetToDefaults();
    const backend = setAppSettings.mock.lastCall![0];
    let resolve!: (value: AppSettings) => void;
    getAppSettings.mockReturnValueOnce(ResultAsync.fromSafePromise(
      new Promise<AppSettings>((done) => { resolve = done; }),
    ));
    const loading = settings.init();
    settings.setTheme('dracula', 'dark');
    settings.setTheme('solarized', 'light');
    settings.setUiFontFamily('Inter Variable');

    resolve(backend);
    expect((await loading).isOk()).toBe(true);
    expect(settings.darkTheme).toBe('dracula');
    expect(settings.lightTheme).toBe('solarized');
    expect(settings.uiFontFamily).toBe('Inter Variable');
  });
});

afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
