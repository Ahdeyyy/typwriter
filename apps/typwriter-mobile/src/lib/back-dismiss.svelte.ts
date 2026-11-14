// Ties a dialog, drawer, or menu to the Android back gesture: while it is open,
// back closes it instead of leaving the screen. See the layer notes in
// `stores/app.svelte.ts`.

import { untrack } from "svelte";
import { app } from "$lib/stores/app.svelte";

/** Call during component initialisation. `close` must make `isOpen` false. */
export function dismissOnBack(isOpen: () => boolean, close: () => void) {
  $effect(() => {
    if (!isOpen()) return;
    // The release runs when the modal closes by any other route, or unmounts.
    return untrack(() => app.pushLayer(close));
  });
}
