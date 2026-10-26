import { getContext, setContext } from 'svelte';

const settingControl = Symbol('setting-control');

interface SettingControl {
    readonly 'aria-labelledby': string;
    readonly 'aria-describedby': string | undefined;
}

export function setSettingControl(value: SettingControl): void {
    setContext(settingControl, value);
}

export function getSettingControl(): SettingControl | undefined {
    return getContext<SettingControl | undefined>(settingControl);
}
