import type { Piece } from '@tagma/server/speech/contract/wire/listening';
import { Effect } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { testShelf } from './native/testing.js';
import type { CallPieces } from './native/CallPieces.js';
import type { ThreadUploads } from './native/ThreadUploads.js';
import { ThreadDraft } from './Draft.svelte.js';

const NO_TRANSPORT = {} as ThreadUploads;
const NO_CALLS = {} as CallPieces;

const piece = (through: number, title: string, span: Piece['span'] = null): Piece => ({
  listening: 'l1',
  projectId: 4,
  through,
  span,
  from: 0,
  to: 4_000,
  utterances: 3,
  lines: 3,
  title,
});

it.live('a call piece goes out as a document the thread reads, once per thread, and its mark moves only when the message is accepted', () =>
  Effect.gen(function* () {
    const read: string[] = [];
    const uploaded: string[] = [];
    const given: string[] = [];
    const transport = {
      upload: async (_threadId: string, file: File) => {
        uploaded.push(file.type);
        return { status: 'uploaded' as const, attachment: { id: `doc-${uploaded.length}` } };
      },
    } as unknown as ThreadUploads;
    const calls = {
      file: async (one: Piece) => {
        read.push(one.title);
        return one.lines === 0 ? null : new File([`# ${one.title}`], 'call.md', { type: 'text/markdown' });
      },
      give: async (one: Piece, threadId: string) => void given.push(`${threadId}:${one.through}:${one.span === null ? 'new' : 'span'}`),
    } as unknown as CallPieces;
    const draft = new ThreadDraft(testShelf(), transport, calls);
    draft.useKey('thread:call');
    draft.stagePiece(piece(9, 'Call 14:02 · 00:00–00:04'));
    draft.stagePiece(piece(12, 'Call 14:02 · 00:00–00:06'));
    draft.stagePiece(piece(12, 'Call 14:02 · 00:01–00:02', { from: 1_000, to: 2_000 }));

    expect(draft.pieces.map((one) => [one.through, one.span === null])).toEqual([
      [12, true],
      [12, false],
    ]);
    expect(draft.attached(draft.current)).toBe(true);
    expect(draft.opening(draft.current).previews?.map((one) => one.filename)).toEqual([
      'Call 14:02 · 00:00–00:06',
      'Call 14:02 · 00:01–00:02',
    ]);
    expect(yield* draft.compose('t1', draft.current)).toEqual({
      status: 'composed',
      attachments: [{ id: 'doc-1' }, { id: 'doc-2' }],
    });
    expect(yield* draft.compose('t1', draft.current)).toEqual({
      status: 'composed',
      attachments: [{ id: 'doc-1' }, { id: 'doc-2' }],
    });
    expect([read.length, uploaded]).toEqual([2, ['text/markdown', 'text/markdown']]);
    expect(given).toEqual([]);
    yield* draft.accepted('t1', draft.current);
    expect(given).toEqual(['t1:12:new', 't1:12:span']);
  }),
);

it.live('a rewound message brings its call document back as a document of the draft, and sending it uploads the same text', () =>
  Effect.gen(function* () {
    const uploaded: string[] = [];
    const transport = {
      attachmentFile: async () => new File(['# Call 14:02\n\nMe: ship it'], 'Call 14:02', { type: 'text/markdown' }),
      upload: async (_threadId: string, file: File) => {
        uploaded.push(await file.text());
        return { status: 'uploaded' as const, attachment: { id: 'doc-1' } };
      },
    } as unknown as ThreadUploads;
    const draft = new ThreadDraft(testShelf(), transport, NO_CALLS);
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
    const draft = new ThreadDraft(testShelf(), transport, NO_CALLS);
    draft.useKey('thread:pdf');

    const refused = yield* Effect.promise(() => draft.attach([new File(['x'], 'notes.zip', { type: 'application/zip' })]));
    const taken = yield* Effect.promise(() => draft.attach([new File(['%PDF-1.4'], 'Договор.pdf', { type: 'application/pdf' })]));

    expect([refused.added, refused.notice === undefined, taken.added]).toEqual([0, false, 1]);
    expect(draft.opening(draft.current).previews).toEqual([{ mime: 'application/pdf', url: '', filename: 'Договор.pdf' }]);
    expect(yield* draft.compose('t1', draft.current)).toEqual({ status: 'composed', attachments: [{ id: 'pdf-1' }] });
    expect(uploaded).toEqual([['application/pdf', 'Договор.pdf']]);
  }),
);

it.live('a mark that will not move after acceptance is told as a notice once the attempts are spent', () =>
  Effect.gen(function* () {
    let tries = 0;
    const failing = {
      give: () => {
        tries += 1;
        return Promise.reject(new Error('down'));
      },
    } as unknown as CallPieces;
    const draft = new ThreadDraft(testShelf(), NO_TRANSPORT, failing);
    draft.useKey('thread:late');
    draft.stagePiece(piece(5, 'Call 14:02'));

    const notice = yield* draft.accepted('t1', draft.current);
    expect(tries).toBe(3);
    expect(notice?.message).toContain('Call 14:02');
  }),
);

it.live('a piece that holds no lines when it is sent attaches nothing', () =>
  Effect.gen(function* () {
    const calls = { file: async () => null } as unknown as CallPieces;
    const draft = new ThreadDraft(testShelf(), NO_TRANSPORT, calls);
    draft.useKey('thread:empty');
    draft.stagePiece({ ...piece(4, 'Call 14:02'), from: null, to: null, utterances: 0, lines: 0 });
    const refused = yield* draft.compose('t1', draft.current);
    expect(refused.status).toBe('failed');
    expect(draft.pieces).toEqual([]);
  }),
);

it.live('a message taken back returns its words and its mentions as the draft that sent it, ahead of what the field held', () =>
  Effect.gen(function* () {
    const shelf = testShelf();
    const draft = new ThreadDraft(shelf, NO_TRANSPORT, NO_CALLS);
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
