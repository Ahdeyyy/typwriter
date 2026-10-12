import type { ResultAsync } from 'neverthrow';
import type { UnlistenFn } from './events';

/** Own registrations as well as registered listeners. Native registration can
 * finish after its component has unmounted, so returning cleanup alone is not
 * enough: callbacks and late registration results also need lifetime checks. */
export class ListenerScope {
    private active = true;
    private listeners = new Set<UnlistenFn>();

    listen<T>(
        subscribe: (handler: (payload: T) => void) => ResultAsync<UnlistenFn, string>,
        handler: (payload: T) => void,
        onError: (error: string) => void,
    ): void {
        if (!this.active) return;
        void subscribe((payload) => {
            if (this.active) handler(payload);
        }).match((unlisten) => {
            if (this.active) this.listeners.add(unlisten);
            else unlisten();
        }, onError);
    }

    destroy(): void {
        this.active = false;
        for (const unlisten of this.listeners) unlisten();
        this.listeners.clear();
    }
}
