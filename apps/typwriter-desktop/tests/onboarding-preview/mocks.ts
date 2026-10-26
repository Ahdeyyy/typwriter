import { errAsync, okAsync } from 'neverthrow';
import type { AppSettings } from '../../src/lib/ipc/commands';
import type { SettingsSyncPayload } from '../../src/lib/stores/settings.svelte';

const step = { id: 'welcome', title: 'Welcome to Typst', blurb: 'The tutorial is ready.', example: '= Welcome' };
export const onboarding = {
    ready: false,
    stepIndex: 0,
    steps: [step],
    current: step,
    activeContent: step.example,
    seedVersion: 0,
    isFirst: true,
    isLast: true,
    shouldAutoShow: () => okAsync(!new URLSearchParams(location.search).has('completed')),
    enter: () => { onboarding.ready = true; return okAsync(undefined); },
    skip: () => { onboarding.ready = false; return okAsync(undefined); },
    finish: () => okAsync(undefined),
    next() {}, prev() {}, resetExample() {}, goTo(_index: number) {}, handleContentChange(_text: string) {},
};
export const preview = { init: async () => {}, destroy() {} };
export const getAppSettings = () => errAsync('Native settings are unavailable in this fixture.');
export const setAppSettings = (_settings: AppSettings) => okAsync(undefined);
export const setTypstFontDirectories = (_directories: string[]) => okAsync(undefined);
export const emitSettingsChanged = (_payload: SettingsSyncPayload) => okAsync(undefined);
export const logError = console.error;
export const openUrl = async (_url: string) => {};
