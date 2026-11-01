import type { Resolver } from '@runlith/layer/key';
import { makePoint } from '@runlith/layer/testing';
import { Effect } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { type StagedItem, type StagedKind, StagedKinds } from '$lib/shared/threads/staged.js';
import { testShelf } from './native/testing.js';
import { StagedItems } from './native/StagedItems.js';
import type { ThreadUploads } from './native/ThreadUploads.js';
import { ThreadDraft } from './Draft.svelte.js';

const NO_TRANSPORT = {} as ThreadUploads;

type Note = { readonly through: number };

const note = (key: string, through: number, title: string): StagedItem => ({
  kind: 'note',
  key,
  title,
  data: { through } satisfies Note,
});

const staged = (kind: Partial<StagedKind> = {}): StagedItems =>
  new StagedItems(
    makePoint(StagedKinds, { kind: 'note', card: (() => undefined) as unknown as StagedKind['card'], file: async () => null, ...kind }),
    {} as Resolver,
    4,
  );

const NO_KINDS = staged();

it.live(
  'a staged item goes out as the file its kind resolves, once per thread, and its kind hears of it only when the message is accepted',
  () =>
    Effect.gen(function* () {
      const read: string[] = [];
      const uploaded: string[] = [];
      const sent: string[] = [];
      const transport = {
        upload: async (_threadId: string, file: File) => {
          uploaded.push(file.type);
          return { status: 'uploaded' as const, attachment: { id: `doc-${uploaded.length}` } };
        },
      } as unknown as ThreadUploads;
      const items = staged({
        file: async (_app, item) => {
          read.push(item.title);
          return new File([`# ${item.title}`], 'note.md', { type: 'text/markdown' });
        },
        sent: async (_app, item, thread) => void sent.push(`${thread.projectId}/${thread.id}:${item.key}:${(item.data as Note).through}`),
      });
      const draft = new ThreadDraft(testShelf(), transport, items);
      draft.useKey('thread:note');
      draft.stage(note('l1:new', 9, 'Note 00:00–00:04'));
      draft.stage(note('l1:new', 12, 'Note 00:00–00:06'));
      draft.stage(note('l1:1-2', 12, 'Note 00:01–00:02'));

      expect(draft.items.map((one) => [one.key, (one.data as Note).through])).toEqual([
        ['l1:new', 12],
        ['l1:1-2', 12],
      ]);
      expect(draft.attached(draft.current)).toBe(true);
      expect(draft.opening(draft.current).previews?.map((one) => one.filename)).toEqual(['Note 00:00–00:06', 'Note 00:01–00:02']);
      expect(yield* draft.compose('t1', draft.current)).toEqual({
        status: 'composed',
        attachments: [{ id: 'doc-1' }, { id: 'doc-2' }],
      });
      expect(yield* draft.compose('t1', draft.current)).toEqual({
        status: 'composed',
        attachments: [{ id: 'doc-1' }, { id: 'doc-2' }],
      });
      expect([read.length, uploaded]).toEqual([2, ['text/markdown', 'text/markdown']]);
      expect(sent).toEqual([]);
      yield* draft.accepted('t1', draft.current);
      expect(sent).toEqual(['4/t1:l1:new:12', '4/t1:l1:1-2:12']);
    }),
);

it.live('a rewound message brings its markdown document back as a document of the draft, and sending it uploads the same text', () =>
  Effect.gen(function* () {
    const uploaded: string[] = [];
    const transport = {
      attachmentFile: async () => new File(['# Call 14:02\n\nMe: ship it'], 'Call 14:02', { type: 'text/markdown' }),
      upload: async (_threadId: string, file: File) => {
        uploaded.push(await file.text());
        return { status: 'uploaded' as const, attachment: { id: 'doc-1' } };
      },
    } as unknown as ThreadUploads;
    const draft = new ThreadDraft(testShelf(), transport, NO_KINDS);
    draft.useKey('thread:back-doc');

    yield* draft.takeBack('thread:back-doc', [
      {
        text: 'what did they decide?',
        attachments: [{ mime: 'text/markdown', url: '/api/threads/t/attachments/a.md', filename: 'Call 14:02' }],
      },
    ]);

    expect(draft.documents.map((document) => document.title)).toEqual(['Call 14:02']);
    expect(draft.attached(draft.current)).toBe(true);
    expect(yield* draft.compose('t2', draft.current)).toEqual({ status: 'composed', attachments: [{ id: 'doc-1' }] });
    expect(uploaded).toEqual(['# Call 14:02\n\nMe: ship it']);
  }),
);

