import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { err, ok, ResultAsync } from 'neverthrow';
import * as events from '@tauri-apps/api/event';
import * as commands from '$lib/ipc/commands';
import * as logger from '$lib/logger';
import { createTauriLspTransport } from './transport';

afterEach(() => mock.restore());

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

async function setup() {
    const unlisten = mock(() => {});
    let receive!: (event: events.Event<string>) => void;
    spyOn(events, 'listen').mockImplementation(async (_name, handler) => {
        receive = handler as typeof receive;
        return unlisten;
    });
    const transport = await createTauriLspTransport();
    return { transport, unlisten, receive };
}

describe('Tauri LSP transport', () => {
    it('finishes document updates before sending dependent queries', async () => {
        const gate = deferred();
        const done = deferred();
        const sent: string[] = [];
        spyOn(commands, 'lspSend').mockImplementation((message) => {
            sent.push(message);
            if (message === 'didChange') {
                return commandsResult(gate.promise);
            }
            done.resolve();
            return commandsResult(Promise.resolve());
        });
        const { transport } = await setup();
        transport.send('didChange');
        transport.send('completion');
        await Promise.resolve();
        expect(sent).toEqual(['didChange']);
        gate.resolve();
        await done.promise;
        expect(sent).toEqual(['didChange', 'completion']);
        transport.dispose();
    });

    it('keeps the queue usable after an IPC error or rejection', async () => {
        const done = deferred();
        const log = spyOn(logger, 'logError').mockImplementation(() => {});
        const sent: string[] = [];
        spyOn(commands, 'lspSend').mockImplementation((message) => {
            sent.push(message);
            if (message === 'error') return commandsResult(Promise.resolve(), 'failed');
            if (message === 'throw') throw new Error('unexpected');
            done.resolve();
            return commandsResult(Promise.resolve());
        });
        const { transport } = await setup();
        for (const message of ['error', 'throw', 'completion']) transport.send(message);
        await done.promise;
        expect(sent).toEqual(['error', 'throw', 'completion']);
        expect(log).toHaveBeenCalledTimes(2);
        transport.dispose();
    });

    it('drops queued messages and handlers when the session is disposed', async () => {
        const gate = deferred();
        const sent: string[] = [];
        spyOn(commands, 'lspSend').mockImplementation((message) => {
            sent.push(message);
            return commandsResult(gate.promise);
        });
        const { transport, unlisten, receive } = await setup();
        const handler = mock(() => {});
        transport.subscribe(handler);
        receive({ payload: 'before dispose' } as events.Event<string>);
        transport.send('didChange');
        transport.send('old completion');
        await Promise.resolve();
        transport.dispose();
        transport.dispose();
        transport.send('after dispose');
        gate.resolve();
        // Allow the in-flight IPC and all queued microtasks to settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
        receive({ payload: 'after dispose' } as events.Event<string>);
        expect(sent).toEqual(['didChange']);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('delivers messages to subscribed handlers only', async () => {
        const { transport, receive } = await setup();
        const handler = mock(() => {});
        transport.subscribe(handler);
        receive({ payload: 'first' } as events.Event<string>);
        transport.unsubscribe(handler);
        receive({ payload: 'second' } as events.Event<string>);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('first');
        transport.dispose();
    });
});

// Match the IPC wrapper's ResultAsync contract without invoking Tauri.
function commandsResult(promise: Promise<void>, error?: string): ResultAsync<void, string> {
    return new ResultAsync(promise.then(() => error ? err(error) : ok(undefined)));
}
