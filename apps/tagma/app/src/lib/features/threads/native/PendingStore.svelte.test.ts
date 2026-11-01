// @vitest-environment jsdom
import { Effect } from 'effect';
import { makeStorage } from '@runlith/layer/testing';
import { IDBFactory } from 'fake-indexeddb';
import { expect } from 'vitest';
import { waitFor } from '@runlith/testing/flush';
import { it } from '@runlith/effect-test/vitest';
import { DraftFiles } from './DraftFiles.js';
import { DraftShelf } from './DraftShelf.svelte.js';
import type { KeptAct, KeptTurn } from '@runlith/chat-ui/session/PendingTurns';
import { PendingStore } from './PendingStore.js';

type Granted = (lock: { name: string } | null) => unknown;

class PageLocks {
  readonly held: string[] = [];

  request(name: string, options: { ifAvailable?: boolean } | Granted, callback?: Granted): Promise<unknown> {
    const granted = typeof options === 'function' ? options : callback!;
    const ifAvailable = typeof options === 'function' ? false : options.ifAvailable === true;
    if (this.held.includes(name)) return Promise.resolve(ifAvailable ? granted(null) : new Promise(() => {}));
    this.held.push(name);
    return Promise.resolve(granted({ name })).finally(() => this.release(name));
  }

  query(): Promise<{ held: { name: string }[] }> {
    return Promise.resolve({ held: this.held.map((name) => ({ name })) });
  }

  release(name: string): void {
    const at = this.held.indexOf(name);
    if (at >= 0) this.held.splice(at, 1);
  }
}

it.live('a turn a live page holds is no other page’s; once that page is gone one page takes it, with its whole draft back', () =>
  Effect.gen(function* () {
    const storage = makeStorage();
    const files = new DraftFiles(new IDBFactory());
    const outbox = new IDBFactory();
    const locks = new PageLocks();
    const page = (shelf: DraftShelf) => new PendingStore(outbox, locks as unknown as LockManager, shelf, NO_FETCH, 5);

    const firstShelf = new DraftShelf(storage, files, () => true);
    const first = page(firstShelf);
    const firstHolder = locks.held[0]!;
    firstShelf.stash('turn-1', {
      text: 'проверь, работает ли',
      images: [],
      files: [],
      mentions: [],
      items: [],
      documents: [{ id: 'd1', title: 'Заметка', text: 'тело' }],
    });
    first.keep({
      inputId: 'turn-1',
      at: 1,
      threadId: 'thread-1',
      draftKey: 'thread:thread-1',
      text: 'проверь, работает ли',
      bubble: true,
      sent: null,
    });
    yield* first.orphans();

    const nextShelf = new DraftShelf(storage, files, () => true);
    const next = page(nextShelf);
    const other = page(new DraftShelf(storage, files, () => true));
    expect(yield* next.orphans()).toEqual([]);

    locks.release(firstHolder);
    const taken = yield* next.orphans();
    expect(taken.map((turn) => turn.inputId)).toEqual(['turn-1']);
    expect(yield* other.orphans()).toEqual([]);

    next.handBack(turnOf(taken[0]));
    next.drop('turn-1');

    yield* Effect.promise(() => waitFor(() => expect(nextShelf.at('thread:thread-1').text).toBe('проверь, работает ли')));
    expect(nextShelf.at('thread:thread-1').documents).toEqual([{ id: 'd1', title: 'Заметка', text: 'тело' }]);
    yield* next.orphans();
    locks.held.splice(0);
    expect(yield* page(new DraftShelf(storage, files, () => true)).orphans()).toEqual([]);
  }),
);

it.live('words the server already stores come back with their attachments when another page hands the turn back', () =>
  Effect.gen(function* () {
    const storage = makeStorage();
    const files = new DraftFiles(new IDBFactory());
    const outbox = new IDBFactory();
    const locks = new PageLocks();
    const fetched: string[] = [];
    const fetch = async (attachment: { readonly url: string }) => {
      fetched.push(attachment.url);
      return new File(['# Plan'], 'plan.md', { type: 'text/markdown' });
    };
    const page = (shelf: DraftShelf) => new PendingStore(outbox, locks as unknown as LockManager, shelf, fetch, 5);

    const first = page(new DraftShelf(storage, files, () => true));
    const firstHolder = locks.held[0]!;
    first.keep({
      inputId: 'turn-2',
      at: 1,
      threadId: 'thread-1',
      draftKey: 'thread:thread-1',
      text: 'then the tests',
      bubble: false,
      stored: [{ mime: 'text/markdown', url: '/api/threads/thread-1/attachments/plan.md', filename: 'Plan' }],
      sent: { words: { text: 'then the tests', key: 'turn-2', attachments: [{ id: 'plan.md' }] }, queue: false },
    });
    yield* first.orphans();

    locks.release(firstHolder);
    const nextShelf = new DraftShelf(storage, files, () => true);
    const next = page(nextShelf);
    const [taken] = yield* next.orphans();
    next.handBack(turnOf(taken));

    yield* Effect.promise(() =>
      waitFor(() => expect(nextShelf.at('thread:thread-1').documents).toMatchObject([{ title: 'Plan', text: '# Plan' }])),
    );
    expect(nextShelf.at('thread:thread-1').text).toBe('then the tests');
    expect(fetched).toEqual(['/api/threads/thread-1/attachments/plan.md']);
  }),
);

it.live('an answer a gone page kept is taken back whole by the next page', () =>
  Effect.gen(function* () {
    const storage = makeStorage();
    const files = new DraftFiles(new IDBFactory());
    const outbox = new IDBFactory();
    const locks = new PageLocks();
    const page = () => new PendingStore(outbox, locks as unknown as LockManager, new DraftShelf(storage, files, () => true), NO_FETCH, 5);
    const first = page();
    const firstHolder = locks.held[0]!;
    const kept = {
      inputId: 'answer-1',
      at: 1,
      threadId: 'thread-1',
      answer: { questionId: 'question-1', answers: [{ questionId: 'prompt-1', values: ['confirm'] }], key: 'answer-1' },
    };
    first.keep(kept);
    yield* first.orphans();
    locks.release(firstHolder);
    expect(yield* page().orphans()).toEqual([kept]);
  }),
);

function turnOf(act: KeptAct | undefined): KeptTurn {
  if (act === undefined || 'answer' in act) throw new Error('expected a kept turn');
  return act;
}

const NO_FETCH = () => Promise.reject(new Error('This turn carries no stored attachments.'));
