import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import { Effect } from 'effect';
import { Attachments } from '../../threads/contract/service/attachments.js';
import { itemBlocks } from './pictures.js';

const DOC = '0190d6e2-8f2a-7000-8000-000000000001.md';
const PIC = '0190d6e2-8f2a-7000-8000-000000000002.png';
const PDF = '0190d6e2-8f2a-7000-8000-000000000003.pdf';

const GONE = '0190d6e2-8f2a-7000-8000-000000000004.png';
const LOST = '0190d6e2-8f2a-7000-8000-000000000005.pdf';

const held = new Map<
  string,
  { bytes: Uint8Array; mediaType: 'text/markdown' | 'image/png' | 'application/pdf'; path: string; name?: string }
>([
  [DOC, { bytes: new TextEncoder().encode('# Call 14:02\n\nMe: ship it'), mediaType: 'text/markdown', path: `/kept/t/${DOC}` }],
  [PIC, { bytes: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png', path: `/kept/t/${PIC}` }],
  [PDF, { bytes: new Uint8Array([37, 80, 68, 70]), mediaType: 'application/pdf', path: '/kept/t/0190d6e2/Report.pdf', name: 'Report.pdf' }],
]);

const store = Attachments.of({
  upload: () => Effect.die('this attachment fixture accepts no upload'),
  keep: () => Effect.die('this attachment fixture keeps no picture'),
  drop: () => Effect.die('this attachment fixture keeps no dropped file'),
  read: (_thread, _project, id) => Effect.succeed(held.get(id)!),
  locate: (_thread, _project, id) => Effect.succeed(held.get(id) ?? null),
});

const turn = (...ids: readonly string[]): ThreadInboxItem =>
  ({
    id: 'in-1',
    threadId: 't',
    sender: { kind: 'operator' },
    state: 'queued',
    deliveredToRunId: null,
    occurredAt: '',
    kind: 'turn',
    body: { text: 'q', attachments: ids.map((id) => ({ id })) },
  }) as unknown as ThreadInboxItem;

const blocks = (item: ThreadInboxItem, taken: boolean) => itemBlocks(store, 't', Effect.succeed(1), item, 'q', taken);

const said = (block: { type: string } | undefined): string => (block as { text?: string } | undefined)?.text ?? '';

it.effect(
  'a document reaches an agent that takes no pictures as text, and the picture beside it is told as not sent but where it is kept',
  () =>
    Effect.gen(function* () {
      const sent = yield* blocks(turn(DOC, PIC), false);
      expect(sent.map((block) => block.type)).toEqual(['text', 'text', 'text']);
      expect(said(sent[1])).toContain('# Call 14:02\n\nMe: ship it');
      expect(said(sent[2])).toContain(`/kept/t/${PIC}`);
    }),
);

it.effect(
  'an agent that takes pictures gets the document as text, the picture as an image followed by its path, and a PDF as its path',
  () =>
    Effect.gen(function* () {
      const sent = yield* blocks(turn(PIC, DOC, PDF), true);
      expect(sent.map((block) => block.type)).toEqual(['text', 'text', 'text', 'image', 'text']);
      expect(said(sent[2])).toContain('/kept/t/0190d6e2/Report.pdf');
      expect(said(sent[4])).toContain(`/kept/t/${PIC}`);
    }),
);

it.effect('a picture or a PDF whose file is gone is told as gone, and the words still reach the agent', () =>
  Effect.gen(function* () {
    const sent = yield* blocks(turn(GONE, LOST), true);
    expect(sent.map((block) => block.type)).toEqual(['text', 'text', 'text']);
    expect(said(sent[1])).toContain(LOST);
    expect(said(sent[2])).toContain(GONE);
  }),
);