it.live('a PDF dropped on the draft goes out as an upload under its own name; a file of another kind is refused', () =>
  Effect.gen(function* () {
    const uploaded: (readonly [string, string])[] = [];
    const transport = {
      upload: async (_threadId: string, file: File) => {
        uploaded.push([file.type, file.name]);
        return { status: 'uploaded' as const, attachment: { id: 'pdf-1' } };
      },
    } as unknown as ThreadUploads;
    const draft = new ThreadDraft(testShelf(), transport, NO_KINDS);
    draft.useKey('thread:pdf');

    const refused = yield* Effect.promise(() => draft.attach([new File(['x'], 'notes.zip', { type: 'application/zip' })]));
    const taken = yield* Effect.promise(() => draft.attach([new File(['%PDF-1.4'], 'Договор.pdf', { type: 'application/pdf' })]));

    expect([refused.added, refused.notice === undefined, taken.added]).toEqual([0, false, 1]);
    expect(draft.opening(draft.current).previews).toEqual([{ mime: 'application/pdf', url: '', filename: 'Договор.pdf' }]);
    expect(yield* draft.compose('t1', draft.current)).toEqual({ status: 'composed', attachments: [{ id: 'pdf-1' }] });
    expect(uploaded).toEqual([['application/pdf', 'Договор.pdf']]);
  }),
);

it.live('a kind that cannot record the sending after acceptance is told as a notice once the attempts are spent', () =>
  Effect.gen(function* () {
    let tries = 0;
    const failing = staged({
      sent: () => {
        tries += 1;
        return Promise.reject(new Error('down'));
      },
    });
    const draft = new ThreadDraft(testShelf(), NO_TRANSPORT, failing);
    draft.useKey('thread:late');
    draft.stage(note('l1:new', 5, 'Note 14:02'));

    const notice = yield* draft.accepted('t1', draft.current);
    expect(tries).toBe(3);
    expect(notice?.message).toContain('Note 14:02');
  }),
);

it.live('an item its kind resolves to nothing when it is sent attaches nothing and leaves the draft', () =>
  Effect.gen(function* () {
    const draft = new ThreadDraft(testShelf(), NO_TRANSPORT, NO_KINDS);
    draft.useKey('thread:empty');
    draft.stage(note('l1:new', 4, 'Note 14:02'));
    const refused = yield* draft.compose('t1', draft.current);
    expect(refused.status).toBe('failed');
    expect(draft.items).toEqual([]);
  }),
);

it.live('a message taken back returns its words and its mentions as the draft that sent it, ahead of what the field held', () =>
  Effect.gen(function* () {
    const shelf = testShelf();
    const draft = new ThreadDraft(shelf, NO_TRANSPORT, NO_KINDS);
    draft.useKey('thread:sent');
    draft.setText('Why did the plan stall?');
    draft.stageMentions([
      { name: 'a1b2c3d4', title: 'The plan', tag: 'spec' },
      { name: 'e5f6a7b8', title: '', tag: null },
    ]);
    const sent = draft.opening(draft.current).text;

    draft.useKey('thread:back');
    draft.setText('half a thought');
    yield* draft.takeBack('thread:back', [{ text: sent, attachments: [] }]);

    expect(draft.text).toBe('Why did the plan stall?\n\nhalf a thought');
    expect(draft.mentions.map((mention) => [mention.name, mention.title])).toEqual([
      ['a1b2c3d4', 'The plan'],
      ['e5f6a7b8', ''],
    ]);
  }),
);
