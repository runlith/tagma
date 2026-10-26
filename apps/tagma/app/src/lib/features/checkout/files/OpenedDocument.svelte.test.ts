// @vitest-environment jsdom
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { makeStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AutoSavePolicy } from './AutoSave.svelte.js';
import { Drafts } from './Drafts.svelte.js';
import { Gone } from './Gone.svelte.js';
import { OpenedDocument } from './OpenedDocument.svelte.js';
import { Differ } from './Differ.js';
import type { LineEdit } from './lineDiff.js';
import { inProcessDiffer, ServerDouble } from './serverDouble.js';

const ROOT = 'root-1' as RootId;
const SECOND = 1000;
const AFTER_DELAY: AutoSavePolicy = { mode: 'afterDelay', delay: SECOND };

let opened: OpenedDocument | undefined;
let disposers: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  opened?.close();
  opened = undefined;
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

type Standing = { policy?: () => AutoSavePolicy; drafts?: Drafts; gone?: Gone; differ?: Differ };

function open(server: ServerDouble, path = 'a.ts', standing: Standing = {}) {
  let document!: OpenedDocument;
  disposers.push(
    $effect.root(() => {
      document = new OpenedDocument(
        server.live as never,
        { perform: (id: string, input: Record<string, unknown>) => server.perform(id, input) } as never,
        { projectId: 1, rootId: ROOT },
        path,
        standing.policy ?? (() => AFTER_DELAY),
        { watch: () => ({ hands: () => [], release: () => undefined }) } as never,
        standing.drafts ?? new Drafts(makeStorage()),
        standing.gone ?? new Gone(),
        standing.differ ?? inProcessDiffer(),
      );
    }),
  );
  opened = document;
  const view = document.document?.mount(window.document.body.appendChild(window.document.createElement('div')), []);
  if (view === undefined) throw new Error('the document did not open');
  const type = (line: number, text: string): void => {
    const at = view.state.doc.line(line + 1).to;
    view.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });
  };
  return { document, view, type };
}

const text = (server: ServerDouble, path = 'a.ts'): string | undefined => server.files.get(path);

test('typing is written one second after the last edit, and the echo of that write leaves the buffer as typed', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { document, view, type } = open(server);

  type(0, ' x');
  await vi.advanceTimersByTimeAsync(SECOND - 1);
  type(0, 'y');
  await vi.advanceTimersByTimeAsync(SECOND - 1);
  expect(server.writes).toHaveLength(0);
  expect(document.saving.kind).toBe('pending');

  await vi.advanceTimersByTimeAsync(1);

  expect(text(server)).toBe('one xy\ntwo\nthree');
  expect(view.state.doc.toString()).toBe('one xy\ntwo\nthree');
  expect(document.document?.dirty).toBe(false);
  expect(document.document?.digest).toBe(server.digest('a.ts'));
  expect(document.saving.kind).toBe('idle');
});

test('what is typed while a save is out is saved by the next autosave', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { document, type } = open(server);
  const answer = Promise.withResolvers<void>();
  const perform = server.perform;
  server.perform = async (id, input) => {
    const outcome = await perform(id, input);
    await answer.promise;
    return outcome;
  };

  type(0, ' first');
  await vi.advanceTimersByTimeAsync(SECOND);
  expect(document.saving.kind).toBe('writing');
  type(2, ' second');
  answer.resolve();
  await vi.advanceTimersByTimeAsync(SECOND);

  expect(text(server)).toBe('one first\ntwo\nthree second');
  expect(document.saving.kind).toBe('idle');
});

test('a save over a disk that moved is answered moved, waits for the document frame, rebases and lands next to the agent lines', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { document, view, type } = open(server);
  const deliver = server.holdFrames('a.ts');

  server.external('a.ts', [{ from: 2, to: 3, lines: ['THREE'] }]);
  type(0, ' mine');
  await vi.advanceTimersByTimeAsync(SECOND);

  expect(server.writes).toHaveLength(1);
  expect(text(server)).toBe('one\ntwo\nTHREE');
  expect(document.saving.kind).toBe('pending');

  deliver();
  await vi.advanceTimersByTimeAsync(0);

  expect(view.state.doc.toString()).toBe('one mine\ntwo\nTHREE');
  expect(text(server)).toBe('one mine\ntwo\nTHREE');
  expect(server.writes).toHaveLength(2);
  expect(document.saving.kind).toBe('idle');
});

