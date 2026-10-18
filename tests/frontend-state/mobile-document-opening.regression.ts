import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { okAsync, ResultAsync } from "../../apps/typwriter-mobile/node_modules/neverthrow";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve, result: ResultAsync.fromPromise(promise, String) };
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const takeOpenFiles = mock(() => okAsync<string[], string>([]));
const pickDocument = mock(() => okAsync<string | null, string>(null));
const openDocument = mock((_uri: string) => okAsync<void, string>(undefined));
const init = mock(() => Promise.resolve());
const toastError = mock((_message: string) => {});
let handler: () => void = () => {};
const release = mock(() => {});
const onOpenFiles = mock((callback: () => void) => {
  handler = callback;
  return okAsync<() => void, string>(release);
});
const surface = Object.assign(new EventTarget(), { visibilityState: "visible" });
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", { value: surface, configurable: true });

mock.module("$lib/ipc/commands", () => ({ takeOpenFiles, pickDocument }));
mock.module("$lib/ipc/events", () => ({ onOpenFiles }));
mock.module("$lib/stores/workspace.svelte", () => ({ workspace: { openDocument } }));
mock.module("$lib/stores/settings.svelte", () => ({ settings: { init } }));
mock.module("svelte-sonner", () => ({ toast: { error: toastError } }));

const { startDocumentOpening, pickDocument: pick } = await import("../../apps/typwriter-mobile/src/lib/document-opening");
let owner: ReturnType<typeof startDocumentOpening> | null = null;

beforeEach(() => {
  for (const fn of [takeOpenFiles, pickDocument, openDocument, init, toastError, release, onOpenFiles]) fn.mockClear();
});
afterEach(() => { owner?.destroy(); owner = null; });
afterAll(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

test("cold-start requests wait for settings and subscribe before draining", async () => {
  const hydration = deferred<void>();
  init.mockImplementationOnce(() => hydration.promise);
  takeOpenFiles.mockImplementationOnce(() => okAsync(["content://provider/cold.typ"]));
  owner = startDocumentOpening();
  await tick();
  expect(onOpenFiles).toHaveBeenCalledTimes(1);
  expect(takeOpenFiles).not.toHaveBeenCalled();
  hydration.resolve();
  await owner.ready;
  expect(openDocument).toHaveBeenCalledWith("content://provider/cold.typ");
});

test("warm requests delivered during a drain are opened serially", async () => {
  owner = startDocumentOpening();
  await owner.ready;
  const opening = deferred<void>();
  openDocument.mockImplementationOnce(() => opening.result);
  takeOpenFiles.mockImplementationOnce(() => okAsync(["content://provider/first.typ"]));
  handler();
  await tick();
  takeOpenFiles.mockImplementationOnce(() => okAsync(["content://provider/second.typ"]));
  handler();
  await tick();
  expect(openDocument).toHaveBeenCalledTimes(1);
  opening.resolve();
  await tick();
  expect(openDocument.mock.calls).toEqual([["content://provider/first.typ"], ["content://provider/second.typ"]]);
});

test("teardown releases a late event subscription without draining files", async () => {
  const registration = deferred<() => void>();
  onOpenFiles.mockImplementationOnce(() => registration.result);
  owner = startDocumentOpening();
  owner.destroy();
  registration.resolve(release);
  await owner.ready;
  expect(release).toHaveBeenCalledTimes(1);
  expect(takeOpenFiles).not.toHaveBeenCalled();
  surface.dispatchEvent(new Event("visibilitychange"));
  await tick();
  expect(takeOpenFiles).not.toHaveBeenCalled();
});

test("canceling the picker leaves the current session intact", async () => {
  await pick();
  expect(openDocument).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});
