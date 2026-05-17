// async.ts
//
// Small async/concurrency primitives shared across stores. Keep these tiny
// and dependency-free — they're hot-path utilities.

/**
 * Serializes asynchronous tasks so they run one at a time in submission order.
 *
 * Used for store operations (e.g. workspace init / leave) where overlapping
 * runs would corrupt state — even if two callers fire concurrently, the
 * second won't start until the first settles (resolve OR reject). A rejected
 * task is swallowed for the purpose of advancing the queue, but its rejection
 * is still surfaced to its own caller.
 */
export class SerialQueue {
    private tail: Promise<void> = Promise.resolve();

    run<T>(task: () => Promise<T>): Promise<T> {
        const result = this.tail.then(task, task);
        this.tail = result.then(
            () => {},
            () => {},
        );
        return result;
    }
}