test('an agent edit of a clean buffer lands without a write', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo' });
  const { document, view } = open(server);

  server.external('a.ts', [{ from: 1, to: 2, lines: ['2'] }]);
  await vi.advanceTimersByTimeAsync(SECOND * 2);

  expect(view.state.doc.toString()).toBe('one\n2');
  expect(document.document?.dirty).toBe(false);
  expect(server.writes).toHaveLength(0);
});

test('an edit of the very lines being typed pauses autosave as a conflict; keeping mine writes over the new disk', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { document, view, type } = open(server);

  type(1, ' mine');
  server.external('a.ts', [{ from: 1, to: 2, lines: ['theirs'] }]);
  expect(document.saving.kind).toBe('conflict');
  expect(document.disk?.read()).toBe('one\ntheirs\nthree');

  await vi.advanceTimersByTimeAsync(SECOND * 3);
  expect(server.writes).toHaveLength(0);
  expect(view.state.doc.toString()).toBe('one\ntwo mine\nthree');

  void document.keepMine();
  await vi.advanceTimersByTimeAsync(0);

  expect(text(server)).toBe('one\ntwo mine\nthree');
  expect(document.saving.kind).toBe('idle');
});

test('taking the disk replaces the buffer, and the undo it hands back brings the typed lines back once', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { document, view, type } = open(server);

  type(1, ' mine');
  server.external('a.ts', [{ from: 1, to: 2, lines: ['theirs'] }]);
  const undo = await document.takeDisk();

  expect(view.state.doc.toString()).toBe('one\ntheirs\nthree');
  expect(document.saving.kind).toBe('idle');
  expect(document.document?.dirty).toBe(false);

  undo?.();
  undo?.();
  expect(view.state.doc.toString()).toBe('one\ntwo mine\nthree');
  expect(document.document?.dirty).toBe(true);
});

test('a file deleted on disk keeps its buffer; blur does not write it back, typing again creates it', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo' });
  const { document, type } = open(server);
  type(0, '!');

  await server.perform('trash_entries', { paths: ['a.ts'] });
  await document.leave('focus');
  await vi.advanceTimersByTimeAsync(SECOND * 2);
  expect(document.deleted).toBe(true);
  expect(server.writes).toHaveLength(0);

  type(0, '?');
  await vi.advanceTimersByTimeAsync(SECOND);

  expect(text(server)).toBe('one!?\ntwo');
  expect(document.deleted).toBe(false);
  expect(document.saving.kind).toBe('idle');
});

test('a refusal leaves the buffer dirty with its reason, and the next edit tries again', async () => {
  const server = new ServerDouble({ 'a.ts': 'one' });
  const { document, type } = open(server);
  const { perform } = server;
  server.perform = () => Promise.reject(Object.assign(new Error('disk full'), { code: 'file-write-failed', reason: 'disk full' }));

  type(0, '1');
  await vi.advanceTimersByTimeAsync(SECOND);
  expect(document.saving).toEqual({ kind: 'refused', reason: 'disk full' });
  expect(document.document?.dirty).toBe(true);

  server.perform = perform;
  type(0, '2');
  await vi.advanceTimersByTimeAsync(SECOND);

  expect(text(server)).toBe('one12');
  expect(document.saving.kind).toBe('idle');
});

test('a buffer with unwritten lines survives the file turning binary, and the refusal says why', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo' });
  const { document, view, type } = open(server);
  type(0, '!');

  server.send('a.ts', { kind: 'binary', size: 9 });

  expect(view.state.doc.toString()).toBe('one!\ntwo');
  expect(document.document?.dirty).toBe(true);
  expect(document.saving.kind).toBe('refused');
});

