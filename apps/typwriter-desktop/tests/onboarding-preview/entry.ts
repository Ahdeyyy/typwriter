import { mount } from 'svelte';
import '../recents-preview/preview.css';

const params = new URLSearchParams(location.search);
if (!params.has('resume')) {
    localStorage.removeItem('typwriter:settings:v1');
    if (params.has('enabled')) {
        localStorage.setItem('typwriter:settings:v1', JSON.stringify({ screenReaderMode: true }));
    }
}

// Import only after seeding storage: the real settings store hydrates at import.
const { default: Onboarding } = await import('../../src/lib/components/pages/onboarding.svelte');
mount(Onboarding, { target: document.getElementById('app')! });
