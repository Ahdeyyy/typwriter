/**
 * Serializes asynchronous tasks so they run one at a time in submission order.
 *
 * Used for store operations (e.g. workspace init / leave) where overlapping
 * runs would corrupt state. A rejected task still advances the queue, but its
 * rejection is surfaced to its own caller.
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