test('autosave off writes only on the command, and a switch to a delay takes the buffer that was already dirty', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo' });
  let policy = $state<AutoSavePolicy>({ mode: 'off', delay: SECOND });
  const { document, type } = open(server, 'a.ts', { policy: () => policy });

  type(0, '1');
  await document.leave('focus');
  await document.leave('hide');
  await vi.advanceTimersByTimeAsync(SECOND * 3);
  expect(server.writes).toHaveLength(0);

  policy = { mode: 'afterDelay', delay: SECOND };
  flushSync();
  await vi.advanceTimersByTimeAsync(SECOND);

  expect(text(server)).toBe('one1\ntwo');

  policy = { mode: 'off', delay: SECOND };
  flushSync();
  type(0, '2');
  await document.flush();
  expect(text(server)).toBe('one12\ntwo');
});

test('a draft is kept after the typing pause and brings the buffer back on reopening: dirty when the disk is as it was, a conflict when it moved', async () => {
  const drafts = new Drafts(makeStorage());
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const off = (): AutoSavePolicy => ({ mode: 'off', delay: SECOND });
  const first = open(server, 'a.ts', { policy: off, drafts });
  first.type(1, ' mine');
  await vi.advanceTimersByTimeAsync(2000);
  first.document.close();

  const same = open(server, 'a.ts', { policy: off, drafts });
  expect(same.view.state.doc.toString()).toBe('one\ntwo mine\nthree');
  expect(same.document.document?.dirty).toBe(true);
  expect(same.document.saving.kind).toBe('idle');
  same.document.close();

  server.external('a.ts', [{ from: 0, to: 1, lines: ['ONE'] }]);
  const moved = open(server, 'a.ts', { policy: off, drafts });
  await vi.advanceTimersByTimeAsync(0);
  expect(moved.document.saving.kind).toBe('conflict');
  expect(moved.view.state.doc.toString()).toBe('one\ntwo mine\nthree');

  void moved.document.keepMine();
  await vi.advanceTimersByTimeAsync(0);
  expect(text(server)).toBe('one\ntwo mine\nthree');
  expect(drafts.has('1\u0000root-1\u0000a.ts')).toBe(false);
});

function stalled() {
  const calls: { before: string; after: string; answer(edits: readonly LineEdit[]): void }[] = [];
  const differ = new Differ(
    (before, after) =>
      new Promise((resolve) => {
        calls.push({ before, after, answer: resolve });
      }),
  );
  return { differ, calls };
}

test('frames that arrive while a whole text is being diffed apply after it, in order', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo\nthree' });
  const { differ, calls } = stalled();
  const { document, view } = open(server, 'a.ts', { differ });

  server.files.set('a.ts', 'one\nTWO\nthree');
  server.send('a.ts', { kind: 'whole', digest: 'd:2', text: 'one\nTWO\nthree', readOnly: null, size: 13 });
  server.send('a.ts', { kind: 'change', digest: 'd:3', edits: [{ from: 2, to: 3, lines: ['THREE'] }] });
  expect(view.state.doc.toString()).toBe('one\ntwo\nthree');

  calls[0]?.answer([{ from: 1, to: 2, lines: ['TWO'] }]);
  await vi.advanceTimersByTimeAsync(0);

  expect(view.state.doc.toString()).toBe('one\nTWO\nTHREE');
  expect(document.document?.digest).toBe('d:3');
});

test('a diff answered after the subscription restarted is dropped, and the text the new subscription brings is diffed afresh', async () => {
  const server = new ServerDouble({ 'a.ts': 'one\ntwo' });
  const { differ, calls } = stalled();
  const { document, view } = open(server, 'a.ts', { differ });

  server.send('a.ts', { kind: 'whole', digest: 'd:x', text: 'one\nSTALE', readOnly: null, size: 9 });
  document.resync();
  calls[0]?.answer([{ from: 1, to: 2, lines: ['BOGUS'] }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.state.doc.toString()).toBe('one\ntwo');

  server.send('a.ts', { kind: 'whole', digest: 'd:y', text: 'one\n2', readOnly: null, size: 5 });
  await vi.advanceTimersByTimeAsync(0);
  calls.at(-1)?.answer([{ from: 1, to: 2, lines: ['2'] }]);
  await vi.advanceTimersByTimeAsync(0);

  expect(view.state.doc.toString()).toBe('one\n2');
});
