// @vitest-environment jsdom
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { makeStorage } from '@runlith/layer/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AutoSavePolicy } from './AutoSave.svelte.js';
import { Documents } from './Documents.svelte.js';
import { Drafts } from './Drafts.svelte.js';
import { inProcessDiffer, ServerDouble } from './serverDouble.js';

const PLACE = { projectId: 1, rootId: 'root-1' as RootId };
const POLICY: AutoSavePolicy = { mode: 'afterDelay', delay: 1000 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function standing(server = new ServerDouble({ 'a.md': 'one\ntwo' })) {
  let opened = 0;
  let ended = 0;
  const live = {
    hold: (...args: Parameters<typeof server.live.hold>) => {
      opened += 1;
      const held = server.live.hold(...args);
      return {
        unsubscribe: () => {
          ended += 1;
          held.unsubscribe();
        },
      };
    },
  };
  const documents = new Documents(
    live as never,
    { perform: (id: string, input: Record<string, unknown>) => server.perform(id, input) } as never,
    { policyOf: () => POLICY } as never,
    new Drafts(makeStorage()),
    inProcessDiffer(),
    { defer: () => undefined } as never,
  );
  return { documents, server, counts: () => ({ opened, ended }) };
}

test('a file shown by two tabs is one subscription and one document, and it ends with the last tab', () => {
  const { documents, counts } = standing();

  const source = documents.hold(PLACE, 'a.md');
  const preview = documents.hold(PLACE, 'a.md');
  expect(preview.document).toBe(source.document);
  expect(counts().opened).toBe(1);

  source.release();
  expect(counts().ended).toBe(0);
  preview.release();
  preview.release();
  expect(counts().ended).toBe(1);

  documents.hold(PLACE, 'a.md');
  expect(counts().opened).toBe(2);
});

test('a document with unwritten lines outlives its last tab until the write lands', async () => {
  const { documents, server, counts } = standing();
  const held = documents.hold(PLACE, 'a.md');
  const view = held.document.document?.mount(document.body.appendChild(document.createElement('div')), []);
  view?.dispatch({ changes: { from: 3, insert: '!' }, userEvent: 'input.type' });

  held.release();
  expect(documents.get(PLACE, 'a.md')).toBe(held.document);
  expect(documents.mark(PLACE, 'a.md')).toBe('pending');
  expect(counts().ended).toBe(0);

  await vi.advanceTimersByTimeAsync(1000);

  expect(server.files.get('a.md')).toBe('one!\ntwo');
  expect(documents.get(PLACE, 'a.md')).toBeUndefined();
  expect(counts().ended).toBe(1);
});

test('discarding the buffer of a file two views show keeps the document and clears the unsaved mark', () => {
  const { documents } = standing();
  const one = documents.hold(PLACE, 'a.md');
  const two = documents.hold(PLACE, 'a.md');
  const view = one.document.document?.mount(document.body.appendChild(document.createElement('div')), []);
  view?.dispatch({ changes: { from: 3, insert: '!' }, userEvent: 'input.type' });
  expect(documents.mark(PLACE, 'a.md')).toBe('pending');

  documents.discard(PLACE, 'a.md');

  expect(documents.mark(PLACE, 'a.md')).toBeNull();
  expect(documents.get(PLACE, 'a.md')).toBe(two.document);
  expect(two.document.text()).toBe('one\ntwo');
});

test('a path moved on disk takes its open document along, and a directory takes the ones inside it', () => {
  const { documents, server } = standing(new ServerDouble({ 'src/a.ts': 'a', 'src/deep/b.ts': 'b' }));
  const seen: string[] = [];
  documents.onRelocated((_place, from, to) => seen.push(`${from}>${to}`));
  const a = documents.hold(PLACE, 'src/a.ts');
  const b = documents.hold(PLACE, 'src/deep/b.ts');

  documents.relocate(PLACE, [{ from: 'src', to: 'lib' }]);

  expect(a.document.path).toBe('lib/a.ts');
  expect(b.document.path).toBe('lib/deep/b.ts');
  expect(documents.get(PLACE, 'lib/deep/b.ts')).toBe(b.document);
  expect(seen.sort()).toEqual(['src/a.ts>lib/a.ts', 'src/deep/b.ts>lib/deep/b.ts']);
  expect(server.files.size).toBe(2);
});
